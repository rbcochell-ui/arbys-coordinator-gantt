import assert from 'node:assert/strict';
import test from 'node:test';
import {INTEGRATION_CONFIG} from '../site/actions/integration_config.mjs';
import {GANTT_APP_URL, REDIRECT_URI} from '../src/auth_config.mjs';
import {GRAPH_SCOPE_SETS, LOGIN_SCOPES} from '../src/auth_config.mjs';
import {createAuthenticatedChartLoader} from '../src/chart_loader.mjs';
import {prepareIntegratedSite, validateIntegrationConfig} from
  '../src/compose_site.mjs';
import {PICOS_PARTS} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {buildSnapshotProviderContent} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/snapshot_first_provider_flow.mjs';
import {GANTT_RELEASE_KEY, GANTT_RELEASE_TITLE} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs';
import {sealSyntheticHtml} from './fixture_seal.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const COORDINATOR = '44444444-4444-4444-8444-444444444444';
const SITE_ID = 'groups.coca-cola.com,55555555-5555-4555-8555-555555555555,66666666-6666-4666-8666-666666666666';
const LISTS = {customerReleases: '77777777-7777-4777-8777-777777777777',
  claims: '88888888-8888-4888-8888-888888888888',
  receipts: '99999999-9999-4999-8999-999999999999',
  ganttRelease: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const PAYLOAD_URL = `${GANTT_APP_URL}data/gantt.enc.json`;

function inventedConfig() {
  const config = structuredClone(INTEGRATION_CONFIG);
  config.enabled = true;
  Object.assign(config.auth, {enabled: true, tenantId: TENANT,
    clientId: CLIENT, coordinatorOids: [COORDINATOR],
    redirectUri: REDIRECT_URI});
  Object.assign(config.lean, {enabled: true, tenantId: TENANT,
    clientId: CLIENT, siteId: SITE_ID, coordinatorOids: [COORDINATOR],
    releaseOwnerOids: [OWNER],
    approvedCustomerReleaseKinds: ['InventedCustomerRelease/v1'],
    occupiedPilotClaimsMigrated: true, providerEnabled: false,
    customerEnabled: true});
  Object.assign(config.lean.lists, {customerReleases: LISTS.customerReleases,
    claims: LISTS.claims, receipts: LISTS.receipts});
  Object.assign(config.snapshot, {enabled: true,
    providerSnapshotEnabled: true, siteId: SITE_ID,
    coordinatorOids: [COORDINATOR], releaseOwnerOids: [OWNER],
    occupiedPilotClaimsMigrated: true,
    emptyToDraftCanaryPassed: true,
    encryptedPayloadUrl: PAYLOAD_URL});
  Object.assign(config.snapshot.lists, {ganttRelease: LISTS.ganttRelease,
    claims: LISTS.claims, receipts: LISTS.receipts});
  config.releaseSiteUrl = 'https://groups.coca-cola.com/sites/ArbysOperations';
  config.encryptedPayloadUrl = PAYLOAD_URL;
  config.legacyInventory = {siteId: SITE_ID,
    siteUrl: config.releaseSiteUrl,
    releaseListId: LISTS.ganttRelease,
    releaseListTitle: GANTT_RELEASE_TITLE,
    releaseItemId: '1', releaseKey: GANTT_RELEASE_KEY,
    ownerOids: [OWNER],
    expectedSources: [
      {listId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'Invented Provider Ledger'},
      {listId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'Invented Customer Releases'},
      {listId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: 'Invented Legacy Ledger'},
    ],
    expectedPilotLists: {provider: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      customer: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
    expectedWriterIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
    signingPublicJwk: {kty: 'EC', crv: 'P-256',
      x: 'A'.repeat(43), y: 'B'.repeat(43)},
  };
  return config;
}
function fakeElements() {
  return Object.fromEntries(['panel', 'sourceAsOf', 'chartDate',
    'datedPhase', 'agentCode', 'storeNumber', 'thirstyLink',
    'recipientWarning', 'reviewWarning', 'status']
    .map(name => [name, {textContent: '', hidden: false,
      removeAttribute() {}}]));
}

test('checked-in site stays disabled without MSAL, Graph or a payload', async () => {
  assert.equal(INTEGRATION_CONFIG.enabled, false);
  assert.equal(INTEGRATION_CONFIG.auth.enabled, false);
  assert.equal(INTEGRATION_CONFIG.lean.enabled, false);
  assert.equal(INTEGRATION_CONFIG.snapshot.enabled, false);
  assert.equal(INTEGRATION_CONFIG.encryptedPayloadUrl, null);
  assert.equal(INTEGRATION_CONFIG.lean.lists.claims, null);
  assert.equal(INTEGRATION_CONFIG.legacyInventory, null);
  assert.equal(INTEGRATION_CONFIG.legacyOwner, null);
  let called = false;
  const result = await prepareIntegratedSite({config: INTEGRATION_CONFIG,
    msalFactory: () => { called = true; throw new Error('must stay held'); },
    fetchImpl: () => { called = true; throw new Error('must stay held'); }});
  assert.equal(result.adapter.enabled, false);
  assert.equal(result.panel, null);
  assert.equal(called, false);
});

test('legacy owner binding requires exact List IDs and reviewed proof pins', async () => {
  const wrongSite = inventedConfig();
  wrongSite.legacyOwner = {enabled: true, reviewedConfig: {
    siteId: 'groups.coca-cola.com,ffffffff-ffff-4fff-8fff-ffffffffffff,66666666-6666-4666-8666-666666666666',
    siteUrl: wrongSite.releaseSiteUrl,
  }};
  assert.throws(() => validateIntegrationConfig(wrongSite),
    {code: 'LEGACY_OWNER_BINDING_MISMATCH'});

  const config = inventedConfig();
  config.legacyOwner = {enabled: true, reviewedConfig: {
    siteId: SITE_ID, siteUrl: config.releaseSiteUrl,
    newLists: {claims: LISTS.claims, receipts: LISTS.receipts},
  }};
  let graphRequests = 0;
  await assert.rejects(prepareIntegratedSite({config,
    msalFactory: () => ({async initialize() {}, getAllAccounts: () => []}),
    fetchImpl: () => { graphRequests++; throw new Error('unexpected Graph request'); },
    loadAuthenticatedChart: () => { throw new Error('unexpected chart read'); },
    panelElements: fakeElements(),
  }), {code: 'LEGACY_DERIVED_PROOF_PIN_MISSING'});
  assert.equal(graphRequests, 0);
});

test('active bindings require one identity, one unique List pair and exact Pages asset', () => {
  const good = inventedConfig();
  assert.equal(validateIntegrationConfig(good).payloadUrl, PAYLOAD_URL);
  for (const mutate of [
    c => { c.snapshot.lists.claims = LISTS.receipts; },
    c => { c.auth.coordinatorOids = [OWNER]; },
    c => { c.encryptedPayloadUrl = 'https://example.invalid/chart.json'; },
    c => { c.lean.providerEnabled = true; },
    c => { c.snapshot.emptyToDraftCanaryPassed = null; },
    c => { c.lean.customerEnabled = false; },
    c => { c.legacyInventory = null; },
    c => { c.legacyInventory.siteId =
      'groups.coca-cola.com,ffffffff-ffff-4fff-8fff-ffffffffffff,66666666-6666-4666-8666-666666666666'; },
    c => { c.legacyInventory.releaseListId = LISTS.claims; },
    c => { c.legacyInventory.ownerOids = [COORDINATOR]; },
  ]) {
    const bad = inventedConfig(); mutate(bad);
    assert.throws(() => validateIntegrationConfig(bad));
  }
});

test('invented active composition prepares sign-in without a Graph request', async () => {
  const config = inventedConfig();
  const account = {tenantId: TENANT, homeAccountId: 'home-invented',
    localAccountId: 'local-invented', idTokenClaims: {oid: COORDINATOR,
      tid: TENANT}};
  let initialized = 0;
  let popups = 0;
  let requests = 0;
  const pca = {async initialize() { initialized++; },
    loginPopup() { popups++; return Promise.resolve({account}); },
    acquireTokenPopup() { throw new Error('unused'); },
    acquireTokenSilent() { throw new Error('unused'); },
    getAllAccounts() { return [account]; }};
  const result = await prepareIntegratedSite({config,
    msalFactory: () => pca,
    fetchImpl: () => { requests++; throw new Error('no Graph call expected'); },
    loadAuthenticatedChart: () => { throw new Error('no chart read expected'); },
    panelElements: fakeElements()});
  assert.equal(result.adapter.enabled, true);
  assert.equal(initialized, 1);
  assert.equal(requests, 0);
  await result.adapter.signInFromClick();
  assert.equal(popups, 1);
  assert.equal(requests, 0);
  assert.throws(() => result.panel.selectionPort.capture('0WO123456789012345'),
    {code: 'DATED_PREVIEW_SELECTION_REQUIRED'});
});

test('browser composition constructs the owner proof reader from reviewed pins', async () => {
  const config = inventedConfig();
  const fingerprint = 'a'.repeat(64);
  const pinned = (spec, itemId) => ({
    listId: spec.oldListGuid, itemId, title: spec.oldListTitle,
    migrationSpec: spec,
    migrationFingerprintSha256: fingerprint,
    migrationPlanSha256: 'b'.repeat(64),
    migrationReadback: {claimItemId: '41', draftReceiptItemId: '42',
      claimGraphEtag: '"1"', draftGraphEtag: '"1"',
      claimFieldsSha256: 'c'.repeat(64),
      draftFieldsSha256: 'd'.repeat(64)},
    originalOldRow: {graphEtag: '"4"',
      fullFieldsSha256: 'e'.repeat(64)},
  });
  config.legacyOwner = {enabled: true, reviewedConfig: {
    siteId: SITE_ID, siteUrl: config.releaseSiteUrl,
    newLists: {claims: LISTS.claims, receipts: LISTS.receipts},
    approvedCustomerReleaseKinds: ['InventedCustomerRelease/v1'],
    oldLists: {
      'provider-parts': pinned({kind: 'provider-parts',
        entityId: '0WOTN00000abcde4AA',
        oldListGuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        oldListTitle: 'Invented Provider Ledger',
        oldKeyField: 'DispatchKey',
        oldHeader: 'x-arbys-parts-intent-id'}, 1),
      'customer-tracker': pinned({kind: 'customer-tracker',
        entityId: 'F:123:456',
        oldListGuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        oldListTitle: 'Invented Customer Releases',
        oldKeyField: 'FormSourceKey',
        approvedReleaseKind: 'InventedCustomerRelease/v1'}, 1),
    },
  }};
  let requests = 0;
  const result = await prepareIntegratedSite({config,
    msalFactory: () => ({async initialize() {}, getAllAccounts: () => [],
      loginPopup() { throw new Error('no login'); },
      acquireTokenPopup() { throw new Error('no token'); },
      acquireTokenSilent() { throw new Error('no token'); }}),
    fetchImpl: () => { requests++; throw new Error('no read before click'); },
    loadAuthenticatedChart: () => { throw new Error('no chart read'); },
    panelElements: fakeElements()});
  assert.equal(result.adapter.enabled, true);
  assert.equal(requests, 0);
});

test('chart loader returns exact invented served bytes and rejects wrong URL', async () => {
  const html = '<!doctype html><html><body>Invented Gantt</body></html>';
  const {keyBytes, envelope} = await sealSyntheticHtml(html);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  const url = 'https://example.invalid/data/gantt.enc.json';
  const requests = [];
  const loader = createAuthenticatedChartLoader({capabilityKey: keyBytes,
    payloadUrl: url, now: () => 123,
    fetchImpl: async (requested, options) => {
      requests.push([requested, options]);
      return {status: 200, url: requested,
        headers: {get: () => String(bytes.byteLength)},
        arrayBuffer: async () => bytes.buffer};
    }});
  const result = await loader();
  assert.equal(result.html, html);
  assert.equal(result.encryptedPayloadUrl, url);
  assert.deepEqual(result.encryptedPayloadBytes, bytes);
  assert.equal(requests[0][0], `${url}?fresh=123`);
  assert.equal(requests[0][1].credentials, 'omit');
  const wrong = createAuthenticatedChartLoader({capabilityKey: keyBytes,
    payloadUrl: url, fetchImpl: async () => ({status: 200,
      url: 'https://example.invalid/other.json',
      headers: {get: () => null}, arrayBuffer: async () => bytes.buffer})});
  await assert.rejects(wrong, /ENCRYPTED_CHART_READ_UNVERIFIED/u);
  const wrongQuery = createAuthenticatedChartLoader({capabilityKey: keyBytes,
    payloadUrl: url, fetchImpl: async () => ({status: 200, url,
      headers: {get: () => null}, arrayBuffer: async () => bytes.buffer})});
  await assert.rejects(wrongQuery, /ENCRYPTED_CHART_READ_UNVERIFIED/u);
  assert.throws(() => createAuthenticatedChartLoader({capabilityKey: keyBytes,
    payloadUrl: 'http://example.invalid/data/gantt.enc.json',
    fetchImpl: async () => { throw new Error('must not fetch'); }}),
  /Exact chart asset URL required/u);
});

test('bound provider content retains the six exact product links and no send scope', () => {
  const exactLinks = [
    'https://www.mycoke.com/product/tubing-fs-16ln-14-38-2-12-re-bndl/01tPY000009IyzqYAC',
    'https://www.mycoke.com/product/chase-4in-x-4in-x-48in-assy-ss/01tPY000009IqcYYAS',
    'https://www.mycoke.com/product/valve-shutoff-12in-barb-gray/01tPY000009J5DJYA0',
    'https://www.mycoke.com/product/valveshut-off-38in-barb/01tPY000009IpEzYAK',
    'https://www.mycoke.com/product/kit-arbys-new-equipment-installati/01tPY000009IQq6YAG',
    'https://www.mycoke.com/product/leverwatersfv1uf1extendedlit/01tPY000009JjlqYAC',
  ];
  assert.deepEqual(PICOS_PARTS.map(part => part.url), exactLinks);
  const content = buildSnapshotProviderContent({woNumber: '123456',
    agentCode: 'A1', visitKind: 'Installation'}, {to: []});
  assert.deepEqual(content.requiredLinks, exactLinks);
  assert.equal((content.htmlBody.match(/<a href=/gu) ?? []).length, 6);
  assert.deepEqual(LOGIN_SCOPES,
    ['User.Read', 'Lists.SelectedOperations.Selected', 'Mail.ReadWrite']);
  assert.equal(Object.values(GRAPH_SCOPE_SETS).flat().includes('Mail.Send'),
    false);
});
