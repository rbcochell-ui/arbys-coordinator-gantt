import {canonicalFormSourceKey, canonicalSalesforceId,
  customerDispatchKey, GRAPH_SCOPES, HeldActionError,
  providerDispatchKey} from './contract.mjs';

// The public runtime contains no historical work-order or FORM identifier.
// Only a reviewed, owner-signed receipt on the restricted Gantt Release List
// may tell a coordinator which historical keys remain occupied.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/;
const ITEM_ID = /^[1-9][0-9]*$/;
const REF = /^[A-Za-z0-9._:-]{1,128}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const PROOF_SCHEMA = 'legacy-complete-inventory/v3';
const APPROVAL_SCHEMA = 'legacy-complete-inventory-approval/v3';
const MAX_PROOF_CHARS = 16_000;
const MAX_APPROVAL_CHARS = 2_000;
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const verifiedProofs = new WeakMap();
const verifiedLoaders = new WeakSet();

function fail() { throw new HeldActionError('LEGACY_FENCE_UNVERIFIED'); }
const object = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);

function keys(value, names) {
  if (!object(value) || JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...names].sort())) fail();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, stable(value[key])]));
  if (value === null || typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return value;
  fail();
}

function canonical(value) { return JSON.stringify(stable(value)); }

async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail();
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function dateMs(value) {
  if (typeof value !== 'string' || !UTC.test(value)) fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail();
  return ms;
}

function exactKey(value) {
  try {
    if (typeof value === 'string' && value.startsWith('provider-parts:')) {
      const id = canonicalSalesforceId(value.slice('provider-parts:'.length));
      if (providerDispatchKey(id) === value) return value;
    }
    if (typeof value === 'string' && value.startsWith('customer-tracker:')) {
      const id = canonicalFormSourceKey(value.slice('customer-tracker:'.length));
      if (customerDispatchKey(id) === value) return value;
    }
  } catch { fail(); }
  fail();
}

function site(config) {
  if (!object(config) || !GUID.test(config.releaseListId ?? '') ||
      !ITEM_ID.test(String(config.releaseItemId ?? '')) ||
      typeof config.releaseListTitle !== 'string' ||
      !config.releaseListTitle ||
      typeof config.releaseKey !== 'string' || !config.releaseKey ||
      typeof config.siteId !== 'string' ||
      !Array.isArray(config.ownerOids) || !config.ownerOids.length ||
      !config.ownerOids.every(oid => GUID.test(oid)) ||
      new Set(config.ownerOids.map(oid => oid.toLowerCase())).size !==
        config.ownerOids.length ||
      !Array.isArray(config.expectedSources) ||
      config.expectedSources.length < 3 ||
      !config.expectedSources.every(source => object(source) &&
        Object.keys(source).sort().join(',') === 'listId,title' &&
        GUID.test(source.listId) && typeof source.title === 'string' &&
        source.title.length > 0 && source.title.length <= 255) ||
      new Set(config.expectedSources.map(source =>
        source.listId.toLowerCase())).size !== config.expectedSources.length ||
      !object(config.expectedPilotLists) ||
      !GUID.test(config.expectedPilotLists.provider ?? '') ||
      !GUID.test(config.expectedPilotLists.customer ?? '') ||
      config.expectedPilotLists.provider.toLowerCase() ===
        config.expectedPilotLists.customer.toLowerCase() ||
      !config.expectedSources.some(source => source.listId.toLowerCase() ===
        config.expectedPilotLists.provider.toLowerCase()) ||
      !config.expectedSources.some(source => source.listId.toLowerCase() ===
        config.expectedPilotLists.customer.toLowerCase()) ||
      !Array.isArray(config.expectedWriterIds) ||
      !config.expectedWriterIds.length ||
      !config.expectedWriterIds.every(id => GUID.test(id)) ||
      new Set(config.expectedWriterIds.map(id => id.toLowerCase())).size !==
        config.expectedWriterIds.length ||
      !object(config.signingPublicJwk) ||
      config.signingPublicJwk.kty !== 'EC' ||
      config.signingPublicJwk.crv !== 'P-256' ||
      !B64URL.test(config.signingPublicJwk.x ?? '') ||
      !B64URL.test(config.signingPublicJwk.y ?? '') ||
      Object.hasOwn(config.signingPublicJwk, 'd')) fail();
  let url;
  try { url = new URL(config.siteUrl); } catch { fail(); }
  const parts = config.siteId.split(',');
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.hash || url.href !== config.siteUrl ||
      parts.length !== 3 || parts[0] !== url.hostname ||
      !GUID.test(parts[1]) || !GUID.test(parts[2])) fail();
  return url;
}

function parseJson(value, maxLength) {
  if (typeof value !== 'string' || value.length < 2 ||
      value.length > maxLength) fail();
  try { return JSON.parse(value); } catch { fail(); }
}

function pilotRow(value, kind, sources) {
  keys(value, ['listId', 'title', 'itemId', 'dispatchKey',
    'graphEtag']);
  if (!GUID.test(value.listId ?? '') ||
      !ITEM_ID.test(String(value.itemId ?? '')) ||
      typeof value.title !== 'string' || !value.title ||
      value.title.length > 255 ||
      typeof value.graphEtag !== 'string' || !value.graphEtag ||
      value.graphEtag.length > 512 ||
      exactKey(value.dispatchKey) !== value.dispatchKey ||
      !value.dispatchKey.startsWith(`${kind}:`) ||
      !sources.some(source => source.listId.toLowerCase() ===
        value.listId.toLowerCase() && source.title === value.title &&
        source.rowCount >= 1)) fail();
}

function proofShape(proof, config, nowMs) {
  keys(proof, ['schema', 'siteId', 'siteUrl', 'issuedAtUtc',
    'validUntilUtc', 'allPagesRead', 'sourcesComplete',
    'inventoryEvidenceSha256', 'reviewReceiptRef', 'sourceLists',
    'writers', 'occupiedKeys', 'uniqueKeyCount',
    'uniqueKeysSha256', 'pilots']);
  if (proof.schema !== PROOF_SCHEMA || proof.siteId !== config.siteId ||
      proof.siteUrl !== config.siteUrl ||
      proof.allPagesRead !== true || proof.sourcesComplete !== true ||
      !SHA.test(proof.inventoryEvidenceSha256 ?? '') ||
      !REF.test(proof.reviewReceiptRef ?? '') ||
      !Array.isArray(proof.sourceLists) ||
      proof.sourceLists.length !== config.expectedSources.length ||
      !Array.isArray(proof.writers) ||
      proof.writers.length !== config.expectedWriterIds.length ||
      !Array.isArray(proof.occupiedKeys) ||
      proof.occupiedKeys.length < 2 ||
      !Number.isSafeInteger(proof.uniqueKeyCount) ||
      proof.uniqueKeyCount !== proof.occupiedKeys.length ||
      !SHA.test(proof.uniqueKeysSha256 ?? '') ||
      !object(proof.pilots)) fail();
  const issuedMs = dateMs(proof.issuedAtUtc);
  const validMs = dateMs(proof.validUntilUtc);
  if (!Number.isFinite(nowMs) || issuedMs > nowMs + CLOCK_SKEW_MS ||
      validMs <= nowMs || validMs <= issuedMs ||
      validMs - issuedMs > MAX_VALIDITY_MS) fail();
  const expectedSources = new Map(config.expectedSources.map(source =>
    [source.listId.toLowerCase(), source.title]));
  const observedSources = new Set();
  for (const source of proof.sourceLists) {
    keys(source, ['listId', 'title', 'rowCount', 'keyCount',
      'pageCount', 'rowsSha256', 'complete']);
    const id = String(source.listId ?? '').toLowerCase();
    if (!GUID.test(id) || observedSources.has(id) ||
        expectedSources.get(id) !== source.title ||
        !Number.isSafeInteger(source.rowCount) || source.rowCount < 0 ||
        !Number.isSafeInteger(source.keyCount) || source.keyCount < 0 ||
        source.keyCount > source.rowCount ||
        !Number.isSafeInteger(source.pageCount) || source.pageCount < 1 ||
        !SHA.test(source.rowsSha256 ?? '') || source.complete !== true) fail();
    observedSources.add(id);
  }
  if (observedSources.size !== expectedSources.size) fail();
  const sourceKeyCount = proof.sourceLists.reduce((sum, source) =>
    sum + source.keyCount, 0);
  if (!Number.isSafeInteger(sourceKeyCount) ||
      sourceKeyCount < proof.occupiedKeys.length) fail();
  const expectedWriters = new Set(config.expectedWriterIds.map(id =>
    id.toLowerCase()));
  const observedWriters = new Set();
  let latestWriterMs = issuedMs;
  for (const writer of proof.writers) {
    keys(writer, ['flowId', 'state', 'activeRuns', 'observedAtUtc',
      'stateEvidenceSha256']);
    const id = String(writer.flowId ?? '').toLowerCase();
    const observedMs = dateMs(writer.observedAtUtc);
    if (!GUID.test(id) || !expectedWriters.has(id) ||
        observedWriters.has(id) || writer.state !== 'Off' ||
        writer.activeRuns !== 0 ||
        !SHA.test(writer.stateEvidenceSha256 ?? '') ||
        observedMs < issuedMs - CLOCK_SKEW_MS ||
        observedMs > nowMs + CLOCK_SKEW_MS) fail();
    observedWriters.add(id);
    latestWriterMs = Math.max(latestWriterMs, observedMs);
  }
  if (observedWriters.size !== expectedWriters.size) fail();
  if (JSON.stringify([...proof.occupiedKeys].sort()) !==
      JSON.stringify(proof.occupiedKeys) ||
      new Set(proof.occupiedKeys).size !== proof.occupiedKeys.length ||
      !proof.occupiedKeys.every(key => typeof key === 'string' &&
        key.length <= 255 && exactKey(key) === key)) fail();
  keys(proof.pilots, ['provider', 'customer']);
  pilotRow(proof.pilots.provider, 'provider-parts', proof.sourceLists);
  pilotRow(proof.pilots.customer, 'customer-tracker', proof.sourceLists);
  if (proof.pilots.provider.listId.toLowerCase() !==
        config.expectedPilotLists.provider.toLowerCase() ||
      proof.pilots.customer.listId.toLowerCase() !==
        config.expectedPilotLists.customer.toLowerCase() ||
      proof.pilots.provider.dispatchKey ===
        proof.pilots.customer.dispatchKey ||
      !proof.occupiedKeys.includes(proof.pilots.provider.dispatchKey) ||
      !proof.occupiedKeys.includes(proof.pilots.customer.dispatchKey)) fail();
  return {issuedMs, validMs, latestWriterMs};
}

function approvalShape(approval, proof, proofSha256, config, times,
    itemModifiedMs, nowMs) {
  keys(approval, ['schema', 'proofSha256', 'approvedByOid',
    'approvedAtUtc', 'reviewReceiptRef', 'signatureBase64Url']);
  if (approval.schema !== APPROVAL_SCHEMA ||
      approval.proofSha256 !== proofSha256 ||
      !SHA.test(approval.proofSha256 ?? '') ||
      !GUID.test(approval.approvedByOid ?? '') ||
      !config.ownerOids.some(oid => oid.toLowerCase() ===
        approval.approvedByOid.toLowerCase()) ||
      approval.reviewReceiptRef !== proof.reviewReceiptRef ||
      !REF.test(approval.reviewReceiptRef ?? '') ||
      !B64URL.test(approval.signatureBase64Url ?? '')) fail();
  const approvedMs = dateMs(approval.approvedAtUtc);
  if (approvedMs < times.latestWriterMs ||
      approvedMs > itemModifiedMs ||
      approvedMs > nowMs + CLOCK_SKEW_MS ||
      approvedMs >= times.validMs) fail();
}

function signatureBytes(value) {
  if (typeof value !== 'string' || !B64URL.test(value)) fail();
  let binary;
  try { binary = atob(value.replace(/-/g, '+').replace(/_/g, '/')); }
  catch { fail(); }
  if (binary.length !== 64) fail();
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifyApproval(approval, config) {
  if (!globalThis.crypto?.subtle?.importKey ||
      !globalThis.crypto?.subtle?.verify) fail();
  let key;
  try {
    key = await globalThis.crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', x: config.signingPublicJwk.x,
      y: config.signingPublicJwk.y,
    }, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  } catch { fail(); }
  const signed = {...approval};
  delete signed.signatureBase64Url;
  let valid;
  try {
    valid = await globalThis.crypto.subtle.verify(
      {name: 'ECDSA', hash: 'SHA-256'}, key,
      signatureBytes(approval.signatureBase64Url),
      new TextEncoder().encode(canonical(signed)));
  } catch { fail(); }
  if (!valid) fail();
}

function deepFreeze(value) {
  if (object(value) || Array.isArray(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function get(graph, path) {
  let response;
  try { response = await graph.request(path, {scopes: GRAPH_SCOPES.lists}); }
  catch { fail(); }
  if (response?.status !== 200 || !object(response.data)) fail();
  return response.data;
}

function releaseItem(item, config) {
  const etag = item?.eTag ?? item?.['@odata.etag'];
  const editor = item?.lastModifiedBy?.user?.id;
  if (!object(item) ||
      String(item.id ?? '') !== String(config.releaseItemId) ||
      typeof etag !== 'string' || !etag ||
      typeof editor !== 'string' ||
      !config.ownerOids.some(oid => oid.toLowerCase() ===
        editor.toLowerCase()) ||
      !object(item.fields) || item['@odata.nextLink'] ||
      item.fields.ReleaseKey !== config.releaseKey ||
      typeof item.fields.LegacyFenceProofJson !== 'string' ||
      typeof item.fields.LegacyFenceApprovalJson !== 'string') fail();
  return {etag, modifiedMs: dateMs(item.lastModifiedDateTime),
    proofJson: item.fields.LegacyFenceProofJson,
    approvalJson: item.fields.LegacyFenceApprovalJson};
}

/**
 * Reads one owner-controlled Release row twice through delegated Graph.
 * The detached signature permits a reviewed daily inventory renewal without
 * a public-repository deployment. The private signing key is never in Pages.
 */
export function createReleaseInventoryLoader(config, now = () => Date.now()) {
  const siteUrl = site(config);
  if (typeof now !== 'function') fail();
  const base = `/v1.0/sites/${encodeURIComponent(config.siteId)}/lists/` +
    config.releaseListId;
  const itemPath = `${base}/items/${config.releaseItemId}?` +
    '$select=id,eTag,lastModifiedBy,lastModifiedDateTime&' +
    '$expand=fields(select=ReleaseKey,LegacyFenceProofJson,' +
    'LegacyFenceApprovalJson)';
  const loadLegacyInventory = async function(boundGraph) {
    if (typeof boundGraph?.request !== 'function') fail();
    const list = await get(boundGraph,
      `${base}?$select=id,displayName,webUrl`);
    let listUrl;
    try { listUrl = new URL(list.webUrl); } catch { fail(); }
    if (String(list.id ?? '').toLowerCase() !==
          config.releaseListId.toLowerCase() ||
        list.displayName !== config.releaseListTitle ||
        listUrl.origin !== siteUrl.origin ||
        !listUrl.pathname.startsWith(
          `${siteUrl.pathname.replace(/\/$/, '')}/`)) fail();
    const columns = await get(boundGraph, `${base}/columns?` +
      '$select=name,required,text&$top=200');
    if (!Array.isArray(columns.value) || columns['@odata.nextLink']) fail();
    for (const name of ['LegacyFenceProofJson', 'LegacyFenceApprovalJson']) {
      const column = columns.value.filter(value => value?.name === name);
      if (column.length !== 1 || column[0].required !== false ||
          column[0].text?.allowMultipleLines !== true ||
          column[0].text?.appendChangesToExistingText !== false ||
          column[0].text?.textType !== 'plain') fail();
    }
    const items = await get(boundGraph,
      `${base}/items?$select=id,eTag&$top=2`);
    if (!Array.isArray(items.value) || items.value.length !== 1 ||
        items['@odata.nextLink'] ||
        String(items.value[0]?.id ?? '') !==
          String(config.releaseItemId)) fail();
    const first = releaseItem(await get(boundGraph, itemPath), config);
    const second = releaseItem(await get(boundGraph, itemPath), config);
    const listedEtag = items.value[0].eTag ??
      items.value[0]['@odata.etag'];
    if (listedEtag !== first.etag ||
        canonical(first) !== canonical(second)) fail();
    const proof = parseJson(second.proofJson, MAX_PROOF_CHARS);
    const approval = parseJson(second.approvalJson, MAX_APPROVAL_CHARS);
    const nowMs = now();
    const times = proofShape(proof, config, nowMs);
    if (await sha256(canonical(proof.occupiedKeys)) !==
        proof.uniqueKeysSha256) fail();
    const digest = await sha256(canonical(proof));
    approvalShape(approval, proof, digest, config, times,
      second.modifiedMs, nowMs);
    await verifyApproval(approval, config);
    const trusted = deepFreeze(proof);
    const bindingDigest = await sha256(canonical({proofSha256: digest,
      releaseListId: config.releaseListId.toLowerCase(),
      releaseItemId: String(config.releaseItemId),
      releaseEtag: second.etag}));
    verifiedProofs.set(trusted, bindingDigest);
    return trusted;
  };
  verifiedLoaders.add(loadLegacyInventory);
  return loadLegacyInventory;
}

/**
 * Pure read path used before and after a unique Claim. It never reads the
 * Ryan/Owners-only historical Lists under Tony or Harmony's identity.
 */
export async function inspectLegacyPilots(dispatchKey, graph, siteId,
    loadProof, expectedProofDigest = null) {
  const key = exactKey(dispatchKey);
  if (typeof graph?.request !== 'function' ||
      typeof loadProof !== 'function' ||
      !verifiedLoaders.has(loadProof) || typeof siteId !== 'string') fail();
  let proof;
  try { proof = await loadProof(graph); } catch { fail(); }
  const proofDigest = verifiedProofs.get(proof);
  if (!proofDigest || proof.siteId !== siteId ||
      dateMs(proof.validUntilUtc) <= Date.now() ||
      expectedProofDigest !== null &&
        proofDigest !== expectedProofDigest) fail();
  const pilot = key === proof.pilots.provider.dispatchKey ?
    proof.pilots.provider :
    key === proof.pilots.customer.dispatchKey ?
      proof.pilots.customer : null;
  const occupied = proof.occupiedKeys.includes(key) ? Object.freeze({
    status: 'legacy_occupied', dispatchKey: key,
    reason: 'OWNER_RECONCILIATION_REQUIRED',
    ...(pilot ? {rowRef: Object.freeze({siteId, listId: pilot.listId,
      itemId: String(pilot.itemId), etag: pilot.graphEtag})} : {}),
  }) : null;
  return Object.freeze({occupied, proofDigest,
    validUntilMs: dateMs(proof.validUntilUtc)});
}

export async function legacyPilotFence(dispatchKey, graph, siteId, loadProof) {
  return (await inspectLegacyPilots(dispatchKey, graph, siteId,
    loadProof)).occupied;
}
