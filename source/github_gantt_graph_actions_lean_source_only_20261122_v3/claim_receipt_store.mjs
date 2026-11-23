import {customerDispatchKey, email, GRAPH_SCOPES, HeldActionError, providerDispatchKey,
  receiptKey, SITE_URL, validatedCustomerTrackerUrl} from './contract.mjs';

const CLAIM_TITLE = 'Arbys Coordinator Action Claims';
const RECEIPT_TITLE = 'Arbys Coordinator Action Receipts';
export const CLAIM_COLUMNS = Object.freeze([
  'Title', 'DispatchKey', 'ActionKind', 'EntityId', 'ActorOid', 'ActorEmail',
  'AttemptId', 'CorrelationId', 'SourceDigest', 'SourceETagsJson',
  'ClaimedAtUtc', 'MigratedFrom',
]);
export const RECEIPT_COLUMNS = Object.freeze([
  'Title', 'ReceiptKey', 'DispatchKey', 'Kind', 'ClaimItemId', 'ActorOid',
  'DraftImmutableId', 'DraftWebLink', 'IntendedSubject', 'IntendedToJson',
  'RequiredLinksJson', 'IntendedBodySha256', 'SentImmutableId',
  'ActualSubject', 'ActualBodySha256', 'ActualLinksSha256',
  'ActualToJson', 'ActualCcJson', 'ActualBccJson', 'SentAtUtc',
  'SentInternetMessageId', 'ReviewReason',
  'RecordedAtUtc', 'MigratedFrom',
]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const SHA_MARKER = /^sha256:[0-9a-f]{64}$/;
const sentReviewCode = value => value ? 'SENT_DETAILS_CHANGED' : '';

function fail(code) { throw new HeldActionError(code); }
function assertNoCapability(fields) {
  const serialized = JSON.stringify(fields);
  if (serialized.includes('https://rbcochell-ui.github.io/arbys-customer-status-preview/') ||
      serialized.includes('?p=p_') || serialized.includes('#k=')) {
    fail('SHARED_RECEIPT_CAPABILITY_FORBIDDEN');
  }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function actionOf(dispatchKey) {
  if (typeof dispatchKey !== 'string') fail('DISPATCH_KEY_INVALID');
  if (dispatchKey.startsWith('provider-parts:')) {
    const entity = dispatchKey.slice('provider-parts:'.length);
    if (providerDispatchKey(entity) !== dispatchKey) fail('DISPATCH_KEY_INVALID');
    return {kind: 'provider-parts', entity};
  }
  if (dispatchKey.startsWith('customer-tracker:')) {
    const entity = dispatchKey.slice('customer-tracker:'.length);
    if (customerDispatchKey(entity) !== dispatchKey) fail('DISPATCH_KEY_INVALID');
    return {kind: 'customer-tracker', entity};
  }
  fail('DISPATCH_KEY_INVALID');
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('ACTION_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function listBase(siteId, listId) {
  return `/v1.0/sites/${encodeURIComponent(siteId)}/lists/${listId}`;
}
function itemRecord(item) {
  const etag = item?.eTag ?? item?.['@odata.etag'];
  if (!/^[1-9][0-9]*$/.test(String(item?.id ?? '')) ||
      typeof etag !== 'string' || !etag || !object(item.fields)) {
    fail('ACTION_ITEM_INCOMPLETE');
  }
  return {id: String(item.id), etag, fields: item.fields};
}
function storedRecipients(value) {
  let rows;
  try { rows = JSON.parse(value); } catch { fail('SENT_RECEIPT_INVALID'); }
  const valid = address => {
    try { return typeof address === 'string' && email(address) === address; }
    catch { return false; }
  };
  if (!Array.isArray(rows) || rows.some(address => !valid(address))) {
    fail('SENT_RECEIPT_INVALID');
  }
  return rows;
}

export class ClaimReceiptStore {
  constructor({graph, config, now = () => Date.now()}) {
    if (typeof graph?.request !== 'function') throw new TypeError('Delegated Graph is required');
    this.graph = graph;
    this.config = config;
    this.now = now;
    this.claimBase = listBase(config.siteId, config.lists.claims);
    this.receiptBase = listBase(config.siteId, config.lists.receipts);
  }

  withGraph(graph) { return new ClaimReceiptStore({graph, config: this.config, now: this.now}); }

  async _get(path) {
    let r;
    try { r = await this.graph.request(path, {scopes: GRAPH_SCOPES.lists}); }
    catch { fail('ACTION_LIST_READ_UNCERTAIN'); }
    if (r?.status !== 200 || !object(r.data)) fail('ACTION_LIST_READ_UNCERTAIN');
    return r.data;
  }

  async _assertList(base, id, title, names, uniqueKey) {
    const list = await this._get(`${base}?$select=id,displayName,webUrl`);
    let webUrl;
    try { webUrl = new URL(list.webUrl); } catch { fail('ACTION_LIST_IDENTITY_INVALID'); }
    if (String(list.id).toLowerCase() !== id.toLowerCase() ||
        list.displayName !== title || webUrl.origin !== new URL(SITE_URL).origin ||
        !webUrl.pathname.startsWith('/sites/ArbysOperations/')) {
      fail('ACTION_LIST_IDENTITY_INVALID');
    }
    const columns = await this._get(
      `${base}/columns?$select=name,required,indexed,enforceUniqueValues,text&$top=200`);
    if (!Array.isArray(columns.value) || columns['@odata.nextLink']) {
      fail('ACTION_COLUMNS_INCOMPLETE');
    }
    const byName = new Map(columns.value.map(c => [c?.name, c]));
    if (names.some(name => !byName.has(name)) ||
        byName.get(uniqueKey)?.required !== true ||
        byName.get(uniqueKey)?.indexed !== true ||
        byName.get(uniqueKey)?.enforceUniqueValues !== true ||
        !object(byName.get(uniqueKey)?.text)) {
      fail('ACTION_SCHEMA_UNVERIFIED');
    }
  }

  async assertSchema() {
    await Promise.all([
      this._assertList(this.claimBase, this.config.lists.claims,
        CLAIM_TITLE, CLAIM_COLUMNS, 'DispatchKey'),
      this._assertList(this.receiptBase, this.config.lists.receipts,
        RECEIPT_TITLE, RECEIPT_COLUMNS, 'ReceiptKey'),
    ]);
  }

  async _unique(base, field, value) {
    const query = new URLSearchParams({
      '$select': 'id,eTag', '$expand': 'fields',
      '$filter': `fields/${field} eq '${value.replaceAll("'", "''")}'`,
      '$top': '2',
    });
    const result = await this._get(`${base}/items?${query}`);
    if (!Array.isArray(result.value) || result.value.length > 1 ||
        result['@odata.nextLink']) fail('ACTION_KEY_AMBIGUOUS');
    return result.value.length ? itemRecord(result.value[0]) : null;
  }

  async getState(dispatchKey) {
    const action = actionOf(dispatchKey);
    const [claim, draft, sent] = await Promise.all([
      this._unique(this.claimBase, 'DispatchKey', dispatchKey),
      this._unique(this.receiptBase, 'ReceiptKey', receiptKey(dispatchKey, 'Draft')),
      this._unique(this.receiptBase, 'ReceiptKey', receiptKey(dispatchKey, 'Sent')),
    ]);
    if (!claim) {
      if (draft || sent) fail('ORPHAN_ACTION_RECEIPT');
      return null;
    }
    const f = claim.fields;
    const migrated = f.MigratedFrom;
    if (migrated !== undefined && migrated !== null && migrated !== '' &&
        (typeof migrated !== 'string' || migrated.length > 120 ||
        !/^legacy-(?:provider-parts|customer-tracker):[A-Za-z0-9._:-]{1,88}$/.test(migrated))) {
      fail('CLAIM_MIGRATION_MARKER_INVALID');
    }
    let etags;
    try { etags = JSON.parse(f.SourceETagsJson); } catch { fail('CLAIM_EVIDENCE_INVALID'); }
    if (f.DispatchKey !== dispatchKey || f.ActionKind !== action.kind ||
        f.EntityId !== action.entity ||
        !GUID.test(f.ActorOid ?? '') || email(f.ActorEmail) !== f.ActorEmail ||
        !GUID.test(f.AttemptId ?? '') || !GUID.test(f.CorrelationId ?? '') ||
        !SHA.test(f.SourceDigest ?? '') ||
        !(action.kind === 'provider-parts'
          ? (/^[1-9][0-9]*$/.test(String(etags?.wo?.itemId ?? '')) &&
            typeof etags?.wo?.etag === 'string' && etags.wo.etag &&
            (etags?.contact?.state === 'absent'
              ? SHA.test(etags.contact.lookupKey ?? '')
              : (/^[1-9][0-9]*$/.test(String(etags?.contact?.itemId ?? '')) &&
                typeof etags?.contact?.etag === 'string' && etags.contact.etag)))
          : (/^[1-9][0-9]*$/.test(String(etags?.release?.itemId ?? '')) &&
            typeof etags?.release?.etag === 'string' && etags.release.etag)) ||
        !Number.isFinite(Date.parse(f.ClaimedAtUtc ?? ''))) {
      fail('CLAIM_EVIDENCE_INVALID');
    }
    if (action.kind === 'customer-tracker' &&
        (Object.keys(etags).length !== 1 ||
          Object.keys(etags.release).sort().join(',') !== 'etag,itemId')) {
      fail('CLAIM_EVIDENCE_INVALID');
    }
    assertNoCapability(f);
    for (const [kind, receipt] of [['Draft', draft], ['Sent', sent]]) {
      if (receipt && (receipt.fields.ReceiptKey !== receiptKey(dispatchKey, kind) ||
          receipt.fields.DispatchKey !== dispatchKey || receipt.fields.Kind !== kind ||
          String(receipt.fields.ClaimItemId) !== claim.id ||
          String(receipt.fields.ActorOid).toLowerCase() !== f.ActorOid.toLowerCase() ||
          (migrated && receipt.fields.MigratedFrom !== migrated))) {
        fail('RECEIPT_EVIDENCE_INVALID');
      }
      if (receipt) assertNoCapability(receipt.fields);
    }
    if (sent && !draft) fail('SENT_WITHOUT_DRAFT');
    if (draft && (typeof draft.fields.DraftImmutableId !== 'string' ||
        !draft.fields.DraftImmutableId ||
        typeof draft.fields.IntendedSubject !== 'string' ||
        !draft.fields.IntendedSubject ||
        !SHA.test(draft.fields.IntendedBodySha256 ?? '') ||
        draft.fields.DraftWebLink != null && draft.fields.DraftWebLink !== '')) {
      fail('DRAFT_RECEIPT_INVALID');
    }
    if (draft && action.kind === 'customer-tracker') {
      let linkMarkers;
      try { linkMarkers = JSON.parse(draft.fields.RequiredLinksJson); }
      catch { fail('DRAFT_RECEIPT_INVALID'); }
      if (!Array.isArray(linkMarkers) || linkMarkers.length !== 1 ||
          !SHA_MARKER.test(linkMarkers[0] ?? '')) {
        fail('DRAFT_RECEIPT_INVALID');
      }
    }
    if (sent) {
      const s = sent.fields;
      const to = storedRecipients(s.ActualToJson);
      const cc = storedRecipients(s.ActualCcJson);
      const bcc = storedRecipients(s.ActualBccJson);
      if (s.DraftImmutableId !== draft.fields.DraftImmutableId ||
          s.SentImmutableId !== draft.fields.DraftImmutableId ||
          !SHA_MARKER.test(s.ActualSubject ?? '') ||
          !SHA.test(s.ActualBodySha256 ?? '') ||
          !SHA.test(s.ActualLinksSha256 ?? '') ||
          !to.length && !cc.length && !bcc.length ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s.SentAtUtc ?? '') ||
          !Number.isFinite(Date.parse(s.SentAtUtc)) ||
          typeof s.SentInternetMessageId !== 'string' ||
          !s.SentInternetMessageId ||
          !['', 'SENT_DETAILS_CHANGED'].includes(s.ReviewReason) ||
          !Number.isFinite(Date.parse(s.RecordedAtUtc ?? ''))) {
        fail('SENT_RECEIPT_INVALID');
      }
    }
    return {claim, draft, sent};
  }

  async createClaim(dispatchKey, actor, source, attemptId, correlationId) {
    const action = actionOf(dispatchKey);
    if ((action.kind === 'provider-parts' && source.nativeWoId !== action.entity) ||
        (action.kind === 'customer-tracker' && source.formSourceKey !== action.entity)) {
      fail('CLAIM_SOURCE_KEY_MISMATCH');
    }
    const fields = {
      Title: dispatchKey, DispatchKey: dispatchKey, ActionKind: action.kind,
      EntityId: action.entity, ActorOid: actor.id, ActorEmail: actor.address,
      AttemptId: attemptId, CorrelationId: correlationId,
      SourceDigest: source.digest, SourceETagsJson: source.etagsJson,
      ClaimedAtUtc: new Date(this.now()).toISOString(),
    };
    assertNoCapability(fields);
    let created;
    try {
      created = await this.graph.request(`${this.claimBase}/items`, {
        method: 'POST', scopes: GRAPH_SCOPES.lists, body: {fields},
      });
    } catch { fail('CLAIM_OUTCOME_UNKNOWN'); }
    if (created.status !== 201 || !/^[1-9][0-9]*$/.test(String(created.data?.id ?? ''))) {
      fail('CLAIM_OUTCOME_UNKNOWN');
    }
    const state = await this.getState(dispatchKey);
    if (!state || state.claim.id !== String(created.data.id) || state.draft || state.sent ||
        Object.entries(fields).some(([name, value]) => state.claim.fields[name] !== value)) {
      fail('CLAIM_READBACK_MISMATCH');
    }
    return state.claim;
  }

  async _appendReceipt(dispatchKey, fields, expectedKind) {
    assertNoCapability(fields);
    let created;
    try {
      created = await this.graph.request(`${this.receiptBase}/items`, {
        method: 'POST', scopes: GRAPH_SCOPES.lists, body: {fields},
      });
    } catch { fail('RECEIPT_OUTCOME_UNKNOWN'); }
    if (created.status !== 201 || !/^[1-9][0-9]*$/.test(String(created.data?.id ?? ''))) {
      fail('RECEIPT_OUTCOME_UNKNOWN');
    }
    const state = await this.getState(dispatchKey);
    const receipt = expectedKind === 'Draft' ? state?.draft : state?.sent;
    if (!receipt || receipt.id !== String(created.data.id) ||
        Object.entries(fields).some(([name, value]) => receipt.fields[name] !== value)) {
      fail('RECEIPT_READBACK_MISMATCH');
    }
    return state;
  }

  async appendDraft(claim, actor, draft, message) {
    const dispatchKey = claim.fields.DispatchKey;
    if (claim.fields.ActorOid.toLowerCase() !== actor.id ||
        message?.id !== draft.id) fail('DRAFT_CLAIM_MISMATCH');
    const customer = claim.fields.ActionKind === 'customer-tracker';
    if (customer && (draft.requiredLinks?.length !== 1 ||
        validatedCustomerTrackerUrl(draft.requiredLinks[0]) !==
          draft.requiredLinks[0])) fail('DRAFT_CLAIM_MISMATCH');
    const requiredLinks = customer ?
      [`sha256:${await sha256(draft.requiredLinks[0])}`] : draft.requiredLinks;
    const fields = {
      Title: receiptKey(dispatchKey, 'Draft'),
      ReceiptKey: receiptKey(dispatchKey, 'Draft'), DispatchKey: dispatchKey,
      Kind: 'Draft', ClaimItemId: claim.id, ActorOid: actor.id,
      DraftImmutableId: draft.id,
      IntendedSubject: draft.subject, IntendedToJson: JSON.stringify(draft.to),
      RequiredLinksJson: JSON.stringify(requiredLinks),
      IntendedBodySha256: await sha256(String(message.body?.content ?? '')),
      RecordedAtUtc: new Date(this.now()).toISOString(),
    };
    return this._appendReceipt(dispatchKey, fields, 'Draft');
  }

  async appendSent(state, actor, actual) {
    if (state?.sent || !state?.draft ||
        state.claim.fields.ActorOid.toLowerCase() !== actor.id) fail('SENT_CLAIM_MISMATCH');
    const dispatchKey = state.claim.fields.DispatchKey;
    const fields = {
      Title: receiptKey(dispatchKey, 'Sent'),
      ReceiptKey: receiptKey(dispatchKey, 'Sent'), DispatchKey: dispatchKey,
      Kind: 'Sent', ClaimItemId: state.claim.id, ActorOid: actor.id,
      DraftImmutableId: state.draft.fields.DraftImmutableId,
      SentImmutableId: actual.id,
      ActualSubject: `sha256:${await sha256(actual.subject)}`,
      ActualBodySha256: actual.bodySha256,
      ActualLinksSha256: actual.linksSha256,
      ActualToJson: JSON.stringify(actual.to),
      ActualCcJson: JSON.stringify(actual.cc),
      ActualBccJson: JSON.stringify(actual.bcc),
      SentAtUtc: actual.sentAtUtc,
      SentInternetMessageId: actual.internetMessageId,
      ReviewReason: sentReviewCode(actual.reviewReason),
      RecordedAtUtc: new Date(this.now()).toISOString(),
    };
    return this._appendReceipt(dispatchKey, fields, 'Sent');
  }
}
