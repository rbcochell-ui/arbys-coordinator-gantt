import {assertEligibleStatus, canonicalSalesforceId, email, GRAPH_SCOPES,
  HeldActionError, MAX_CONTACT_CHECK_AGE_MS, MAX_CONTACT_REVIEW_AGE_MS,
  MAX_READ_WINDOW_MS, MAX_SOURCE_AGE_MS, SITE_URL} from './contract.mjs';

const SHA = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const WO_TITLE = 'Arbys Provider Parts WO Action Source';
const CONTACT_TITLE = 'Arbys Provider Parts Verified Contacts';
export const WO_FIELDS = Object.freeze([
  'NativeWorkOrderId', 'SourceComplete', 'SourceObservedAtUtc',
  'SourceRevision', 'NormalizedVisitKind',
  'ActivityType', 'WorkOrderType', 'WorkOrderStatus', 'ServiceTypeCode',
  'AssignedAgentCode', 'OutletACN', 'StoreNumber', 'ServiceAddressKey',
  'WorkOrderNumber',
]);
// These enrich the current-source read when present. They are not coordinator
// authorization fields; Thirsty Owner is a Gantt display/filter value.
export const WO_OPTIONAL_FIELDS = Object.freeze([
  'ThirstyOwnerFullName', 'AssignedCoordinatorEmail',
  'OwnerBindingRevision', 'RawSPStatus', 'SourceHoldFlag',
]);
export const CONTACT_FIELDS = Object.freeze([
  'ContactKey', 'AgentCode', 'OutletACN', 'StoreNumber', 'ServiceAddressKey',
  'InstallManagerEmail', 'PlannerEmail', 'Verified', 'VerifiedAtUtc',
  'SourceCheckedAtUtc', 'SourceEvidenceDigest',
]);

function fail(code) { throw new HeldActionError(code); }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('SOURCE_VALUE_INVALID');
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('SOURCE_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function timestamp(value, code) {
  if (typeof value !== 'string' || !UTC.test(value)) fail(code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(code);
  return ms;
}
function fresh(ms, nowMs, maxAgeMs, code) {
  if (ms > nowMs + 60_000 || nowMs - ms > maxAgeMs) fail(code);
}
function itemEtag(item) { return item?.eTag ?? item?.['@odata.etag'] ?? null; }
function listPath(siteId, listId) {
  return `/v1.0/sites/${encodeURIComponent(siteId)}/lists/${listId}`;
}
function selected(item, names, optionalNames = []) {
  const fields = {};
  if (!plainObject(item?.fields) || !/^[1-9][0-9]*$/.test(String(item.id ?? '')) ||
      typeof itemEtag(item) !== 'string' || !itemEtag(item)) fail('SOURCE_ITEM_INCOMPLETE');
  for (const name of names) {
    if (!Object.hasOwn(item.fields, name)) {
      if (!optionalNames.includes(name)) fail('SOURCE_FIELD_MISSING');
      fields[name] = null;
    } else fields[name] = item.fields[name];
  }
  return {id: String(item.id), etag: itemEtag(item), fields};
}

export class ProviderSourceResolver {
  constructor({graph, config, now = () => Date.now()}) {
    if (typeof graph?.request !== 'function' || typeof graph?.getMe !== 'function') {
      throw new TypeError('Delegated Graph is required');
    }
    this.graph = graph;
    this.config = config;
    this.now = now;
  }

  withGraph(graph) { return new ProviderSourceResolver({graph, config: this.config, now: this.now}); }

  async _get(path) {
    let r;
    try { r = await this.graph.request(path, {scopes: GRAPH_SCOPES.lists}); }
    catch { fail('SOURCE_READ_UNCERTAIN'); }
    if (r?.status !== 200 || !plainObject(r.data)) fail('SOURCE_READ_UNCERTAIN');
    return r.data;
  }

  async _assertList(listId, expectedTitle, key) {
    const base = listPath(this.config.siteId, listId);
    const list = await this._get(`${base}?$select=id,displayName,webUrl`);
    let webUrl;
    try { webUrl = new URL(list.webUrl); } catch { fail('SOURCE_LIST_IDENTITY_INVALID'); }
    if (String(list.id).toLowerCase() !== listId.toLowerCase() ||
        list.displayName !== expectedTitle || webUrl.origin !== new URL(SITE_URL).origin ||
        !webUrl.pathname.startsWith('/sites/ArbysOperations/')) {
      fail('SOURCE_LIST_IDENTITY_INVALID');
    }
    const columns = await this._get(
      `${base}/columns?$select=name,required,indexed,enforceUniqueValues,text&$top=200`);
    if (!Array.isArray(columns.value) || columns['@odata.nextLink']) {
      fail('SOURCE_COLUMNS_INCOMPLETE');
    }
    const keyColumn = columns.value.filter(column => column?.name === key);
    if (keyColumn.length !== 1 || keyColumn[0].required !== true ||
        keyColumn[0].indexed !== true ||
        keyColumn[0].enforceUniqueValues !== true ||
        !plainObject(keyColumn[0].text)) fail('SOURCE_KEY_NOT_UNIQUE');
    return base;
  }

  async _exactItem(base, key, value, names,
    {allowAbsent = false, optionalNames = []} = {}) {
    const query = new URLSearchParams({
      '$select': 'id,eTag', '$expand': `fields(select=${names.join(',')})`,
      '$filter': `fields/${key} eq '${value.replaceAll("'", "''")}'`, '$top': '2',
    });
    const result = await this._get(`${base}/items?${query}`);
    if (!Array.isArray(result.value) || result.value.length > 1 ||
        result['@odata.nextLink']) fail('SOURCE_KEY_NOT_SINGLETON');
    if (result.value.length === 0) {
      if (allowAbsent) return null;
      fail('SOURCE_KEY_NOT_SINGLETON');
    }
    const first = selected(result.value[0], names, optionalNames);
    if (first.fields[key] !== value) fail('SOURCE_KEY_MISMATCH');
    const direct = await this._get(`${base}/items/${first.id}?${new URLSearchParams({
      '$select': 'id,eTag', '$expand': `fields(select=${names.join(',')})`,
    })}`);
    const again = selected(direct, names, optionalNames);
    if (first.id !== again.id || first.etag !== again.etag ||
        canonical(first.fields) !== canonical(again.fields)) fail('SOURCE_CHANGED_DURING_READ');
    return again;
  }

  async resolve(nativeWoId, actor) {
    const id = canonicalSalesforceId(nativeWoId);
    const started = this.now();
    const me = await this.graph.getMe();
    if (actor?.id !== me.id || actor?.address !== me.address) fail('SOURCE_ACTOR_CHANGED');
    const woBase = await this._assertList(this.config.lists.woSource,
      WO_TITLE, 'NativeWorkOrderId');
    const contactBase = await this._assertList(this.config.lists.verifiedContacts,
      CONTACT_TITLE, 'ContactKey');
    const wo = await this._exactItem(woBase, 'NativeWorkOrderId', id,
      [...WO_FIELDS, ...WO_OPTIONAL_FIELDS], {optionalNames: WO_OPTIONAL_FIELDS});
    const w = wo.fields;
    if (w.NativeWorkOrderId !== id || w.SourceComplete !== true ||
        w.NormalizedVisitKind !== 'Install' || w.ActivityType !== 'Installation' ||
        !this.config.eligibleWorkOrderTypes.includes(w.WorkOrderType) ||
        !/^[A-Z0-9]{1,3}$/.test(w.ServiceTypeCode ?? '') ||
        !this.config.eligibleServiceTypeCodes.includes(w.ServiceTypeCode) ||
        !SHA.test(w.SourceRevision ?? '') ||
        !/^[A-Z][A-Z0-9]{0,9}$/.test(w.AssignedAgentCode ?? '') ||
        !/^[0-9]{5,12}$/.test(w.WorkOrderNumber ?? '') ||
        !/^[0-9]+$/.test(w.OutletACN ?? '') ||
        /^0+$/.test(w.OutletACN) ||
        !/^[0-9]+$/.test(w.StoreNumber ?? '') ||
        /^0+$/.test(w.StoreNumber) ||
        typeof w.ServiceAddressKey !== 'string' || !w.ServiceAddressKey.trim()) {
      fail('WO_NOT_CURRENTLY_DRAFT_READY');
    }
    assertEligibleStatus(w, this.config);
    // The installed List stores a DateTime at minute precision. That older
    // rounded timestamp makes the 24-hour gate conservative; do not invent an
    // absent second ISO field or extend freshness from a later copy time.
    const observed = timestamp(w.SourceObservedAtUtc, 'WO_OBSERVATION_INVALID');
    const nowMs = this.now();
    fresh(observed, nowMs, MAX_SOURCE_AGE_MS, 'WO_OBSERVATION_STALE');
    const normalize = value => value.replace(/^0+/, '') || '0';
    const sameNumeric = (left, right) => typeof left === 'string' &&
      /^[0-9]+$/.test(left) && normalize(left) === normalize(right);
    const contactKey = await sha256Hex(canonical([
      w.AssignedAgentCode, normalize(w.OutletACN), normalize(w.StoreNumber),
    ]));
    const contact = await this._exactItem(contactBase, 'ContactKey', contactKey,
      CONTACT_FIELDS, {allowAbsent: true});
    let to = [];
    let verified = null;
    let checked = null;
    let recipientEvidence = 'manual_entry';
    if (contact) {
      const c = contact.fields;
      // A present, contradictory row is not an invitation to use its emails
      // or to create a blank-To draft. The unique key, location, and source
      // digest must agree before either verified or suggested prefill.
      if (c.ContactKey !== contactKey || c.AgentCode !== w.AssignedAgentCode ||
          !sameNumeric(c.OutletACN, w.OutletACN) ||
          !sameNumeric(c.StoreNumber, w.StoreNumber) ||
          c.ServiceAddressKey !== w.ServiceAddressKey ||
          !SHA.test(c.SourceEvidenceDigest ?? '') ||
          typeof c.Verified !== 'boolean') fail('CONTACT_JOIN_CONFLICT');
      let pair;
      try { pair = [email(c.InstallManagerEmail), email(c.PlannerEmail)]; }
      catch { fail('CONTACT_PAIR_INVALID'); }
      // Both roles may use one shared inbox. Preserve two-role evidence and
      // address that mailbox only once.
      const audience = [...new Set(pair)];
      if (c.Verified === false && c.VerifiedAtUtc != null &&
          c.VerifiedAtUtc !== '') fail('CONTACT_REVIEW_STATE_CONFLICT');
      try {
        const sourceCheckedAt = timestamp(c.SourceCheckedAtUtc,
          'CONTACT_SOURCE_CHECK_INVALID');
        if (c.Verified === true) {
          const reviewedAt = timestamp(c.VerifiedAtUtc,
            'CONTACT_VERIFICATION_INVALID');
          if (sourceCheckedAt < reviewedAt) fail('CONTACT_REVIEW_STATE_CONFLICT');
          fresh(reviewedAt, nowMs, MAX_CONTACT_REVIEW_AGE_MS,
            'CONTACT_VERIFICATION_STALE');
          fresh(sourceCheckedAt, nowMs, MAX_CONTACT_CHECK_AGE_MS,
            'CONTACT_SOURCE_CHECK_STALE');
          to = audience;
          verified = reviewedAt;
          checked = sourceCheckedAt;
          recipientEvidence = 'verified_pair';
        } else {
          // Workbook-corroborated contacts may be suggested for one day after
          // a protected source check. The coordinator verifies them in Outlook
          // before Send; the draft is never sent by this route.
          fresh(sourceCheckedAt, nowMs, MAX_SOURCE_AGE_MS,
            'CONTACT_SUGGESTION_STALE');
          to = audience;
          checked = sourceCheckedAt;
          recipientEvidence = 'suggested_pair';
        }
      } catch (error) {
        if (error?.code === 'CONTACT_REVIEW_STATE_CONFLICT') throw error;
        // Missing or stale review data cannot prefill; blank To remains the
        // guarded manual-entry route when its canary is enabled.
      }
    }
    if (to.length === 0 && this.config.emptyToDraftCanaryPassed !== true) {
      fail('RECIPIENT_REVIEW_DRAFT_NOT_CANARIED');
    }
    if (nowMs - started > 2 * 60_000) fail('SOURCE_READ_TOO_SLOW');
    const validUntilMs = Math.min(nowMs + MAX_READ_WINDOW_MS,
      observed + MAX_SOURCE_AGE_MS,
      ...(verified === null ? [] : [verified + MAX_CONTACT_REVIEW_AGE_MS]),
      ...(checked === null ? [] : [checked +
        (recipientEvidence === 'suggested_pair' ? MAX_SOURCE_AGE_MS :
          MAX_CONTACT_CHECK_AGE_MS)]));
    if (validUntilMs <= nowMs) fail('SOURCE_WINDOW_EXPIRED');
    const etags = Object.freeze({
      wo: {itemId: wo.id, etag: wo.etag},
      contact: contact ? {itemId: contact.id, etag: contact.etag} :
        {state: 'absent', lookupKey: contactKey},
      recipientEvidence,
    });
    const digest = await sha256Hex(canonical({wo, contact, contactKey}));
    return Object.freeze({nativeWoId: id, woNumber: w.WorkOrderNumber,
      storeNumber: w.StoreNumber, outletAcn: w.OutletACN,
      normalizedVisitKind: w.NormalizedVisitKind,
      workOrderType: w.WorkOrderType,
      serviceTypeCode: w.ServiceTypeCode,
      workOrderStatus: w.WorkOrderStatus,
      thirstyOwner: w.ThirstyOwnerFullName || null,
      agentCode: w.AssignedAgentCode,
      serviceAddressKey: w.ServiceAddressKey,
      to: Object.freeze(to), recipientEvidence,
      recipientReviewRequired: recipientEvidence !== 'verified_pair', digest,
      sharedMailboxVerified: to.length === 1 && verified !== null,
      etagsJson: canonical(etags), observedAtUtc: w.SourceObservedAtUtc,
      validUntilMs});
  }

  async confirmUnchanged(previous, actor) {
    const current = await this.resolve(previous.nativeWoId, actor);
    if (current.digest !== previous.digest || current.etagsJson !== previous.etagsJson) {
      fail('SOURCE_CHANGED_AFTER_CLAIM');
    }
    return current;
  }
}
