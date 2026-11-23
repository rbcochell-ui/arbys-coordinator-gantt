import {GRAPH_SCOPES} from './contract.mjs';
import {LEGACY_SENT_ATTEMPT_FIELDS, LEGACY_SENT_FIELDS,
  sentPlanDigest} from './legacy_sent_attempt_contract.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const key = value => typeof value === 'string' &&
  /^(?:provider-parts|customer-tracker):[A-Za-z0-9:_-]+$/.test(value);
const exactKeys = (fields, names) => fields &&
  typeof fields === 'object' && !Array.isArray(fields) &&
  Object.keys(fields).sort().join(',') === [...names].sort().join(',');
const FENCE_REFS = Object.freeze(['claimItemId', 'claimEtag',
  'draftReceiptItemId', 'draftReceiptEtag', 'oldRowEtag',
  'inventoryProofDigest']);
const sameFenceRefs = (left, right) => FENCE_REFS.every(name =>
  left?.[name] === right?.[name]);

function commonRefs(fields, refs) {
  return key(fields.DispatchKey) &&
    POSITIVE.test(String(fields.ClaimItemId ?? '')) &&
    GUID.test(fields.ActorOid ?? '') &&
    typeof fields.DraftImmutableId === 'string' &&
    fields.DraftImmutableId.length >= 8 &&
    POSITIVE.test(String(refs?.claimItemId ?? '')) &&
    String(refs.claimItemId) === String(fields.ClaimItemId) &&
    POSITIVE.test(String(refs?.draftReceiptItemId ?? '')) &&
    typeof refs?.claimEtag === 'string' && !!refs.claimEtag &&
    typeof refs?.draftReceiptEtag === 'string' && !!refs.draftReceiptEtag &&
    typeof refs?.oldRowEtag === 'string' && !!refs.oldRowEtag &&
    SHA.test(refs?.inventoryProofDigest ?? '') &&
    typeof fields.MigratedFrom === 'string' &&
    /^legacy-(?:provider-parts|customer-tracker):[A-Za-z0-9._:-]{1,88}$/.test(
      fields.MigratedFrom) &&
    Number.isFinite(Date.parse(fields.RecordedAtUtc ?? ''));
}

function validSentShape(fields, refs) {
  if (!exactKeys(fields, LEGACY_SENT_FIELDS) ||
      !commonRefs(fields, refs) ||
      fields.Kind !== 'Sent' ||
      fields.ReceiptKey !== `${fields.DispatchKey}|Sent` ||
      fields.Title !== fields.ReceiptKey ||
      fields.DraftImmutableId !== fields.SentImmutableId ||
      !/^sha256:[0-9a-f]{64}$/.test(fields.ActualSubject ?? '') ||
      !SHA.test(fields.ActualBodySha256 ?? '') ||
      !SHA.test(fields.ActualLinksSha256 ?? '') ||
      typeof fields.SentInternetMessageId !== 'string' ||
      !fields.SentInternetMessageId ||
      !['', 'SENT_DETAILS_CHANGED'].includes(fields.ReviewReason) ||
      !Number.isFinite(Date.parse(fields.SentAtUtc ?? ''))) return false;
  try {
    const to = JSON.parse(fields.ActualToJson);
    const cc = JSON.parse(fields.ActualCcJson);
    const bcc = JSON.parse(fields.ActualBccJson);
    return [to, cc, bcc].every(Array.isArray) &&
      to.length + cc.length + bcc.length > 0;
  } catch { return false; }
}

async function validAttempt(fields, refs) {
  if (!exactKeys(fields, LEGACY_SENT_ATTEMPT_FIELDS) ||
      !commonRefs(fields, refs) ||
      fields.Kind !== 'SentAttempt' ||
      fields.ReceiptKey !== `${fields.DispatchKey}|SentAttempt` ||
      fields.Title !== fields.ReceiptKey ||
      !SHA.test(fields.PlannedSentSha256 ?? '') ||
      !validSentShape(refs?.plannedSentFields, refs) ||
      fields.DispatchKey !== refs.plannedSentFields.DispatchKey ||
      fields.ClaimItemId !== refs.plannedSentFields.ClaimItemId ||
      fields.ActorOid !== refs.plannedSentFields.ActorOid ||
      fields.DraftImmutableId !== refs.plannedSentFields.DraftImmutableId ||
      fields.MigratedFrom !== refs.plannedSentFields.MigratedFrom) return false;
  return fields.PlannedSentSha256 ===
    await sentPlanDigest(refs.plannedSentFields);
}

async function validFinal(fields, refs) {
  return validSentShape(fields, refs) &&
    POSITIVE.test(String(refs?.attemptItemId ?? '')) &&
    typeof refs?.attemptEtag === 'string' && !!refs.attemptEtag &&
    SHA.test(refs?.plannedSentSha256 ?? '') &&
    refs.plannedSentSha256 === await sentPlanDigest(fields);
}

/**
 * Binds the exact selected Receipts List. This port permits a final Sent POST
 * only after its own marker POST returned 201, and consumes that right once.
 * The owner adapter performs the required saved-marker readback before calling
 * the port for Sent. There is no Outlook method or retry. GraphClient invokes
 * beforeFetch after token acquisition at the HTTP edge.
 */
export function createLegacySentGraphPort({graph, siteId,
    receiptsListId} = {}) {
  if (typeof graph?.bindAccount !== 'function' ||
      typeof siteId !== 'string' || !siteId ||
      !GUID.test(receiptsListId ?? '')) {
    throw new TypeError('Bound Graph and exact Receipts List required');
  }
  const path = `/v1.0/sites/${encodeURIComponent(siteId)}` +
    `/lists/${receiptsListId}/items`;
  // This in-memory phase guard is defense against an accidental direct port
  // call. The SharePoint unique marker remains the durable reload fence.
  const phases = new Map();
  return async (fields, readRefs, beforeFetch) => {
    const isAttempt = fields?.Kind === 'SentAttempt';
    if (typeof beforeFetch !== 'function' ||
        !(isAttempt ? await validAttempt(fields, readRefs) :
          fields?.Kind === 'Sent' &&
            await validFinal(fields, readRefs))) {
      throw new TypeError('Exact migrated receipt evidence required');
    }
    const dispatchKey = fields.DispatchKey;
    if (isAttempt) {
      if (phases.has(dispatchKey)) {
        throw new TypeError('SentAttempt already attempted by this port');
      }
      // Reserve before token acquisition so concurrent direct callers cannot
      // both reach the marker POST. An ambiguous response never resets this.
      phases.set(dispatchKey, {phase: 'marker-attempted'});
    } else {
      const prior = phases.get(dispatchKey);
      if (prior?.phase !== 'marker-created' ||
          String(readRefs.attemptItemId) !== prior.itemId ||
          readRefs.plannedSentSha256 !== prior.digest ||
          !sameFenceRefs(readRefs, prior.readRefs)) {
        throw new TypeError('Saved marker phase required before Sent POST');
      }
      // Consume the sole final POST right before any asynchronous account or
      // network work. Even a lost response cannot rearm it.
      phases.set(dispatchKey, {...prior, phase: 'final-attempted'});
    }
    const bound = graph.bindAccount();
    if (typeof bound?.getMe !== 'function' ||
        typeof bound?.request !== 'function') {
      throw new TypeError('Pinned Graph account required');
    }
    const actor = await bound.getMe();
    if (String(actor?.id ?? '').toLowerCase() !==
        fields.ActorOid.toLowerCase()) {
      throw new TypeError('Receipt mailbox owner changed');
    }
    const response = await bound.request(path, {method: 'POST',
      scopes: GRAPH_SCOPES.lists,
      body: {fields}, beforeFetch});
    if (isAttempt && response?.status === 201 &&
        POSITIVE.test(String(response?.data?.id ?? ''))) {
      phases.set(dispatchKey, {phase: 'marker-created',
        itemId: String(response.data.id),
        digest: fields.PlannedSentSha256,
        readRefs: Object.fromEntries(FENCE_REFS.map(name =>
          [name, readRefs[name]]))});
    }
    return response;
  };
}
