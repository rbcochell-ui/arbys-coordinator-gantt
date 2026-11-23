import {LegacyHold, LegacyReopenAdapter} from './legacy_reopen.mjs';
import {canonicalSentPlan, sentPlanDigest} from
  './legacy_sent_attempt_contract.mjs';

const MAX_POST_DELAY_MS = 15_000;
const positiveId = value => /^[1-9][0-9]*$/.test(String(value ?? ''));

function hold(code) { throw new LegacyHold(code); }

function clock(now) {
  let value;
  try { value = now(); } catch { hold('LEGACY_SENT_CLOCK_UNVERIFIED'); }
  if (!Number.isSafeInteger(value) || value < 0) {
    hold('LEGACY_SENT_CLOCK_UNVERIFIED');
  }
  return value;
}

function comparable(plan) {
  const {RecordedAtUtc, ...fields} = plan.fields;
  return JSON.stringify({...plan, fields});
}

function sameReadRefs(left, right) {
  return ['claimItemId', 'claimEtag', 'draftReceiptItemId',
    'draftReceiptEtag', 'oldRowEtag', 'inventoryProofDigest']
    .every(name => left?.[name] === right?.[name]);
}

/**
 * Source-only one-shot Sent receipt writer for an already migrated old draft.
 * `postReceipt` is the exact pinned-Graph List-items POST port. It first
 * reserves the physically unique SentAttempt key, verifies that saved row,
 * and only then posts the Sent receipt. It invokes `beforeFetch` immediately
 * before each HTTP request after token acquisition. It never points at
 * Outlook. An unknown result is terminal: inspect, don't retry. The Draft
 * Receipt and old row are never modified.
 */
export async function recordLegacySentOnce(adapter, dispatchKey,
    postReceipt, {now = () => Date.now()} = {}) {
  if (!(adapter instanceof LegacyReopenAdapter) ||
      typeof postReceipt !== 'function' || typeof now !== 'function') {
    throw new TypeError('Exact legacy adapter and List POST port required');
  }
  // Two complete owner-only observations catch changes during the first
  // Graph traversal. Neither one can create or send a message.
  const first = await adapter.prepareSentReceipt(dispatchKey);
  const second = await adapter.prepareSentReceipt(dispatchKey);
  if (comparable(first) !== comparable(second) ||
      second.fields.DispatchKey !== dispatchKey ||
      !positiveId(second.claimItemId) ||
      !positiveId(second.draftReceiptItemId) ||
      !Number.isFinite(second.inventoryValidUntilMs)) {
    hold('LEGACY_SENT_PREFLIGHT_CHANGED');
  }
  const preparedAt = clock(now);
  const deadline = Math.min(preparedAt + MAX_POST_DELAY_MS,
    second.inventoryValidUntilMs);
  if (deadline <= preparedAt) hold('LEGACY_SENT_PREFLIGHT_EXPIRED');
  const readRefs = Object.freeze({
    claimItemId: second.claimItemId, claimEtag: second.claimEtag,
    draftReceiptItemId: second.draftReceiptItemId,
    draftReceiptEtag: second.draftReceiptEtag,
    oldRowEtag: second.oldRowEtag,
    inventoryProofDigest: second.inventoryProofDigest,
  });
  let markerDigest;
  try { markerDigest = await sentPlanDigest(second.fields); }
  catch { hold('LEGACY_SENT_PREFLIGHT_CHANGED'); }
  const markerFields = Object.freeze({
    Title: `${dispatchKey}|SentAttempt`,
    ReceiptKey: `${dispatchKey}|SentAttempt`,
    DispatchKey: dispatchKey, Kind: 'SentAttempt',
    ClaimItemId: second.claimItemId, ActorOid: second.fields.ActorOid,
    DraftImmutableId: second.fields.DraftImmutableId,
    PlannedSentSha256: markerDigest,
    RecordedAtUtc: new Date(clock(now)).toISOString(),
    MigratedFrom: second.fields.MigratedFrom,
  });
  let markerBoundaryChecked = false;
  const beforeMarkerFetch = () => {
    markerBoundaryChecked = true;
    if (clock(now) >= deadline) hold('LEGACY_SENT_PREFLIGHT_EXPIRED');
  };
  let markerResponse;
  try {
    markerResponse = await postReceipt(markerFields, Object.freeze({
      ...readRefs, plannedSentFields: second.fields,
    }), beforeMarkerFetch);
  } catch { hold('LEGACY_SENT_ATTEMPT_OUTCOME_UNKNOWN'); }
  if (!markerBoundaryChecked || markerResponse?.status !== 201 ||
      !positiveId(markerResponse?.data?.id)) {
    hold('LEGACY_SENT_ATTEMPT_OUTCOME_UNKNOWN');
  }
  let markerReadback;
  try {
    markerReadback = await adapter.verifyRecordedAttempt(dispatchKey,
      markerResponse.data.id, markerFields, second.fields);
  } catch { hold('LEGACY_SENT_ATTEMPT_READBACK_UNCERTAIN'); }
  const finalPlan = markerReadback?.sentPlan;
  let samePlan = false;
  try {
    samePlan = canonicalSentPlan(finalPlan?.fields) ===
      canonicalSentPlan(second.fields);
  } catch { /* An incomplete readback cannot authorize the final POST. */ }
  if (!finalPlan || !sameReadRefs(finalPlan, second) || !samePlan ||
      markerReadback?.attemptEtag == null ||
      typeof markerReadback.attemptEtag !== 'string' ||
      !markerReadback.attemptEtag ||
      clock(now) >= deadline) {
    hold('LEGACY_SENT_ATTEMPT_READBACK_UNCERTAIN');
  }
  let finalBoundaryChecked = false;
  const beforeFinalFetch = () => {
    finalBoundaryChecked = true;
    if (clock(now) >= deadline) hold('LEGACY_SENT_PREFLIGHT_EXPIRED');
  };
  let response;
  try {
    response = await postReceipt(second.fields, Object.freeze({
      ...readRefs, attemptItemId: String(markerResponse.data.id),
      attemptEtag: markerReadback.attemptEtag,
      plannedSentSha256: markerDigest,
    }), beforeFinalFetch);
  } catch { hold('LEGACY_SENT_WRITE_OUTCOME_UNKNOWN'); }
  if (!finalBoundaryChecked || response?.status !== 201 ||
      !positiveId(response?.data?.id)) {
    hold('LEGACY_SENT_WRITE_OUTCOME_UNKNOWN');
  }
  // This final owner/mailbox/List readback must see the newly unique Sent
  // Receipt and the same immutable message in Sent Items. A failed readback
  // never authorizes a second POST.
  let result;
  try {
    result = await adapter.verifyRecordedSent(dispatchKey,
      response.data.id, second.fields);
  }
  catch { hold('LEGACY_SENT_READBACK_UNCERTAIN'); }
  if (result.status !== 'sent' || result.webLink !== null ||
      result.sendReady !== false) hold('LEGACY_SENT_READBACK_UNCERTAIN');
  return result;
}
