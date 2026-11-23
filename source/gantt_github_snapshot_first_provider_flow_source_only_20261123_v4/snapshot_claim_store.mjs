/**
 * Versioned provider-Claim reader that shares V2's physical unique Lists.
 * V2 WO/Contact evidence remains readable; new snapshot evidence is explicit.
 */
import {ClaimReceiptStore} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/claim_receipt_store.mjs';
import {buildProviderDraft, email, HeldActionError, PICOS_PARTS,
  providerDispatchKey, receiptKey} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';

export const SNAPSHOT_CLAIM_MODE = 'gantt-snapshot-one-click/v1';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA = /^[0-9a-f]{64}$/u;
const SHA_MARKER = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
const POSITIVE = /^[1-9][0-9]*$/u;
const PREINSTALL = new Set(['Pending Readiness', 'Pending Scheduled Date']);

function fail(code) { throw new HeldActionError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, names) {
  return object(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...names].sort());
}
function validUtc(value) {
  return typeof value === 'string' && UTC.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString().slice(0, 19) === value.slice(0, 19);
}
function canonicalEmail(value) {
  try { return typeof value === 'string' && email(value) === value; }
  catch { return false; }
}
function canonicalAudience(value, {allowEmpty = true, max = 500,
    distinct = true} = {}) {
  if (!Array.isArray(value) || value.length > max ||
      (!allowEmpty && value.length === 0) ||
      value.some(address => !canonicalEmail(address)) ||
      (distinct && new Set(value).size !== value.length)) {
    fail('SNAPSHOT_AUDIENCE_INVALID');
  }
  return value;
}
function storedAudience(value, {allowEmpty = true, max = 500,
    distinct = true} = {}) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { fail('SNAPSHOT_RECEIPT_INVALID'); }
  return canonicalAudience(parsed, {allowEmpty, max, distinct});
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('SNAPSHOT_CRYPTO_UNAVAILABLE');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function exactLinks(value) {
  let links;
  try { links = JSON.parse(value); }
  catch { fail('SNAPSHOT_RECEIPT_INVALID'); }
  if (!Array.isArray(links) || links.length !== PICOS_PARTS.length ||
      JSON.stringify(links) !== JSON.stringify(PICOS_PARTS.map(part => part.url))) {
    fail('SNAPSHOT_RECEIPT_INVALID');
  }
  return links;
}
function snapshotEvidence(value, id) {
  if (!exactKeys(value, ['mode', 'release', 'snapshot']) ||
      value.mode !== SNAPSHOT_CLAIM_MODE ||
      !exactKeys(value.release, ['itemId', 'etag', 'htmlSha256',
        'ciphertextSha256']) ||
      !POSITIVE.test(String(value.release.itemId ?? '')) ||
      typeof value.release.etag !== 'string' || !value.release.etag ||
      !SHA.test(value.release.htmlSha256 ?? '') ||
      !SHA.test(value.release.ciphertextSha256 ?? '') ||
      !exactKeys(value.snapshot, ['nativeWoId', 'sourceAsOfUtc',
        'datedPhase', 'woNumber', 'agentCode', 'visitKind', 'scopeClass',
        'recipientSuggestion', 'suggestedTo', 'thirstyUrl']) ||
      value.snapshot.nativeWoId !== id ||
      !validUtc(value.snapshot.sourceAsOfUtc) ||
      !PREINSTALL.has(value.snapshot.datedPhase) ||
      !/^[0-9]{5,12}$/u.test(value.snapshot.woNumber ?? '') ||
      !/^[A-Z][A-Z0-9]{0,9}$/u.test(value.snapshot.agentCode ?? '') ||
      !['Installation', 'Relocation'].includes(value.snapshot.visitKind) ||
      !['fountain', 'unknown'].includes(value.snapshot.scopeClass) ||
      !['exact_saved_file_pair', 'none'].includes(value.snapshot.recipientSuggestion) ||
      typeof value.snapshot.thirstyUrl !== 'string' ||
      value.snapshot.thirstyUrl !==
        `https://hubit.my.salesforce.com/lightning/r/WorkOrder/${id}/view`) {
    fail('SNAPSHOT_CLAIM_EVIDENCE_INVALID');
  }
  const to = canonicalAudience(value.snapshot.suggestedTo, {max: 2});
  if ((value.snapshot.recipientSuggestion === 'none' && to.length !== 0) ||
      (value.snapshot.recipientSuggestion === 'exact_saved_file_pair' &&
        ![1, 2].includes(to.length))) {
    fail('SNAPSHOT_CLAIM_EVIDENCE_INVALID');
  }
  return value;
}

export class SnapshotClaimReceiptStore extends ClaimReceiptStore {
  withGraph(graph) {
    return new SnapshotClaimReceiptStore({graph, config: this.config,
      now: this.now});
  }

  async getState(dispatchKey) {
    // The inherited validator remains authoritative for old WO/Contact Claims
    // and their migration markers. New Claims are parsed under the explicit
    // snapshot mode without pretending Release ETags are WO/Contact ETags.
    const id = dispatchKey?.startsWith('provider-parts:')
      ? dispatchKey.slice('provider-parts:'.length) : null;
    if (!id || providerDispatchKey(id) !== dispatchKey || !id.startsWith('0WO')) {
      fail('DISPATCH_KEY_INVALID');
    }
    const claim = await this._unique(this.claimBase, 'DispatchKey', dispatchKey);
    if (!claim) return super.getState(dispatchKey);
    let evidence;
    try { evidence = JSON.parse(claim.fields.SourceETagsJson); }
    catch { fail('SNAPSHOT_CLAIM_EVIDENCE_INVALID'); }
    if (evidence?.mode !== SNAPSHOT_CLAIM_MODE) {
      return super.getState(dispatchKey);
    }
    const [draft, sent] = await Promise.all([
      this._unique(this.receiptBase, 'ReceiptKey', receiptKey(dispatchKey, 'Draft')),
      this._unique(this.receiptBase, 'ReceiptKey', receiptKey(dispatchKey, 'Sent')),
    ]);
    const f = claim.fields;
    snapshotEvidence(evidence, id);
    if (f.DispatchKey !== dispatchKey || f.ActionKind !== 'provider-parts' ||
        f.EntityId !== id || !GUID.test(f.ActorOid ?? '') ||
        !canonicalEmail(f.ActorEmail) || !GUID.test(f.AttemptId ?? '') ||
        !GUID.test(f.CorrelationId ?? '') || !SHA.test(f.SourceDigest ?? '') ||
        !validUtc(f.ClaimedAtUtc) || f.MigratedFrom) {
      fail('SNAPSHOT_CLAIM_EVIDENCE_INVALID');
    }
    if (await sha256(f.SourceETagsJson) !== f.SourceDigest) {
      fail('SNAPSHOT_CLAIM_DIGEST_MISMATCH');
    }
    for (const [kind, row] of [['Draft', draft], ['Sent', sent]]) {
      if (row && (row.fields.ReceiptKey !== receiptKey(dispatchKey, kind) ||
          row.fields.DispatchKey !== dispatchKey || row.fields.Kind !== kind ||
          String(row.fields.ClaimItemId) !== claim.id ||
          String(row.fields.ActorOid).toLowerCase() !== f.ActorOid.toLowerCase() ||
          row.fields.MigratedFrom)) {
        fail('SNAPSHOT_RECEIPT_INVALID');
      }
    }
    if (sent && !draft) fail('SENT_WITHOUT_DRAFT');
    if (draft) {
      const d = draft.fields;
      const intendedTo = storedAudience(d.IntendedToJson, {max: 2});
      exactLinks(d.RequiredLinksJson);
      const expected = buildProviderDraft({woNumber: evidence.snapshot.woNumber,
        agentCode: evidence.snapshot.agentCode, to: []});
      if (d.DraftImmutableId !== String(d.DraftImmutableId ?? '') ||
          !d.DraftImmutableId ||
          d.DraftWebLink != null && d.DraftWebLink !== '' ||
          d.IntendedSubject !== expected.subject ||
          !SHA.test(d.IntendedBodySha256 ?? '') ||
          JSON.stringify(intendedTo) !==
            JSON.stringify(evidence.snapshot.suggestedTo)) {
        fail('SNAPSHOT_DRAFT_RECEIPT_INVALID');
      }
    }
    if (sent) {
      const s = sent.fields;
      const to = storedAudience(s.ActualToJson, {distinct: false});
      const cc = storedAudience(s.ActualCcJson, {distinct: false});
      const bcc = storedAudience(s.ActualBccJson, {distinct: false});
      if (s.DraftImmutableId !== draft.fields.DraftImmutableId ||
          typeof s.SentImmutableId !== 'string' ||
          s.SentImmutableId.length < 8 || s.SentImmutableId.length > 2048 ||
          !SHA_MARKER.test(s.ActualSubject ?? '') ||
          !SHA.test(s.ActualBodySha256 ?? '') ||
          !SHA.test(s.ActualLinksSha256 ?? '') ||
          !to.length && !cc.length && !bcc.length ||
          !validUtc(s.SentAtUtc) ||
          typeof s.SentInternetMessageId !== 'string' ||
          !s.SentInternetMessageId ||
          !['', 'SENT_DETAILS_CHANGED'].includes(s.ReviewReason) ||
          !validUtc(s.RecordedAtUtc)) {
        fail('SNAPSHOT_SENT_RECEIPT_INVALID');
      }
    }
    return {claim, draft, sent, snapshotEvidence: evidence};
  }
}
