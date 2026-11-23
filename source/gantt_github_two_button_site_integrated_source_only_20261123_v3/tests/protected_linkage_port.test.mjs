import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createProtectedLinkagePort} from '../src/compose_site.mjs';

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

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBSERVED = '2026-01-01T00:00:00Z';
const NOW = Date.parse('2026-01-01T01:00:00Z');
const LINK_UNTIL = '2026-01-01T01:05:00Z';
const FORM = 'F:1:1';
const CASE = sf18(`500${'a'.repeat(10)}01`);
const WO = sf18(`0WO${'a'.repeat(10)}01`);
const ADDRESS = {street: '101 EXAMPLE ST', street2: 'UNIT A',
  city: 'SAMPLE CITY', state: 'OH', zip: '43001'};
const PAIR = {installManagerEmail: 'manager@example.invalid',
  plannerEmail: 'planner@example.invalid'};
const TO = [PAIR.installManagerEmail, PAIR.plannerEmail];

function inventedReadAndPacket() {
  const assignedSpName = 'K79 - Example Provider';
  const v4Read = {
    binding: 'reviewed-release-binding',
    validUntilMs: NOW + 10 * 60_000,
    source: {id: WO, eligibility: 'preinstall_snapshot_candidate',
      draftSuggestionAllowed: true, chartStatusMatchesOverlay: true,
      sourceAsOfUtc: OBSERVED, recipientSuggestion: 'exact_saved_file_pair',
      to: TO},
    facts: {datedPhase: 'Pending Readiness', scopeClass: 'fountain',
      overlay: {observedAtUtc: OBSERVED}, wo: {id: WO},
      snapshot: {projects: [{caseKey: FORM, formStore: '201',
        formAddress: ADDRESS, cases: [{id: CASE, workOrders: [{id: WO,
          number: '12345', acn: '301', woStore: '201',
          assignedSpAgentCode: 'K79', thirstyServiceAddress: ADDRESS,
          nativeFields: {'Assigned SP - Name': assignedSpName}}]}]}]}}};
  const packet = {schema: 'ArbysReviewedLinkageEvidence/v1',
    observedAtUtc: OBSERVED,
    projects: [{formSourceKey: FORM, formStoreNumber: '201',
      formAddress: ADDRESS, cases: [{nativeCaseId: CASE,
        linkedFormSourceKey: FORM, customerAcn: '301',
        workOrders: [{nativeWorkOrderId: WO, nativeCaseId: CASE,
          workOrderNumber: '12345', storeNumber: '201', outletAcn: '301',
          serviceAddress: ADDRESS, assignedSpName,
          assignedSpAgentCode: 'K79'}]}]}],
    linkageRows: [{storeNumber: '201', outletAcn: '301',
      serviceAddress: ADDRESS, agentCode: 'K79', ...PAIR}],
    directoryRows: [{agentCode: 'K79', ...PAIR}]};
  return {v4Read, packet};
}

test('missing, partial, or chart-loader-aliased readers never make a port', () => {
  const chart = async () => ({html: 'invented'});
  const evidence = async () => '{}';
  const approval = async () => ({});
  const base = {approvedOwnerOids: [OWNER], clock: () => NOW,
    loadAuthenticatedChart: chart};
  assert.equal(createProtectedLinkagePort(base), null);
  assert.equal(createProtectedLinkagePort({...base,
    readCurrentProtectedLinkageEvidenceJson: evidence}), null);
  assert.equal(createProtectedLinkagePort({...base,
    readCurrentProtectedLinkageEvidenceJson: evidence,
    readCurrentProtectedLinkageOwnerApproval: evidence}), null);
  assert.equal(createProtectedLinkagePort({...base,
    readCurrentProtectedLinkageEvidenceJson: chart,
    readCurrentProtectedLinkageOwnerApproval: approval}), null);
  assert.equal(createProtectedLinkagePort({...base,
    readCurrentProtectedLinkageEvidenceJson: evidence,
    readCurrentProtectedLinkageOwnerApproval: chart}), null);
});

test('invented protected packet binds exact native WO, Case, FORM, pair, and release', async () => {
  const {v4Read, packet} = inventedReadAndPacket();
  const evidenceJson = JSON.stringify(packet);
  const ownerApproval = {schema: 'ArbysLinkageOwnerApproval/v1',
    payloadSha256: createHash('sha256').update(evidenceJson).digest('hex'),
    observedAtUtc: OBSERVED, approvedAtUtc: '2026-01-01T00:10:00Z',
    modifiedAtUtc: '2026-01-01T00:11:00Z', validUntilUtc: LINK_UNTIL,
    approvedByOid: OWNER, modifiedByOid: OWNER, etag: 'approved-etag'};
  let evidenceReads = 0;
  let approvalReads = 0;
  const port = createProtectedLinkagePort({
    readCurrentProtectedLinkageEvidenceJson: async id => {
      assert.equal(id, WO); evidenceReads++; return evidenceJson;
    },
    readCurrentProtectedLinkageOwnerApproval: async id => {
      assert.equal(id, WO); approvalReads++; return {...ownerApproval};
    },
    approvedOwnerOids: [OWNER], clock: () => NOW,
    loadAuthenticatedChart: async () => { throw new Error('not a reader'); },
  });
  const first = await port.verify(v4Read, WO);
  assert.equal(first.nativeWorkOrderId, WO);
  assert.equal(first.nativeCaseId, CASE);
  assert.equal(first.formSourceKey, FORM);
  assert.equal(first.matchMethod, 'exact_store_acn_agent');
  assert.deepEqual(first.recipientSuggestion, TO);
  assert.equal(first.validUntilMs, Date.parse(LINK_UNTIL));
  assert.deepEqual(JSON.parse(first.binding), [v4Read.binding,
    ownerApproval.etag, ownerApproval.payloadSha256,
    ownerApproval.approvedAtUtc, ownerApproval.validUntilUtc,
    WO, CASE, FORM, 'exact_store_acn_agent', TO]);
  const reread = await port.verify(v4Read, WO);
  port.assertSame(first, reread);
  assert.equal(evidenceReads, 2);
  assert.equal(approvalReads, 2);
  const changedRelease = await port.verify({...v4Read,
    binding: 'changed-release-binding'}, WO);
  assert.throws(() => port.assertSame(first, changedRelease),
    error => error?.code === 'LINKAGE_CHANGED_DURING_DRAFT');
});
