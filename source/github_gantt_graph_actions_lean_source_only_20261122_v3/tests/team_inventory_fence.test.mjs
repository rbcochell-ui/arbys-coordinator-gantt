import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {LeanGanttActions} from
  '../actions.mjs';
import {createReleaseInventoryLoader, inspectLegacyPilots,
  legacyPilotFence} from
  '../legacy_team_inventory_fence.mjs';
import {providerDispatchKey} from
  '../contract.mjs';

globalThis.crypto ??= webcrypto;

const OWNER = '11111111-1111-4111-8111-111111111111';
const SITE_ID = 'example.invalid,22222222-2222-4222-8222-222222222222,33333333-3333-4333-8333-333333333333';
const SITE_URL = 'https://example.invalid/sites/Synthetic';
const RELEASE_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_LIST = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_LIST = '66666666-6666-4666-8666-666666666666';
const HISTORICAL_LIST = '77777777-7777-4777-8777-777777777777';
const WRITER_A = '88888888-8888-4888-8888-888888888888';
const WRITER_B = '99999999-9999-4999-8999-999999999999';
const PROVIDER_KEY = providerDispatchKey('0WO000000000000GAA');
const OTHER_KEY = providerDispatchKey('0WO000000000001GAA');
const HISTORICAL_KEY = providerDispatchKey('0WO000000000002GAA');
const CUSTOMER_KEY = 'customer-tracker:F:123:456';
const SHA = 'a'.repeat(64);
const NOW = Date.now();
const stamp = ms => new Date(ms).toISOString();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const canonical = value => JSON.stringify(stable(value));
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(canonical(value)));
  return Buffer.from(bytes).toString('hex');
}
const KEYS_SHA = await hash([CUSTOMER_KEY, HISTORICAL_KEY,
  PROVIDER_KEY].sort());

function proof() {
  return {
    schema: 'legacy-complete-inventory/v3', siteId: SITE_ID,
    siteUrl: SITE_URL, issuedAtUtc: stamp(NOW - 5 * 60_000),
    validUntilUtc: stamp(NOW + 23 * 60 * 60_000),
    allPagesRead: true, sourcesComplete: true,
    inventoryEvidenceSha256: SHA, reviewReceiptRef: 'invented-review-1',
    sourceLists: [
      {listId: PROVIDER_LIST, title: 'Synthetic Provider Ledger',
        rowCount: 1, keyCount: 1, pageCount: 1,
        rowsSha256: SHA, complete: true},
      {listId: CUSTOMER_LIST, title: 'Synthetic Customer Releases',
        rowCount: 1, keyCount: 1, pageCount: 1,
        rowsSha256: SHA, complete: true},
      {listId: HISTORICAL_LIST, title: 'Synthetic Old Action Ledger',
        rowCount: 1, keyCount: 1, pageCount: 1,
        rowsSha256: SHA, complete: true},
    ],
    writers: [
      {flowId: WRITER_A, state: 'Off', activeRuns: 0,
        observedAtUtc: stamp(NOW - 4 * 60_000 - 30_000),
        stateEvidenceSha256: SHA},
      {flowId: WRITER_B, state: 'Off', activeRuns: 0,
        observedAtUtc: stamp(NOW - 4 * 60_000 - 20_000),
        stateEvidenceSha256: SHA},
    ],
    occupiedKeys: [CUSTOMER_KEY, HISTORICAL_KEY,
      PROVIDER_KEY].sort(),
    uniqueKeyCount: 3, uniqueKeysSha256: KEYS_SHA,
    pilots: {
      provider: {listId: PROVIDER_LIST,
        title: 'Synthetic Provider Ledger', itemId: '1',
        dispatchKey: PROVIDER_KEY, graphEtag: '"2"'},
      customer: {listId: CUSTOMER_LIST,
        title: 'Synthetic Customer Releases', itemId: '1',
        dispatchKey: CUSTOMER_KEY, graphEtag: '"4"'},
    },
  };
}

async function fixture(mutator = () => {}, clock = () => NOW) {
  const keys = await crypto.subtle.generateKey(
    {name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const config = {
    siteId: SITE_ID, siteUrl: SITE_URL, releaseListId: RELEASE_ID,
    releaseListTitle: 'Synthetic Gantt Releases', releaseItemId: '1',
    releaseKey: 'synthetic-gantt:release', ownerOids: [OWNER],
    expectedSources: [
      {listId: PROVIDER_LIST, title: 'Synthetic Provider Ledger'},
      {listId: CUSTOMER_LIST, title: 'Synthetic Customer Releases'},
      {listId: HISTORICAL_LIST, title: 'Synthetic Old Action Ledger'},
    ],
    expectedPilotLists: {provider: PROVIDER_LIST,
      customer: CUSTOMER_LIST},
    expectedWriterIds: [WRITER_A, WRITER_B],
    signingPublicJwk: publicJwk,
  };
  const p = proof();
  mutator(p, config);
  const approval = {
    schema: 'legacy-complete-inventory-approval/v3',
    proofSha256: await hash(p), approvedByOid: OWNER,
    approvedAtUtc: stamp(NOW - 4 * 60_000),
    reviewReceiptRef: 'invented-review-1',
  };
  const signature = await crypto.subtle.sign(
    {name: 'ECDSA', hash: 'SHA-256'}, keys.privateKey,
    new TextEncoder().encode(canonical(approval)));
  approval.signatureBase64Url = Buffer.from(signature).toString('base64url');
  const calls = [];
  const base = `/v1.0/sites/${encodeURIComponent(SITE_ID)}/lists/${RELEASE_ID}`;
  const fields = {
    ReleaseKey: config.releaseKey,
    LegacyFenceProofJson: JSON.stringify(p),
    LegacyFenceApprovalJson: JSON.stringify(approval),
  };
  const response = {
    id: '1', eTag: '"7"',
    lastModifiedBy: {user: {id: OWNER}},
    lastModifiedDateTime: stamp(NOW - 3 * 60_000), fields,
  };
  const state = {listingEtag: '"7"'};
  const graph = {async request(path, options) {
    calls.push(path);
    assert.deepEqual(options.scopes, ['Lists.SelectedOperations.Selected']);
    if (path === `${base}?$select=id,displayName,webUrl`) return {
      status: 200, data: {id: RELEASE_ID,
        displayName: config.releaseListTitle,
        webUrl: `${SITE_URL}/Lists/Release/AllItems.aspx`}};
    if (path.startsWith(`${base}/columns?`)) return {status: 200,
      data: {value: ['LegacyFenceProofJson',
        'LegacyFenceApprovalJson'].map(name => ({name, required: false,
        text: {allowMultipleLines: true,
          appendChangesToExistingText: false, textType: 'plain'}}))}};
    if (path === `${base}/items?$select=id,eTag&$top=2`) return {
      status: 200, data: {value: [{id: '1',
        eTag: state.listingEtag}]}};
    if (path.startsWith(`${base}/items/1?`)) return {
      status: 200, data: structuredClone(response)};
    throw Error(`unexpected path ${path}`);
  }};
  return {config, p, approval, fields, response, state, graph, calls,
    load: createReleaseInventoryLoader(config, clock)};
}

test('owner-signed full inventory blocks both pilots and passes an unrelated key', async () => {
  const f = await fixture();
  const first = await inspectLegacyPilots(PROVIDER_KEY, f.graph,
    SITE_ID, f.load);
  assert.equal(first.occupied.status, 'legacy_occupied');
  assert.deepEqual(first.occupied.rowRef, {siteId: SITE_ID,
    listId: PROVIDER_LIST, itemId: '1', etag: '"2"'});
  assert.equal((await legacyPilotFence(CUSTOMER_KEY, f.graph,
    SITE_ID, f.load)).status, 'legacy_occupied');
  const historic = await legacyPilotFence(HISTORICAL_KEY,
    f.graph, SITE_ID, f.load);
  assert.equal(historic.status, 'legacy_occupied');
  assert.equal(Object.hasOwn(historic, 'rowRef'), false);
  const other = await inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, f.load, first.proofDigest);
  assert.equal(other.occupied, null);
  assert.equal(other.proofDigest, first.proofDigest);
  assert.equal(other.validUntilMs, Date.parse(f.p.validUntilUtc));
  assert.equal(f.calls.some(path => path.includes(PROVIDER_LIST) ||
    path.includes(CUSTOMER_LIST) || path.includes(HISTORICAL_LIST)), false);
  assert.equal(f.calls.length, 20);
});

test('unbranded caller object and a changed post-Claim proof never authorize a draft', async () => {
  const f = await fixture();
  await assert.rejects(inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, async () => f.p), e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
  const first = await inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, f.load);
  const second = await fixture(p => { p.occupiedKeys.push(OTHER_KEY); p.occupiedKeys.sort(); });
  await assert.rejects(inspectLegacyPilots(OTHER_KEY, second.graph,
    SITE_ID, second.load, first.proofDigest),
  e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
});

test('cached verified proof wrapper cannot replay an old Release ETag', async () => {
  const f = await fixture();
  const prior = await f.load(f.graph);
  const first = await inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, f.load);
  f.response.eTag = '"8"';
  f.state.listingEtag = '"8"';
  await assert.rejects(inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, async () => prior, first.proofDigest),
  e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
  await assert.rejects(inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, f.load, first.proofDigest),
  e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
});

test('a once verified proof cannot pass after wall-clock expiry', async () => {
  const f = await fixture(p => {
    p.validUntilUtc = stamp(NOW - 30_000);
  }, () => NOW - 60_000);
  await f.load(f.graph);
  await assert.rejects(inspectLegacyPilots(OTHER_KEY, f.graph,
    SITE_ID, f.load),
  e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
});

test('tampered proof, signature, editor or singleton read holds every key', async () => {
  for (const change of [
    f => { f.p.inventoryEvidenceSha256 = 'b'.repeat(64);
      f.fields.LegacyFenceProofJson = JSON.stringify(f.p); },
    f => { f.approval.signatureBase64Url = 'A'.repeat(86);
      f.fields.LegacyFenceApprovalJson = JSON.stringify(f.approval); },
    f => { f.response.lastModifiedBy.user.id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; },
    f => { f.response.eTag = '"8"'; },
  ]) {
    const f = await fixture();
    change(f);
    await assert.rejects(legacyPilotFence(OTHER_KEY, f.graph,
      SITE_ID, f.load), e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
  }
});

test('incomplete inventory, a running writer, expiry, missing pilot, or wrong scope holds', async () => {
  for (const change of [
    p => { p.sourcesComplete = false; },
    p => { p.sourceLists.pop(); },
    p => { p.writers[0].state = 'On'; },
    p => { p.writers[1].activeRuns = 1; },
    p => { p.writers[1].stateEvidenceSha256 = 'missing'; },
    p => { p.validUntilUtc = stamp(NOW - 30_000); },
    p => { p.uniqueKeysSha256 = 'b'.repeat(64); },
    p => { p.uniqueKeyCount = 2; },
    p => { p.occupiedKeys = [PROVIDER_KEY]; },
    p => { p.pilots.provider.listId = HISTORICAL_LIST; },
    p => { p.siteId = 'example.invalid,aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; },
  ]) {
    const f = await fixture(change);
    await assert.rejects(legacyPilotFence(OTHER_KEY, f.graph,
      SITE_ID, f.load), e => e?.code === 'LEGACY_FENCE_UNVERIFIED');
  }
});

test('a denied Release read or omitted old source is never interpreted as free', async () => {
  const f = await fixture();
  const denied = {async request() { throw Error('403'); }};
  await assert.rejects(legacyPilotFence(OTHER_KEY, denied,
    SITE_ID, f.load), error => error?.code === 'LEGACY_FENCE_UNVERIFIED');
  await assert.rejects(fixture((p, config) => {
    p.sourceLists.pop();
    config.expectedSources.pop();
  }), error => error?.code === 'LEGACY_FENCE_UNVERIFIED');
});

test('lean preview never resolves an occupied historical key for another coordinator', async () => {
  const f = await fixture();
  const calls = [];
  const runtime = new LeanGanttActions({
    config: {siteId: SITE_ID, occupiedPilotClaimsMigrated: true},
    graph: {bindAccount() { return {}; }},
    loadLegacyFenceProof: f.load,
  });
  runtime._context = async () => ({graph: f.graph,
    actor: {id: OWNER, address: 'coordinator@example.invalid'},
    store: {async getState(key) { calls.push(['getState', key]); return null; }},
    source: {async resolve() { calls.push(['resolve']);
      throw Error('reached current source'); }}});
  const pilot = await runtime.preview('provider',
    PROVIDER_KEY.slice('provider-parts:'.length));
  assert.equal(pilot.status, 'legacy_occupied');
  assert.deepEqual(calls, [['getState', PROVIDER_KEY]]);
  await assert.rejects(runtime.preview('provider',
    OTHER_KEY.slice('provider-parts:'.length)),
  /reached current source/);
  assert.deepEqual(calls.slice(1), [['getState', OTHER_KEY], ['resolve']]);
});

test('lean writer rereads signed inventory after Claim and holds on drift', async () => {
  const f = await fixture();
  const calls = [];
  const actor = {id: OWNER, address: 'coordinator@example.invalid'};
  f.graph.getMe = async () => actor;
  f.graph.createDraft = async () => {
    calls.push('createDraft');
    throw Error('should never make a draft');
  };
  const source = {woNumber: '1234567', agentCode: 'T42',
    to: ['manager@example.invalid', 'planner@example.invalid'],
    validUntilMs: NOW + 600_000};
  const runtime = new LeanGanttActions({
    config: {siteId: SITE_ID, occupiedPilotClaimsMigrated: true},
    graph: {bindAccount() { return {}; }}, now: () => NOW,
    loadLegacyFenceProof: f.load,
  });
  runtime._context = async () => ({graph: f.graph, actor,
    store: {
      async getState() { calls.push('getState'); return null; },
      async createClaim() {
        calls.push('createClaim');
        f.response.eTag = '"8"';
        f.state.listingEtag = '"8"';
        return {id: '1'};
      },
    },
    source: {
      async resolve() { calls.push('resolve'); return source; },
      async confirmUnchanged() { calls.push('confirmSource');
        return source; },
    }});
  await assert.rejects(runtime.providerDraft(
    OTHER_KEY.slice('provider-parts:'.length)),
  error => error?.code === 'LEGACY_FENCE_UNVERIFIED');
  assert.deepEqual(calls, ['getState', 'resolve', 'createClaim',
    'confirmSource']);
});

test('proof expiry during token wait holds before the Outlook POST', async () => {
  const f = await fixture();
  const calls = [];
  const actor = {id: OWNER, address: 'coordinator@example.invalid'};
  f.graph.getMe = async () => actor;
  f.graph.createDraft = async (_content, _correlationId, beforeFetch) => {
    calls.push('beforeFetch');
    const original = Date.now;
    try {
      Date.now = () => Date.parse(f.p.validUntilUtc) + 1;
      beforeFetch();
      calls.push('outlookPost');
    } finally { Date.now = original; }
  };
  const source = {woNumber: '1234567', agentCode: 'T42',
    to: ['manager@example.invalid', 'planner@example.invalid'],
    validUntilMs: NOW + 600_000};
  const runtime = new LeanGanttActions({
    config: {siteId: SITE_ID, occupiedPilotClaimsMigrated: true},
    graph: {bindAccount() { return {}; }}, now: () => NOW,
    loadLegacyFenceProof: f.load,
  });
  runtime._context = async () => ({graph: f.graph, actor,
    store: {async getState() { return null; },
      async createClaim() { calls.push('createClaim'); return {id: '1'}; }},
    source: {async resolve() { return source; },
      async confirmUnchanged() { return source; }}});
  await assert.rejects(runtime.providerDraft(
    OTHER_KEY.slice('provider-parts:'.length)),
  error => error?.code === 'LEGACY_FENCE_UNVERIFIED');
  assert.deepEqual(calls, ['createClaim', 'beforeFetch']);
});

test('public module contains no pilot identifiers or private tracker capability', async () => {
  const source = await readFile(new URL(
    '../legacy_team_inventory_fence.mjs',
    import.meta.url), 'utf8');
  assert.equal(/\b0WO[A-Za-z0-9]{15}\b/u.test(source), false);
  assert.equal(/\bF:[0-9]{6,}:[0-9]{7,}\b/u.test(source), false);
  assert.equal(source.includes('arbys-customer-status-preview'), false);
  assert.equal(source.includes('Mail.Send'), false);
});
