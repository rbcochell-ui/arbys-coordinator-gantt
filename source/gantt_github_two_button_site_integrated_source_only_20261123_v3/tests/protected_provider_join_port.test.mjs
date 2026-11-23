import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createProtectedProviderJoinPort} from '../src/compose_site.mjs';

const SITE = 'groups.coca-cola.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
const WO_LIST = '33333333-3333-4333-8333-333333333333';
const CONTACT_LIST = '44444444-4444-4444-8444-444444444444';
const ACTOR = {id: '55555555-5555-4555-8555-555555555555',
  address: 'coordinator@example.invalid'};
const NOW = Date.parse('2026-11-22T19:43:09Z');
function sf18(first15) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(first15[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return first15 + suffix;
}
const WO = sf18('0WO000000000001');
const CONTACT_KEY = createHash('sha256').update(JSON.stringify(
  ['A1', '123456', '1001'])).digest('hex');

function rows() {
  return {
    wo: {id: '1', eTag: '"1"', fields: {
      NativeWorkOrderId: WO, SourceComplete: true,
      SourceObservedAtUtc: '2026-11-22T18:43:09Z',
      SourceRevision: 'a'.repeat(64), NormalizedVisitKind: 'Install',
      ActivityType: 'Installation', WorkOrderType: 'Installation',
      WorkOrderStatus: 'Pending Readiness', ServiceTypeCode: 'A',
      AssignedAgentCode: 'A1', OutletACN: '00123456', StoreNumber: '1001',
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
function config() {
  return {siteId: SITE, lists: {woSource: WO_LIST,
    verifiedContacts: CONTACT_LIST},
  eligibleWorkOrderTypes: ['Installation'], eligibleServiceTypeCodes: ['A'],
  eligibleRawSpStatuses: [], eligibleWorkOrderStatuses: ['Pending Readiness'],
  emptyToDraftCanaryPassed: true};
}
function graphFor(data, actor = ACTOR) {
  let binds = 0;
  const reads = [];
  const bound = {
    async getMe() { return actor; },
    async request(path, options) {
      reads.push(path);
      assert.deepEqual(options.scopes, ['Lists.SelectedOperations.Selected']);
      const url = new URL(path, 'https://graph.microsoft.com');
      const segments = url.pathname.split('/');
      assert.equal(decodeURIComponent(segments[3]), SITE);
      const listId = segments[5];
      const isContact = listId === CONTACT_LIST;
      assert.ok(isContact || listId === WO_LIST);
      const title = isContact ? 'Arbys Provider Parts Verified Contacts' :
        'Arbys Provider Parts WO Action Source';
      const key = isContact ? 'ContactKey' : 'NativeWorkOrderId';
      const row = isContact ? data.contact : data.wo;
      if (segments.length === 6) return {status: 200, data: {id: listId,
        displayName: title,
        webUrl: 'https://groups.coca-cola.com/sites/ArbysOperations/Lists/Invented'}};
      if (segments[6] === 'columns') return {status: 200, data: {value: [{
        name: key, required: true, indexed: true,
        enforceUniqueValues: true, text: {},
      }]}};
      assert.equal(segments[6], 'items');
      if (segments[7]) return {status: 200, data: structuredClone(row)};
      assert.equal(url.searchParams.get('$filter'),
        `fields/${key} eq '${row.fields[key]}'`);
      return {status: 200, data: {value: [structuredClone(row)]}};
    },
  };
  return {graph: {bindAccount() { binds++; return bound; }}, reads,
    boundCount: () => binds};
}

test('site join port makes a fresh, pinned two-List read for a native WO', async () => {
  const g = graphFor(rows());
  const port = createProtectedProviderJoinPort({graph: g.graph,
    config: config(), now: () => NOW});
  assert.equal(g.boundCount(), 0);
  const first = await port.resolve(WO, ACTOR);
  assert.deepEqual(first.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal(JSON.parse(first.etagsJson).wo.etag, '"1"');
  assert.equal(g.reads.length, 8);
  const second = await port.resolve(WO, ACTOR);
  assert.equal(second.digest, first.digest);
  assert.equal(g.boundCount(), 2);
  assert.equal(g.reads.length, 16);
});

test('site join port holds on missing sign-in or actor switch', async () => {
  const port = createProtectedProviderJoinPort({graph: {
    bindAccount() { throw Object.assign(new Error('Sign in'),
      {code: 'SIGN_IN_REQUIRED'}); },
  }, config: config(), now: () => NOW});
  await assert.rejects(() => port.resolve(WO, ACTOR),
    {code: 'SIGN_IN_REQUIRED'});
  const g = graphFor(rows(), {id: '66666666-6666-4666-8666-666666666666',
    address: ACTOR.address});
  await assert.rejects(() => createProtectedProviderJoinPort({graph: g.graph,
    config: config(), now: () => NOW}).resolve(WO, ACTOR),
  {code: 'SOURCE_ACTOR_CHANGED'});
  assert.equal(g.reads.length, 0);
});

test('contact identity mismatch withholds the proposed recipient pair', async () => {
  const data = rows();
  data.contact.fields.OutletACN = '99999999';
  const g = graphFor(data);
  const result = await createProtectedProviderJoinPort({graph: g.graph,
    config: config(), now: () => NOW}).resolve(WO, ACTOR);
  assert.deepEqual(result.to, []);
  assert.equal(result.recipientReviewRequired, true);
});
