/**
 * Source-only, read-only Graph transport for provider V5's protected linkage.
 * The caller supplies a delegated, account-pinned Graph client and exact IDs.
 * This module never writes, creates a draft, sends mail, or grants access.
 */
import {GRAPH_SCOPES} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';

export const EVIDENCE_LIST_TITLE = 'Arbys Coordinator Linkage Evidence';
export const RELEASE_LIST_TITLE = 'Arbys Coordinator Gantt Releases';
export const EVIDENCE_KEY = 'arbys-coordinator-gantt:linkage-evidence';
export const RELEASE_KEY = 'arbys-coordinator-gantt:provider-snapshot';
export const SITE_URL = 'https://groups.coca-cola.com/sites/ArbysOperations';

const SITE_ID = /^[^,]+,[0-9a-f-]{36},[0-9a-f-]{36}$/iu;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NATIVE_WO = /^0WO[A-Za-z0-9]{15}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
const MAX_EVIDENCE_BYTES = 60_000;
const MAX_APPROVAL_BYTES = 2_000;

export class ProtectedLinkageReadHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProtectedLinkageReadHeldError';
    this.code = code;
  }
}
function fail(code) { throw new ProtectedLinkageReadHeldError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validUtc(value) {
  return typeof value === 'string' && UTC.test(value) &&
    Number.isFinite(Date.parse(value));
}
function exactKeys(value, names) {
  return object(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
}
function itemProjection(item, names) {
  const id = String(item?.id ?? '');
  const etag = item?.eTag ?? item?.['@odata.etag'];
  const modifiedByOid = item?.lastModifiedBy?.user?.id;
  const modifiedAtUtc = item?.lastModifiedDateTime;
  if (!/^[1-9][0-9]*$/u.test(id) || typeof etag !== 'string' || !etag ||
      !GUID.test(modifiedByOid ?? '') || !validUtc(modifiedAtUtc) ||
      !object(item?.fields) || names.some(name =>
        typeof item.fields[name] !== 'string')) {
    fail('LINKAGE_ITEM_INCOMPLETE');
  }
  return Object.freeze({id, etag, modifiedByOid: modifiedByOid.toLowerCase(),
    modifiedAtUtc, fields: Object.freeze(Object.fromEntries(names.map(name =>
      [name, item.fields[name]])))});
}
function identical(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Both callbacks make independent, uncached Graph reads. A fixed one-row
 * Evidence List and the separate Gantt Release singleton are pinned by GUID,
 * title, key, site, ETag, and current owner modifier on every invocation.
 */
export function createProtectedLinkageGraphReaders({graph, siteId, siteUrl,
    evidenceListId, releaseListId, coordinatorOids, ownerOids} = {}) {
  if (typeof graph?.request !== 'function' || typeof graph?.getMe !== 'function' ||
      !SITE_ID.test(siteId ?? '') || !GUID.test(evidenceListId ?? '') ||
      !GUID.test(releaseListId ?? '') ||
      evidenceListId.toLowerCase() === releaseListId.toLowerCase() ||
      !Array.isArray(coordinatorOids) || !coordinatorOids.length ||
      !coordinatorOids.every(oid => GUID.test(oid)) ||
      !Array.isArray(ownerOids) || !ownerOids.length ||
      !ownerOids.every(oid => GUID.test(oid))) {
    throw new TypeError('Pinned delegated Graph and separate protected List IDs required');
  }
  let site;
  try { site = new URL(siteUrl); }
  catch { throw new TypeError('Exact HTTPS site URL required'); }
  if (site.protocol !== 'https:' || site.username || site.password ||
      site.search || site.hash || site.href !== SITE_URL) {
    throw new TypeError('Exact HTTPS site URL required');
  }
  const coordinators = new Set(coordinatorOids.map(oid => oid.toLowerCase()));
  const owners = new Set(ownerOids.map(oid => oid.toLowerCase()));
  const sitePath = site.pathname.replace(/\/$/u, '');
  let pinnedActorOid = null;

  async function get(path) {
    let response;
    try { response = await graph.request(path, {scopes: GRAPH_SCOPES.lists}); }
    catch { fail('LINKAGE_GRAPH_READ_UNCERTAIN'); }
    if (response?.status !== 200 || !object(response.data)) {
      fail('LINKAGE_GRAPH_READ_UNCERTAIN');
    }
    return response.data;
  }
  async function actor() {
    let current;
    try { current = await graph.getMe(); }
    catch { fail('LINKAGE_ACTOR_UNVERIFIED'); }
    const oid = current?.id?.toLowerCase?.();
    if (!GUID.test(oid ?? '') || !coordinators.has(oid) ||
        (pinnedActorOid !== null && pinnedActorOid !== oid)) {
      fail('LINKAGE_ACTOR_UNVERIFIED');
    }
    pinnedActorOid = oid;
  }
  async function singleton(listId, title, fields, expectedKey) {
    await actor();
    const base = `/v1.0/sites/${encodeURIComponent(siteId)}/lists/${listId}`;
    const list = await get(`${base}?$select=id,displayName,webUrl`);
    let url;
    try { url = new URL(list.webUrl); }
    catch { fail('LINKAGE_LIST_IDENTITY_INVALID'); }
    if (String(list.id ?? '').toLowerCase() !== listId.toLowerCase() ||
        list.displayName !== title || url.origin !== site.origin ||
        !url.pathname.startsWith(`${sitePath}/`)) {
      fail('LINKAGE_LIST_IDENTITY_INVALID');
    }
    const select = 'id,eTag,lastModifiedBy,lastModifiedDateTime';
    const query = new URLSearchParams({'$select': select,
      '$expand': `fields(select=${fields.join(',')})`, '$top': '2'});
    const rows = await get(`${base}/items?${query}`);
    if (!Array.isArray(rows.value) || rows.value.length !== 1 ||
        rows['@odata.nextLink']) fail('LINKAGE_LIST_NOT_SINGLETON');
    const first = itemProjection(rows.value[0], fields);
    if (first.fields[fields[0]] !== expectedKey ||
        !owners.has(first.modifiedByOid)) {
      fail('LINKAGE_OWNER_OR_KEY_UNVERIFIED');
    }
    const direct = itemProjection(await get(`${base}/items/${first.id}?` +
      new URLSearchParams({'$select': select,
        '$expand': `fields(select=${fields.join(',')})`})), fields);
    if (!identical(first, direct)) fail('LINKAGE_CHANGED_DURING_READ');
    return direct;
  }
  function selected(id) {
    if (!NATIVE_WO.test(id ?? '')) fail('LINKAGE_NATIVE_WO_REQUIRED');
  }
  async function readCurrentProtectedLinkageEvidenceJson(id) {
    selected(id);
    const record = await singleton(evidenceListId, EVIDENCE_LIST_TITLE,
      ['EvidenceKey', 'EvidenceJson'], EVIDENCE_KEY);
    const json = record.fields.EvidenceJson;
    const size = new TextEncoder().encode(json).length;
    if (!size || size > MAX_EVIDENCE_BYTES) fail('LINKAGE_EVIDENCE_SIZE_INVALID');
    let packet;
    try { packet = JSON.parse(json); }
    catch { fail('LINKAGE_EVIDENCE_INVALID'); }
    if (!object(packet) ||
        packet.schema !== 'ArbysReviewedLinkageEvidence/v1' ||
        !validUtc(packet.observedAtUtc) ||
        !Array.isArray(packet.projects) ||
        !Array.isArray(packet.linkageRows) ||
        !Array.isArray(packet.directoryRows)) {
      fail('LINKAGE_EVIDENCE_INVALID');
    }
    let selectedCount = 0;
    for (const project of packet.projects) {
      if (!object(project) || !Array.isArray(project.cases)) {
        fail('LINKAGE_EVIDENCE_INVALID');
      }
      for (const oneCase of project.cases) {
        if (!object(oneCase) || !Array.isArray(oneCase.workOrders)) {
          fail('LINKAGE_EVIDENCE_INVALID');
        }
        selectedCount += oneCase.workOrders.filter(wo =>
          wo?.nativeWorkOrderId === id).length;
      }
    }
    if (selectedCount !== 1) fail('LINKAGE_SELECTED_WO_NOT_SINGLETON');
    return json;
  }
  async function readCurrentProtectedLinkageOwnerApproval(id) {
    selected(id);
    const record = await singleton(releaseListId, RELEASE_LIST_TITLE,
      ['ReleaseKey', 'ReleaseState', 'LinkageApprovalJson'], RELEASE_KEY);
    if (record.fields.ReleaseState !== 'Approved') {
      fail('LINKAGE_RELEASE_NOT_APPROVED');
    }
    const json = record.fields.LinkageApprovalJson;
    const size = new TextEncoder().encode(json).length;
    if (!size || size > MAX_APPROVAL_BYTES) fail('LINKAGE_APPROVAL_SIZE_INVALID');
    let approval;
    try { approval = JSON.parse(json); }
    catch { fail('LINKAGE_APPROVAL_INVALID'); }
    const names = ['schema', 'payloadSha256', 'observedAtUtc',
      'approvedAtUtc', 'validUntilUtc', 'approvedByOid'];
    if (!exactKeys(approval, names) ||
        approval.schema !== 'ArbysLinkageOwnerApproval/v1' ||
        !SHA.test(approval.payloadSha256 ?? '') ||
        !validUtc(approval.observedAtUtc) ||
        !validUtc(approval.approvedAtUtc) ||
        !validUtc(approval.validUntilUtc) ||
        !GUID.test(approval.approvedByOid ?? '') ||
        approval.approvedByOid.toLowerCase() !== record.modifiedByOid) {
      fail('LINKAGE_APPROVAL_INVALID');
    }
    return Object.freeze({...approval,
      approvedByOid: approval.approvedByOid.toLowerCase(),
      modifiedByOid: record.modifiedByOid,
      modifiedAtUtc: record.modifiedAtUtc,
      etag: record.etag});
  }
  return Object.freeze({readCurrentProtectedLinkageEvidenceJson,
    readCurrentProtectedLinkageOwnerApproval});
}
