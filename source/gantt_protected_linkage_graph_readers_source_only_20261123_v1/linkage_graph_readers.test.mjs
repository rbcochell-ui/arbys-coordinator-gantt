import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProtectedLinkageGraphReaders, ProtectedLinkageReadHeldError,
  EVIDENCE_KEY, RELEASE_KEY, EVIDENCE_LIST_TITLE, RELEASE_LIST_TITLE} from
  './linkage_graph_readers.mjs';
import {createLinkageVerificationPort} from
  '../gantt_linkage_read_adapter_source_only_v1/linkage_read_adapter.mjs';

function sf18(base) {
  assert.equal(base.length, 15);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(base[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return base + suffix;
}

const SITE = 'https://groups.coca-cola.com/sites/ArbysOperations';
const SITE_ID = 'groups.coca-cola.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';
const RELEASE_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';
const OWNER = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const CASE = sf18(`500${'a'.repeat(10)}01`);
const WO = sf18(`0WO${'a'.repeat(10)}01`);
const FORM = 'F:1:1';
const OBSERVED = '2026-11-23T10:00:00Z';
const NOW = Date.parse('2026-11-23T11:00:00Z');
const ADDRESS = {street: '101 EXAMPLE ST', street2: '',
  city: 'SAMPLE CITY', state: 'OH', zip: '43001-1234'};
const PAIR = {installManagerEmail: 'manager@example.invalid',
  plannerEmail: 'planner@example.invalid'};
const packet = JSON.stringify({schema: 'ArbysReviewedLinkageEvidence/v1',
  observedAtUtc: OBSERVED,
  projects: [{formSourceKey: FORM, formStoreNumber: '201',
    formAddress: ADDRESS, cases: [{nativeCaseId: CASE,
      linkedFormSourceKey: FORM, customerAcn: '301', workOrders: [{
        nativeWorkOrderId: WO, nativeCaseId: CASE,
        workOrderNumber: '401', storeNumber: '201', outletAcn: '301',
        serviceAddress: ADDRESS, assignedSpName: 'Z99 - Example Provider',
        assignedSpAgentCode: 'Z99'}]}]}],
  linkageRows: [{storeNumber: '201', outletAcn: '301',
    serviceAddress: ADDRESS, agentCode: 'Z99', ...PAIR}],
  directoryRows: [{agentCode: 'Z99', ...PAIR}]});
const digest = createHash('sha256').update(packet).digest('hex');
const approval = JSON.stringify({schema: 'ArbysLinkageOwnerApproval/v1',
  payloadSha256: digest, observedAtUtc: OBSERVED,
  approvedAtUtc: '2026-11-23T10:10:00Z',
  validUntilUtc: '2026-11-24T09:59:00Z', approvedByOid: OWNER});

function item(id, fields, etag = '"1"', modifiedBy = OWNER) {
  return {id, eTag: etag,
    lastModifiedBy: {user: {id: modifiedBy}},
    lastModifiedDateTime: '2026-11-23T10:11:00Z', fields};
}
function fixture() {
  const state = {
    actor: ACTOR, calls: [], nextLink: false, evidenceRows: [item('1',
      {EvidenceKey: EVIDENCE_KEY, EvidenceJson: packet})],
    releaseRows: [item('1', {ReleaseKey: RELEASE_KEY,
      ReleaseState: 'Approved', LinkageApprovalJson: approval})],
    directEvidence: null, directRelease: null,
  };
  const graph = {
    async getMe() { return {id: state.actor, address: 'coordinator@example.invalid'}; },
    async request(path, options) {
      state.calls.push({path, options});
      const url = new URL(path, 'https://graph.microsoft.com');
      const isEvidence = url.pathname.includes(EVIDENCE_ID);
      const isRelease = url.pathname.includes(RELEASE_ID);
      if (!isEvidence && !isRelease) throw new Error('Unpinned List');
      const id = isEvidence ? EVIDENCE_ID : RELEASE_ID;
      const title = isEvidence ? EVIDENCE_LIST_TITLE : RELEASE_LIST_TITLE;
      if (url.pathname.endsWith(`/lists/${id}`)) {
        return {status: 200, data: {id, displayName: title,
          webUrl: `${SITE}/Lists/${encodeURIComponent(title)}`}};
      }
      if (url.pathname.endsWith('/items')) {
        const data = {value: isEvidence ? state.evidenceRows : state.releaseRows};
        if (state.nextLink) data['@odata.nextLink'] = 'not-allowed';
        return {status: 200, data};
      }
      if (url.pathname.endsWith('/items/1')) {
        return {status: 200, data: isEvidence ?
          (state.directEvidence ?? state.evidenceRows[0]) :
          (state.directRelease ?? state.releaseRows[0])};
      }
      throw new Error('Unexpected Graph route');
    },
  };
  const readers = createProtectedLinkageGraphReaders({graph, siteId: SITE_ID,
    siteUrl: SITE, evidenceListId: EVIDENCE_ID, releaseListId: RELEASE_ID,
    coordinatorOids: [ACTOR], ownerOids: [OWNER]});
  return {state, readers};
}
async function holds(promise, code) {
  await assert.rejects(promise, error =>
    error instanceof ProtectedLinkageReadHeldError && error.code === code);
}

test('two protected readers return exact bytes and Graph-derived owner metadata', async () => {
  const {state, readers} = fixture();
  assert.equal(await readers.readCurrentProtectedLinkageEvidenceJson(WO), packet);
  const result = await readers.readCurrentProtectedLinkageOwnerApproval(WO);
  assert.equal(result.payloadSha256, digest);
  assert.equal(result.modifiedByOid, OWNER);
  assert.equal(result.modifiedAtUtc, '2026-11-23T10:11:00Z');
  assert.equal(result.etag, '"1"');
  assert.equal(state.calls.length, 6);
  assert(state.calls.every(call => call.options?.scopes?.length &&
    call.options.method === undefined));
  await readers.readCurrentProtectedLinkageEvidenceJson(WO);
  assert.equal(state.calls.length, 9, 'fresh reads make fresh Graph requests');
});

test('fresh Graph readers feed V5 linkage port with a checksummed native WO', async () => {
  const {readers, state} = fixture();
  const chartWo = {id: WO, number: '401', woStore: '201', acn: '301',
    assignedSpAgentCode: 'Z99', assignedSpName: 'Example Provider',
    thirstyServiceAddress: ADDRESS,
    nativeFields: {'Assigned SP - Name': 'Z99 - Example Provider'}};
  const v4Read = {
    binding: 'invented-release-binding',
    validUntilMs: Date.parse('2026-11-23T12:00:00Z'),
    source: {id: WO, eligibility: 'preinstall_snapshot_candidate',
      draftSuggestionAllowed: true, chartStatusMatchesOverlay: true,
      sourceAsOfUtc: OBSERVED, recipientSuggestion: 'exact_saved_file_pair',
      to: [PAIR.installManagerEmail, PAIR.plannerEmail]},
    facts: {snapshot: {projects: [{caseKey: FORM, formStore: '201',
      formAddress: ADDRESS, cases: [{id: CASE, workOrders: [chartWo]}]}]},
      overlay: {observedAtUtc: OBSERVED}, wo: chartWo,
      datedPhase: 'Pending Readiness', scopeClass: 'fountain'},
  };
  const port = createLinkageVerificationPort({
    readCurrentEvidenceJson: readers.readCurrentProtectedLinkageEvidenceJson,
    readOwnerApproval: readers.readCurrentProtectedLinkageOwnerApproval,
    approvedOwnerOids: [OWNER], clock: () => NOW,
  });
  const verified = await port.verify(v4Read, WO);
  assert.equal(verified.nativeWorkOrderId, WO);
  assert.equal(verified.nativeCaseId, CASE);
  assert.equal(verified.formSourceKey, FORM);
  assert.equal(verified.matchMethod, 'exact_store_acn_agent');
  assert.deepEqual(verified.recipientSuggestion,
    [PAIR.installManagerEmail, PAIR.plannerEmail]);
  assert.equal(verified.sendAllowed, false);
  assert.equal(state.calls.length, 6);
});

test('missing or duplicate rows and pagination hold before returning a packet', async () => {
  const a = fixture();
  a.state.evidenceRows = [];
  await holds(a.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_LIST_NOT_SINGLETON');
  const b = fixture();
  b.state.evidenceRows.push(item('2', b.state.evidenceRows[0].fields));
  await holds(b.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_LIST_NOT_SINGLETON');
  const c = fixture();
  c.state.nextLink = true;
  await holds(c.readers.readCurrentProtectedLinkageOwnerApproval(WO),
    'LINKAGE_LIST_NOT_SINGLETON');
});

test('owner, actor, approval and ETag drift all hold', async () => {
  const a = fixture();
  a.state.evidenceRows[0].lastModifiedBy.user.id = OTHER;
  await holds(a.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_OWNER_OR_KEY_UNVERIFIED');
  const b = fixture();
  b.state.directEvidence = item('1', b.state.evidenceRows[0].fields, '"2"');
  await holds(b.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_CHANGED_DURING_READ');
  const c = fixture();
  c.state.releaseRows[0].fields.LinkageApprovalJson = JSON.stringify({
    ...JSON.parse(approval), approvedByOid: OTHER});
  await holds(c.readers.readCurrentProtectedLinkageOwnerApproval(WO),
    'LINKAGE_APPROVAL_INVALID');
  const d = fixture();
  await d.readers.readCurrentProtectedLinkageEvidenceJson(WO);
  d.state.actor = OTHER;
  await holds(d.readers.readCurrentProtectedLinkageOwnerApproval(WO),
    'LINKAGE_ACTOR_UNVERIFIED');
});

test('invalid native WO and release state never authorize a protected read', async () => {
  const a = fixture();
  await holds(a.readers.readCurrentProtectedLinkageEvidenceJson('1234567'),
    'LINKAGE_NATIVE_WO_REQUIRED');
  assert.equal(a.state.calls.length, 0);
  const b = fixture();
  b.state.releaseRows[0].fields.ReleaseState = 'Revoked';
  await holds(b.readers.readCurrentProtectedLinkageOwnerApproval(WO),
    'LINKAGE_RELEASE_NOT_APPROVED');
});

test('truncated and oversized evidence fail closed', async () => {
  const a = fixture();
  a.state.evidenceRows[0].fields.EvidenceJson = packet.slice(0, -1);
  await holds(a.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_EVIDENCE_INVALID');
  const b = fixture();
  b.state.evidenceRows[0].fields.EvidenceJson = JSON.stringify({
    schema: 'ArbysReviewedLinkageEvidence/v1', observedAtUtc: OBSERVED,
    projects: [], linkageRows: [], directoryRows: [],
    padding: 'x'.repeat(60_000)});
  await holds(b.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_EVIDENCE_SIZE_INVALID');
});

test('packet must contain the selected native WO exactly once', async () => {
  const a = fixture();
  a.state.evidenceRows[0].fields.EvidenceJson = JSON.stringify({
    ...JSON.parse(packet), projects: []});
  await holds(a.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_SELECTED_WO_NOT_SINGLETON');
  const b = fixture();
  const copy = JSON.parse(packet);
  copy.projects[0].cases[0].workOrders.push({nativeWorkOrderId: WO});
  b.state.evidenceRows[0].fields.EvidenceJson = JSON.stringify(copy);
  await holds(b.readers.readCurrentProtectedLinkageEvidenceJson(WO),
    'LINKAGE_SELECTED_WO_NOT_SINGLETON');
});
