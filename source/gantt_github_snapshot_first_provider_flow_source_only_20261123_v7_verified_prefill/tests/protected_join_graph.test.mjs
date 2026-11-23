import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {ProviderSourceResolver} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/provider_source.mjs';

const SITE = 'groups.coca-cola.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
const WO_LIST = '33333333-3333-4333-8333-333333333333';
const CONTACT_LIST = '44444444-4444-4444-8444-444444444444';
const ACTOR = {id: '55555555-5555-4555-8555-555555555555',
  address: 'coordinator@example.invalid'};
const OBSERVED = '2026-11-22T18:43:09Z';
const NOW = Date.parse('2026-11-22T19:43:09Z');

function nativeId(serial) {
  const first = `0WO${String(serial).padStart(12, '0')}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(first[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return first + suffix;
}
const WO = nativeId(1);
const CONTACT_KEY = createHash('sha256').update(JSON.stringify(
  ['A1', '123456', '1001'])).digest('hex');

function fixture() {
  return {
    wo: {id: '1', eTag: '"1"', fields: {
      NativeWorkOrderId: WO, SourceComplete: true,
      SourceObservedAtUtc: OBSERVED, SourceRevision: 'a'.repeat(64),
      NormalizedVisitKind: 'Install', ActivityType: 'Installation',
      WorkOrderType: 'Installation', WorkOrderStatus: 'Pending Readiness',
      ServiceTypeCode: 'A', AssignedAgentCode: 'A1',
      OutletACN: '00123456', StoreNumber: '1001',
      ServiceAddressKey: '1 EXAMPLE ROAD|TESTVILLE|NY|10001',
      WorkOrderNumber: '1234567',
    }},
    contact: {id: '2', eTag: '"1"', fields: {
      ContactKey: CONTACT_KEY, AgentCode: 'A1', OutletACN: '00123456',
      StoreNumber: '1001',
      ServiceAddressKey: '1 EXAMPLE ROAD|TESTVILLE|NY|10001',
      InstallManagerEmail: 'manager@example.invalid',
      PlannerEmail: 'planner@example.invalid', Verified: true,
      VerifiedAtUtc: '2026-11-19T18:00:00Z',
      SourceCheckedAtUtc: '2026-11-22T18:00:00Z',
      SourceEvidenceDigest: 'b'.repeat(64),
    }},
  };
}

function graphFor(rows) {
  const reads = [];
  const graph = {
    async getMe() { return ACTOR; },
    async request(path, options) {
      reads.push(path);
      assert.deepEqual(options.scopes, ['Lists.SelectedOperations.Selected']);
      const url = new URL(path, 'https://graph.microsoft.com');
      const parts = url.pathname.split('/');
      assert.equal(decodeURIComponent(parts[3]), SITE);
      const listId = parts[5];
      const contact = listId === CONTACT_LIST;
      assert.ok(contact || listId === WO_LIST);
      const title = contact ? 'Arbys Provider Parts Verified Contacts' :
        'Arbys Provider Parts WO Action Source';
      const key = contact ? 'ContactKey' : 'NativeWorkOrderId';
      const row = contact ? rows.contact : rows.wo;
      if (parts.length === 6) return {status: 200, data: {id: listId,
        displayName: title,
        webUrl: 'https://groups.coca-cola.com/sites/ArbysOperations/Lists/Invented'}};
      if (parts[6] === 'columns') return {status: 200, data: {value: [{
        name: key, required: true, indexed: true,
        enforceUniqueValues: true, text: {},
      }]}};
      assert.equal(parts[6], 'items');
      if (parts[7]) {
        assert.equal(parts[7], row.id);
        return {status: 200, data: structuredClone(row)};
      }
      assert.equal(url.searchParams.get('$filter'),
        `fields/${key} eq '${row.fields[key]}'`);
      return {status: 200, data: {value: [structuredClone(row)]}};
    },
  };
  return {graph, reads};
}

function config() {
  return {siteId: SITE, lists: {woSource: WO_LIST,
    verifiedContacts: CONTACT_LIST},
  eligibleWorkOrderTypes: ['Installation'], eligibleServiceTypeCodes: ['A'],
  eligibleRawSpStatuses: [], eligibleWorkOrderStatuses: ['Pending Readiness'],
  emptyToDraftCanaryPassed: true};
}

test('the protected resolver independently reads exact WO and contact keys', async () => {
  const rows = fixture();
  const {graph, reads} = graphFor(rows);
  const resolver = new ProviderSourceResolver({graph, config: config(),
    now: () => NOW});
  const result = await resolver.resolve(WO, ACTOR);
  assert.equal(result.nativeWoId, WO);
  assert.equal(result.agentCode, 'A1');
  assert.equal(result.storeNumber, '1001');
  assert.equal(result.outletAcn, '00123456');
  assert.equal(result.normalizedVisitKind, 'Install');
  assert.equal(result.workOrderType, 'Installation');
  assert.equal(result.serviceTypeCode, 'A');
  assert.deepEqual(result.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal(JSON.parse(result.etagsJson).contact.etag, '"1"');
  assert.equal(reads.length, 8);
});

test('protected reader exposes an allowlisted alternate scope for chart comparison', async () => {
  const rows = fixture();
  rows.wo.fields.WorkOrderType = 'Other';
  rows.wo.fields.ServiceTypeCode = '9';
  const policy = config();
  policy.eligibleWorkOrderTypes.push('Other');
  policy.eligibleServiceTypeCodes.push('9');
  const {graph} = graphFor(rows);
  const result = await new ProviderSourceResolver({graph, config: policy,
    now: () => NOW}).resolve(WO, ACTOR);
  assert.equal(result.workOrderType, 'Other');
  assert.equal(result.serviceTypeCode, '9');
});

test('a contradictory protected ACN holds the action', async () => {
  const rows = fixture();
  rows.contact.fields.OutletACN = '99999999';
  const {graph} = graphFor(rows);
  const resolver = new ProviderSourceResolver({graph, config: config(),
    now: () => NOW});
  await assert.rejects(() => resolver.resolve(WO, ACTOR),
    {code: 'CONTACT_JOIN_CONFLICT'});
});

test('zero-only protected ACN or store cannot become a shared contact key', async () => {
  for (const name of ['OutletACN', 'StoreNumber']) {
    const rows = fixture();
    rows.wo.fields[name] = '000000';
    const {graph} = graphFor(rows);
    await assert.rejects(() => new ProviderSourceResolver({graph,
      config: config(), now: () => NOW}).resolve(WO, ACTOR),
    {code: 'WO_NOT_CURRENTLY_DRAFT_READY'});
  }
});

test('a fresh unverified protected pair is suggested with required review', async () => {
  const rows = fixture();
  rows.contact.fields.Verified = false;
  rows.contact.fields.VerifiedAtUtc = null;
  const {graph} = graphFor(rows);
  const result = await new ProviderSourceResolver({graph, config: config(),
    now: () => NOW}).resolve(WO, ACTOR);
  assert.deepEqual(result.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal(result.recipientEvidence, 'suggested_pair');
  assert.equal(result.recipientReviewRequired, true);
  assert.equal(result.serviceAddressKey,
    '1 EXAMPLE ROAD|TESTVILLE|NY|10001');
});

test('leading zero differences preserve the same protected numeric location', async () => {
  const rows = fixture();
  rows.contact.fields.OutletACN = '123456';
  rows.contact.fields.StoreNumber = '01001';
  rows.contact.fields.Verified = false;
  rows.contact.fields.VerifiedAtUtc = null;
  const {graph} = graphFor(rows);
  const result = await new ProviderSourceResolver({graph, config: config(),
    now: () => NOW}).resolve(WO, ACTOR);
  assert.equal(result.recipientEvidence, 'suggested_pair');
  assert.deepEqual(result.to,
    ['manager@example.invalid', 'planner@example.invalid']);
});

test('a stale unverified pair cannot prefill', async () => {
  const rows = fixture();
  rows.contact.fields.Verified = false;
  rows.contact.fields.VerifiedAtUtc = null;
  rows.contact.fields.SourceCheckedAtUtc = '2026-11-21T18:00:00Z';
  const {graph} = graphFor(rows);
  const result = await new ProviderSourceResolver({graph, config: config(),
    now: () => NOW}).resolve(WO, ACTOR);
  assert.deepEqual(result.to, []);
  assert.equal(result.recipientEvidence, 'manual_entry');
});

test('two verified roles sharing one mailbox yield one recipient', async () => {
  const rows = fixture();
  rows.contact.fields.PlannerEmail = rows.contact.fields.InstallManagerEmail;
  const {graph} = graphFor(rows);
  const result = await new ProviderSourceResolver({graph, config: config(),
    now: () => NOW}).resolve(WO, ACTOR);
  assert.deepEqual(result.to, ['manager@example.invalid']);
  assert.equal(result.recipientReviewRequired, false);
});

test('a contact ETag change during the protected read stops the join', async () => {
  const rows = fixture();
  const {graph} = graphFor(rows);
  const original = graph.request.bind(graph);
  graph.request = async (path, options) => {
    const response = await original(path, options);
    if (path.includes(`/lists/${CONTACT_LIST}/items/2?`)) {
      response.data.eTag = '"2"';
    }
    return response;
  };
  const resolver = new ProviderSourceResolver({graph, config: config(),
    now: () => NOW});
  await assert.rejects(() => resolver.resolve(WO, ACTOR),
    {code: 'SOURCE_CHANGED_DURING_READ'});
});
