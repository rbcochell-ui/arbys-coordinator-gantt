/**
 * Read-only Graph reader for the proposed owner-controlled Gantt Release List.
 * It makes no request until read() is called with a delegated Graph client.
 * Effective SharePoint ACLs and selected grants still require tenant readback.
 */
import {GRAPH_SCOPES} from '../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';

export const GANTT_RELEASE_TITLE = 'Arbys Coordinator Gantt Releases';
export const GANTT_RELEASE_KEY = 'arbys-coordinator-gantt:provider-snapshot';
export const GANTT_RELEASE_FIELDS = Object.freeze([
  'ReleaseKey', 'ReleaseState', 'DecryptedHtmlSha256',
  'EncryptedPayloadSha256', 'SnapshotAsOfDate', 'OverlayObservedAtUtc',
  'SourceReportSha256', 'ApprovedAtUtc', 'ValidUntilUtc',
  'ApprovedByOid', 'EncryptedPayloadUrl',
]);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SITE_ID = /^[^,]+,[0-9a-f-]{36},[0-9a-f-]{36}$/iu;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
const COLUMN_LENGTHS = Object.freeze({
  ReleaseKey: 128, DecryptedHtmlSha256: 64,
  EncryptedPayloadSha256: 64, SnapshotAsOfDate: 10,
  OverlayObservedAtUtc: 40, SourceReportSha256: 64,
  ApprovedAtUtc: 40, ValidUntilUtc: 40, ApprovedByOid: 36,
  EncryptedPayloadUrl: 255,
});

export class ReleaseReadHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseReadHeldError';
    this.code = code;
  }
}
function fail(code) { throw new ReleaseReadHeldError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value) {
  if (!object(value)) fail('RELEASE_RECORD_INVALID');
  return JSON.stringify([value.id, value.etag, value.modifiedBy,
    value.modifiedAt, ...GANTT_RELEASE_FIELDS.map(name => value.fields[name])]);
}
function itemRecord(item) {
  const etag = item?.eTag ?? item?.['@odata.etag'];
  const modifiedBy = item?.lastModifiedBy?.user?.id;
  const modifiedAt = item?.lastModifiedDateTime;
  if (!/^[1-9][0-9]*$/u.test(String(item?.id ?? '')) ||
      typeof etag !== 'string' || !etag || !object(item?.fields) ||
      typeof modifiedBy !== 'string' || !GUID.test(modifiedBy) ||
      typeof modifiedAt !== 'string' || !UTC.test(modifiedAt) ||
      !Number.isFinite(Date.parse(modifiedAt)) ||
      GANTT_RELEASE_FIELDS.some(name =>
        !Object.hasOwn(item.fields, name) ||
        typeof item.fields[name] !== 'string')) {
    fail('RELEASE_ROW_INCOMPLETE');
  }
  const fields = Object.fromEntries(GANTT_RELEASE_FIELDS.map(name =>
    [name, item.fields[name]]));
  return Object.freeze({id: String(item.id), etag,
    modifiedBy: modifiedBy.toLowerCase(), modifiedAt,
    fields: Object.freeze(fields)});
}

/**
 * The bound Graph object must use Lists.SelectedOperations.Selected for reads.
 * This class validates List identity, exact columns and singleton row every
 * time; it cannot prove the tenant's effective ACL or that an app grant is
 * selected-only. Those are deployment gates, not booleans in a public page.
 */
export class GanttReleaseReader {
  constructor({graph, siteId, listId, siteUrl, payloadUrl}) {
    if (typeof graph?.request !== 'function' || !SITE_ID.test(siteId ?? '') ||
        !GUID.test(listId ?? '') || typeof siteUrl !== 'string' ||
        typeof payloadUrl !== 'string') {
      throw new TypeError('Bound delegated Graph and exact Release List policy are required');
    }
    let site, payload;
    try { site = new URL(siteUrl); payload = new URL(payloadUrl); }
    catch { throw new TypeError('Exact HTTPS policy URLs are required'); }
    if (site.protocol !== 'https:' || payload.protocol !== 'https:' ||
        site.username || site.password || payload.username || payload.password ||
        site.hash || site.search || payload.hash || payload.search ||
        site.href !== siteUrl || payload.href !== payloadUrl) {
      throw new TypeError('Exact HTTPS policy URLs are required');
    }
    this.graph = graph;
    this.siteId = siteId;
    this.listId = listId.toLowerCase();
    this.siteUrl = siteUrl;
    this.payloadUrl = payloadUrl;
    this.base = `/v1.0/sites/${encodeURIComponent(siteId)}/lists/${listId}`;
  }

  async _get(path) {
    let response;
    try {
      response = await this.graph.request(path, {scopes: GRAPH_SCOPES.lists});
    } catch { fail('GANTT_RELEASE_READ_UNCERTAIN'); }
    if (response?.status !== 200 || !object(response.data)) {
      fail('GANTT_RELEASE_READ_UNCERTAIN');
    }
    return response.data;
  }

  async _assertStructure() {
    const list = await this._get(`${this.base}?$select=id,displayName,webUrl`);
    let web;
    try { web = new URL(list.webUrl); }
    catch { fail('GANTT_RELEASE_LIST_IDENTITY_INVALID'); }
    const site = new URL(this.siteUrl);
    const sitePath = site.pathname.replace(/\/$/u, '');
    if (String(list.id).toLowerCase() !== this.listId ||
        list.displayName !== GANTT_RELEASE_TITLE ||
        web.origin !== site.origin ||
        !web.pathname.startsWith(`${sitePath}/`)) {
      fail('GANTT_RELEASE_LIST_IDENTITY_INVALID');
    }
    const columns = await this._get(`${this.base}/columns?` +
      '$select=name,required,indexed,enforceUniqueValues,text,choice&$top=200');
    if (!Array.isArray(columns.value) || columns['@odata.nextLink']) {
      fail('GANTT_RELEASE_COLUMNS_INCOMPLETE');
    }
    const names = new Map();
    for (const column of columns.value) {
      if (typeof column?.name !== 'string' || names.has(column.name)) {
        fail('GANTT_RELEASE_COLUMNS_INCOMPLETE');
      }
      names.set(column.name, column);
    }
    for (const name of ['Title', ...GANTT_RELEASE_FIELDS]) {
      if (names.get(name)?.required !== true) fail('GANTT_RELEASE_SCHEMA_UNVERIFIED');
    }
    for (const [name, maxLength] of Object.entries(COLUMN_LENGTHS)) {
      if (names.get(name)?.text?.maxLength !== maxLength) {
        fail('GANTT_RELEASE_SCHEMA_UNVERIFIED');
      }
    }
    const key = names.get('ReleaseKey');
    const choices = names.get('ReleaseState')?.choice?.choices;
    if (key.indexed !== true || key.enforceUniqueValues !== true ||
        !object(names.get('Title')?.text) ||
        !Array.isArray(choices) ||
        JSON.stringify([...new Set(choices)].sort()) !==
          JSON.stringify(['Approved', 'Revoked'])) {
      fail('GANTT_RELEASE_SCHEMA_UNVERIFIED');
    }
  }

  async read() {
    await this._assertStructure();
    const select = 'id,eTag,lastModifiedBy,lastModifiedDateTime';
    const query = new URLSearchParams({
      '$select': select,
      '$expand': `fields(select=${GANTT_RELEASE_FIELDS.join(',')})`,
      '$top': '2',
    });
    // This unfiltered read also rejects any second row with a different key.
    const rows = await this._get(`${this.base}/items?${query}`);
    if (!Array.isArray(rows.value) || rows.value.length !== 1 ||
        rows['@odata.nextLink']) fail('GANTT_RELEASE_NOT_SINGLETON');
    const first = itemRecord(rows.value[0]);
    if (first.fields.ReleaseKey !== GANTT_RELEASE_KEY) {
      fail('GANTT_RELEASE_KEY_MISMATCH');
    }
    const direct = itemRecord(await this._get(`${this.base}/items/${first.id}?` +
      new URLSearchParams({'$select': select,
        '$expand': `fields(select=${GANTT_RELEASE_FIELDS.join(',')})`})));
    if (canonical(first) !== canonical(direct)) {
      fail('GANTT_RELEASE_CHANGED_DURING_READ');
    }
    return Object.freeze({...direct, listId: this.listId,
      siteId: this.siteId, payloadUrl: this.payloadUrl});
  }
}
