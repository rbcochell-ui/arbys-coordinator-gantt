import {canonicalCustomerBody, canonicalFormSourceKey, email, GRAPH_SCOPES,
  HeldActionError, MAX_READ_WINDOW_MS, SITE_URL,
  validatedCustomerTrackerUrl} from './contract.mjs';

const TITLE = 'Arbys Customer Draft Releases';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const DAY = 24 * 60 * 60_000;
const OPTIONAL_DRAFT_FIELDS = new Set([
  'DraftMailbox', 'DraftMessageId', 'DraftWebLink', 'DraftRequestedAtUtc',
]);

// Exactly the observed operating 17-field schema. No Release List repair is
// implied by this source-only runtime. The owner-only Ready writer attests
// source, original FORM recipient and signed-out page review.
export const RELEASE_FIELDS = Object.freeze([
  'FormSourceKey', 'ReleaseState', 'ReleaseKind', 'PublishedCommit',
  'CiphertextSha256', 'ReleaseReceiptSha256', 'RecipientEmail',
  'DraftSubject', 'DraftBodyHtml', 'CustomerTrackingUrl', 'IssuedAtUtc',
  'ReadyUntilUtc', 'DraftState', 'DraftMailbox', 'DraftMessageId',
  'DraftWebLink', 'DraftRequestedAtUtc',
]);

function fail(code) { throw new HeldActionError(code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('RELEASE_VALUE_INVALID');
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('RELEASE_CRYPTO_UNAVAILABLE');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function timestamp(value, code) {
  if (typeof value !== 'string' || !UTC.test(value)) fail(code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(code);
  return ms;
}
function etagOf(item) { return item?.eTag ?? item?.['@odata.etag'] ?? null; }
function selected(item) {
  const etag = etagOf(item);
  const modifiedBy = item?.lastModifiedBy?.user?.id;
  const modifiedAt = item?.lastModifiedDateTime;
  if (!/^[1-9][0-9]*$/.test(String(item?.id ?? '')) ||
      typeof etag !== 'string' || !etag || !object(item?.fields) ||
      typeof modifiedBy !== 'string' || !GUID.test(modifiedBy) ||
      typeof modifiedAt !== 'string' || !UTC.test(modifiedAt)) {
    fail('RELEASE_ITEM_INCOMPLETE');
  }
  const fields = {};
  for (const name of RELEASE_FIELDS) {
    if (!Object.hasOwn(item.fields, name)) {
      if (!OPTIONAL_DRAFT_FIELDS.has(name)) fail('RELEASE_FIELD_MISSING');
      fields[name] = null;
    } else fields[name] = item.fields[name];
  }
  return {id: String(item.id), etag, fields,
    modifiedBy: modifiedBy.toLowerCase(), modifiedAt};
}
const empty = value => value === null || value === '' || value === undefined;

export class CustomerReleaseResolver {
  constructor({graph, config, now = () => Date.now()}) {
    if (typeof graph?.request !== 'function' || typeof graph?.getMe !== 'function') {
      throw new TypeError('Delegated Graph is required');
    }
    this.graph = graph;
    this.config = config;
    this.now = now;
    this.base = `/v1.0/sites/${encodeURIComponent(config.siteId)}/lists/${config.lists.customerReleases}`;
  }

  async _get(path) {
    let response;
    try { response = await this.graph.request(path, {scopes: GRAPH_SCOPES.lists}); }
    catch { fail('RELEASE_READ_UNCERTAIN'); }
    if (response?.status !== 200 || !object(response.data)) fail('RELEASE_READ_UNCERTAIN');
    return response.data;
  }

  async _assertList() {
    const list = await this._get(`${this.base}?$select=id,displayName,webUrl`);
    let url;
    try { url = new URL(list.webUrl); } catch { fail('RELEASE_LIST_IDENTITY_INVALID'); }
    if (String(list.id).toLowerCase() !== this.config.lists.customerReleases.toLowerCase() ||
        list.displayName !== TITLE || url.origin !== new URL(SITE_URL).origin ||
        !url.pathname.startsWith('/sites/ArbysOperations/')) {
      fail('RELEASE_LIST_IDENTITY_INVALID');
    }
    const columns = await this._get(
      `${this.base}/columns?$select=name,required,indexed,enforceUniqueValues,text&$top=200`);
    if (!Array.isArray(columns.value) || columns['@odata.nextLink']) {
      fail('RELEASE_COLUMNS_INCOMPLETE');
    }
    const byName = new Map(columns.value.map(c => [c?.name, c]));
    if (RELEASE_FIELDS.some(name => !byName.has(name))) fail('RELEASE_SCHEMA_INCOMPLETE');
    const key = byName.get('FormSourceKey');
    if (key?.required !== true || key?.indexed !== true ||
        key?.enforceUniqueValues !== true || !object(key?.text)) {
      fail('RELEASE_KEY_NOT_UNIQUE');
    }
  }

  async _exact(key) {
    const select = 'id,eTag,lastModifiedBy,lastModifiedDateTime';
    const query = new URLSearchParams({
      '$select': select, '$expand': `fields(select=${RELEASE_FIELDS.join(',')})`,
      '$filter': `fields/FormSourceKey eq '${key.replaceAll("'", "''")}'`,
      '$top': '2',
    });
    const result = await this._get(`${this.base}/items?${query}`);
    if (!Array.isArray(result.value) || result.value.length !== 1 ||
        result['@odata.nextLink']) fail('RELEASE_KEY_NOT_SINGLETON');
    const first = selected(result.value[0]);
    if (first.fields.FormSourceKey !== key) fail('RELEASE_KEY_MISMATCH');
    const direct = await this._get(`${this.base}/items/${first.id}?${new URLSearchParams({
      '$select': select, '$expand': `fields(select=${RELEASE_FIELDS.join(',')})`,
    })}`);
    const again = selected(direct);
    if (canonical(first) !== canonical(again)) fail('RELEASE_CHANGED_DURING_READ');
    return again;
  }

  async resolve(formSourceKey, actor, {allowOccupied = false} = {}) {
    const key = canonicalFormSourceKey(formSourceKey);
    const started = this.now();
    const me = await this.graph.getMe();
    if (actor?.id !== me.id || actor?.address !== me.address) fail('RELEASE_ACTOR_CHANGED');
    await this._assertList();
    const row = await this._exact(key);
    const f = row.fields;
    const nowMs = this.now();
    let trackerUrl;
    try { trackerUrl = validatedCustomerTrackerUrl(f.CustomerTrackingUrl); }
    catch { fail('RELEASE_TRACKER_URL_INVALID'); }
    if (f.ReleaseState !== 'Ready' ||
        !this.config.approvedCustomerReleaseKinds.includes(f.ReleaseKind) ||
        !COMMIT.test(f.PublishedCommit ?? '') ||
        !SHA.test(f.CiphertextSha256 ?? '') ||
        !SHA.test(f.ReleaseReceiptSha256 ?? '') ||
        !this.config.releaseOwnerOids.includes(row.modifiedBy) ||
        email(f.RecipientEmail) !== f.RecipientEmail ||
        f.DraftBodyHtml !== canonicalCustomerBody(trackerUrl) ||
        typeof f.DraftSubject !== 'string' ||
        !f.DraftSubject.trim() || f.DraftSubject !== f.DraftSubject.trim() ||
        f.DraftSubject.length > 255 || /[\r\n]/.test(f.DraftSubject) ||
        /https?:\/\//i.test(f.DraftSubject)) {
      fail('RELEASE_NOT_OWNER_APPROVED');
    }
    if (f.DraftState === 'NotRequested') {
      if (![f.DraftMailbox, f.DraftMessageId, f.DraftWebLink,
        f.DraftRequestedAtUtc].every(empty)) fail('RELEASE_DRAFT_STATE_CONFLICT');
    } else if (allowOccupied && f.DraftState === 'DraftReady') {
      if (email(f.DraftMailbox) !== actor.address ||
          typeof f.DraftMessageId !== 'string' || !f.DraftMessageId ||
          typeof f.DraftWebLink !== 'string' || !f.DraftWebLink) {
        fail('RELEASE_DRAFT_STATE_CONFLICT');
      }
    } else fail('RELEASE_DRAFT_STATE_CONFLICT');
    const issued = timestamp(f.IssuedAtUtc, 'RELEASE_TIME_INVALID');
    const modified = timestamp(row.modifiedAt, 'RELEASE_TIME_INVALID');
    const readyUntil = timestamp(f.ReadyUntilUtc, 'RELEASE_TIME_INVALID');
    if (issued > nowMs + 60_000 || nowMs - issued > DAY ||
        modified > nowMs + 60_000 || modified < issued ||
        readyUntil <= nowMs || readyUntil > issued + DAY) {
      fail('RELEASE_SOURCE_OR_PAGE_REVIEW_STALE');
    }
    if (this.now() - started > 2 * 60_000) fail('RELEASE_READ_TOO_SLOW');
    const validUntilMs = Math.min(nowMs + MAX_READ_WINDOW_MS,
      readyUntil, issued + DAY);
    if (validUntilMs <= nowMs) fail('RELEASE_WINDOW_EXPIRED');
    return Object.freeze({formSourceKey: key, entityId: key,
      recipientEmail: f.RecipientEmail, trackerUrl,
      subject: f.DraftSubject, htmlBody: f.DraftBodyHtml,
      digest: await sha256(canonical(row)),
      etagsJson: canonical({release: {itemId: row.id, etag: row.etag}}),
      validUntilMs,
      legacyDraftMessageId: f.DraftState === 'DraftReady' ? f.DraftMessageId : null,
      legacyDraftWebLink: f.DraftState === 'DraftReady' ? f.DraftWebLink : null});
  }

  async confirmUnchanged(previous, actor) {
    const current = await this.resolve(previous.formSourceKey, actor);
    if (current.digest !== previous.digest || current.etagsJson !== previous.etagsJson) {
      fail('RELEASE_CHANGED_AFTER_CLAIM');
    }
    return current;
  }
}
