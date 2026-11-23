import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {assertSameLinkage, createLinkageVerificationPort, LinkageReadHeldError,
  verifyLinkageAtRead} from './linkage_read_adapter.mjs';

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
const APPROVED = '2026-01-01T00:10:00Z';
const MODIFIED = '2026-01-01T00:11:00Z';
const UNTIL = '2026-01-01T12:00:00Z';
const NOW = Date.parse('2026-01-01T01:00:00Z');
const CASE = sf18(`500${'a'.repeat(10)}01`);
const WO = sf18(`0WO${'a'.repeat(10)}01`);
const FORM = 'F:1:1';
const ADDRESS = {street: '101 EXAMPLE ST', street2: '',
  city: 'SAMPLE CITY', state: 'OH', zip: '43001-1234'};
const PAIR = {installManagerEmail: 'manager@example.invalid',
  plannerEmail: 'planner@example.invalid'};

function fixture() {
  const packet = {
    schema: 'ArbysReviewedLinkageEvidence/v1', observedAtUtc: OBSERVED,
    projects: [{formSourceKey: FORM, formStoreNumber: '201',
      formAddress: {...ADDRESS}, cases: [{nativeCaseId: CASE,
        linkedFormSourceKey: FORM, customerAcn: '301', workOrders: [{
          nativeWorkOrderId: WO, nativeCaseId: CASE,
          workOrderNumber: '401', storeNumber: '201', outletAcn: '301',
          serviceAddress: {...ADDRESS},
          assignedSpName: 'K79 - Example Provider',
          assignedSpAgentCode: 'K79',
        }]}]}],
    linkageRows: [{storeNumber: '201', outletAcn: '301',
      serviceAddress: {...ADDRESS}, agentCode: 'K79', ...PAIR}],
    directoryRows: [{agentCode: 'K79', ...PAIR}],
  };
  const chartWo = {id: WO, number: '401', woStore: '201', acn: '301',
    assignedSpAgentCode: 'K79', assignedSpName: 'Example Provider',
    thirstyServiceAddress: {...ADDRESS},
    nativeFields: {'Assigned SP - Name': 'K79 - Example Provider'}};
  const v4Read = {
    binding: 'synthetic-v4-release-binding',
    validUntilMs: Date.parse('2026-01-01T02:00:00Z'),
    source: {id: WO, eligibility: 'preinstall_snapshot_candidate',
      draftSuggestionAllowed: true, chartStatusMatchesOverlay: true,
      sourceAsOfUtc: OBSERVED, recipientSuggestion: 'exact_saved_file_pair',
      to: [PAIR.installManagerEmail, PAIR.plannerEmail]},
    facts: {snapshot: {projects: [{caseKey: FORM, formStore: '201',
      formAddress: {...ADDRESS}, cases: [{id: CASE,
        workOrders: [chartWo]}]}]},
      overlay: {observedAtUtc: OBSERVED}, wo: chartWo,
      datedPhase: 'Pending Readiness', scopeClass: 'fountain'},
  };
  const approval = {
    schema: 'ArbysLinkageOwnerApproval/v1', payloadSha256: '',
    observedAtUtc: OBSERVED, approvedAtUtc: APPROVED,
    modifiedAtUtc: MODIFIED, validUntilUtc: UNTIL,
    approvedByOid: OWNER, modifiedByOid: OWNER, etag: 'etag-v1',
  };
  return {packet, v4Read, ownerApproval: approval, approvedOwnerOids: [OWNER],
    selectedNativeWorkOrderId: WO, nowMs: NOW};
}

function signed(input) {
  const evidenceJson = JSON.stringify(input.packet);
  input.ownerApproval.payloadSha256 = createHash('sha256')
    .update(evidenceJson).digest('hex');
  return {...input, evidenceJson};
}
async function code(promise, expected) {
  await assert.rejects(promise, error =>
    error instanceof LinkageReadHeldError && error.code === expected);
}

test('initial, latest, and postclaim reads each re-evaluate one approved native selection', async () => {
  const input = signed(fixture());
  const initial = await verifyLinkageAtRead(input);
  const latest = await verifyLinkageAtRead(structuredClone(input));
  const postclaim = await verifyLinkageAtRead(structuredClone(input));
  assertSameLinkage(initial, latest);
  assertSameLinkage(initial, postclaim);
  assert.equal(initial.matchMethod, 'exact_store_acn_agent');
  assert.equal(initial.sendAllowed, false);
  assert.equal(initial.nativeCaseId, CASE);
  assert.deepEqual(initial.recipientSuggestion,
    [PAIR.installManagerEmail, PAIR.plannerEmail]);
});

test('missing packet or separate owner approval holds before candidate use', async () => {
  const input = signed(fixture());
  await code(verifyLinkageAtRead({...input, evidenceJson: null}),
    'EVIDENCE_ABSENT');
  await code(verifyLinkageAtRead({...input, ownerApproval: null}),
    'OWNER_APPROVAL_UNVERIFIED');
});

test('unreviewed packet mutation and expired approval both hold', async () => {
  const input = signed(fixture());
  input.packet.projects[0].cases[0].customerAcn = '999';
  await code(verifyLinkageAtRead({...input,
    evidenceJson: JSON.stringify(input.packet)}),
  'OWNER_APPROVAL_UNVERIFIED');
  const expired = signed(fixture());
  expired.nowMs = Date.parse('2026-01-01T12:00:00Z');
  expired.v4Read.validUntilMs = Date.parse('2026-01-02T00:00:00Z');
  await code(verifyLinkageAtRead(expired), 'LINKAGE_EVIDENCE_EXPIRED');
});

test('Case ACN conflict and missing independent Assigned SP evidence hold', async () => {
  const acn = fixture();
  acn.packet.projects[0].cases[0].customerAcn = '999';
  await code(verifyLinkageAtRead(signed(acn)), 'LINKAGE_ACN_CONFLICT');
  const bridgeOnly = fixture();
  delete bridgeOnly.v4Read.facts.wo.nativeFields;
  bridgeOnly.packet.projects[0].cases[0].workOrders[0].assignedSpName =
    'Example Provider';
  await code(verifyLinkageAtRead(signed(bridgeOnly)),
    'LINKAGE_AGENT_UNVERIFIED');
});

test('bridge-only chart needs a separately reviewed combined Assigned SP field', async () => {
  const input = fixture();
  delete input.v4Read.facts.wo.nativeFields;
  const result = await verifyLinkageAtRead(signed(input));
  assert.equal(result.matchMethod, 'exact_store_acn_agent');
  assert.equal(result.sendAllowed, false);
});

test('missing FORM store uses exact address; missing WO store still holds', async () => {
  const unknownForm = fixture();
  unknownForm.packet.projects[0].formStoreNumber = 'A';
  unknownForm.v4Read.facts.snapshot.projects[0].formStore = 'A';
  const decision = await verifyLinkageAtRead(signed(unknownForm));
  assert.equal(decision.matchMethod, 'exact_address_acn_agent');
  assert.deepEqual(decision.reviewFlags, ['FORM_STORE_UNKNOWN']);

  const missingWo = fixture();
  missingWo.packet.projects[0].cases[0].workOrders[0].storeNumber =
    'Unknown';
  missingWo.v4Read.facts.wo.woStore = 'Unknown';
  await code(verifyLinkageAtRead(signed(missingWo)),
    'LINKAGE_WO_STORE_MISSING');
});

test('unknown-store fallback rejects address conflict and shared location', async () => {
  const conflict = fixture();
  conflict.packet.projects[0].formStoreNumber = 'A';
  conflict.v4Read.facts.snapshot.projects[0].formStore = 'A';
  conflict.packet.projects[0].cases[0].workOrders[0]
    .serviceAddress.street = '103 OTHER ST';
  conflict.v4Read.facts.wo.thirstyServiceAddress.street = '103 OTHER ST';
  await code(verifyLinkageAtRead(signed(conflict)),
    'LINKAGE_ADDRESS_CONFLICT');

  const ambiguous = fixture();
  ambiguous.packet.projects[0].formStoreNumber = 'A';
  ambiguous.v4Read.facts.snapshot.projects[0].formStore = 'A';
  const second = structuredClone(ambiguous.packet.projects[0]);
  second.formSourceKey = 'F:1:2';
  second.cases[0].nativeCaseId = sf18(`500${'a'.repeat(10)}02`);
  second.cases[0].linkedFormSourceKey = second.formSourceKey;
  second.cases[0].workOrders[0].nativeCaseId =
    second.cases[0].nativeCaseId;
  second.cases[0].workOrders[0].nativeWorkOrderId =
    sf18(`0WO${'a'.repeat(10)}02`);
  second.cases[0].workOrders[0].workOrderNumber = '402';
  second.cases[0].workOrders[0].storeNumber = '202';
  ambiguous.packet.projects.push(second);
  const secondChart = structuredClone(
    ambiguous.v4Read.facts.snapshot.projects[0]);
  secondChart.caseKey = second.formSourceKey;
  secondChart.cases[0].id = second.cases[0].nativeCaseId;
  secondChart.cases[0].workOrders[0].id =
    second.cases[0].workOrders[0].nativeWorkOrderId;
  secondChart.cases[0].workOrders[0].number = '402';
  secondChart.cases[0].workOrders[0].woStore = '202';
  ambiguous.v4Read.facts.snapshot.projects.push(secondChart);
  await code(verifyLinkageAtRead(signed(ambiguous)),
    'LINKAGE_AMBIGUOUS_FORM_ADDRESS');
});

test('unknown-store fallback rejects chart-vs-packet suite drift or omitted line2', async () => {
  const suiteDrift = fixture();
  suiteDrift.packet.projects[0].formStoreNumber = 'A';
  suiteDrift.v4Read.facts.snapshot.projects[0].formStore = 'A';
  suiteDrift.packet.projects[0].formAddress.street2 = 'STE 2';
  suiteDrift.packet.projects[0].cases[0].workOrders[0]
    .serviceAddress.street2 = 'STE 2';
  suiteDrift.v4Read.facts.snapshot.projects[0].formAddress.street2 =
    'STE 3';
  suiteDrift.v4Read.facts.wo.thirstyServiceAddress.street2 = 'STE 3';
  await code(verifyLinkageAtRead(signed(suiteDrift)),
    'CHART_FALLBACK_ADDRESS_UNVERIFIED');

  const noChartLine2 = fixture();
  noChartLine2.packet.projects[0].formStoreNumber = 'A';
  noChartLine2.v4Read.facts.snapshot.projects[0].formStore = 'A';
  delete noChartLine2.v4Read.facts.snapshot.projects[0]
    .formAddress.street2;
  await code(verifyLinkageAtRead(signed(noChartLine2)),
    'CHART_FALLBACK_ADDRESS_UNVERIFIED');

  const noWoLine2 = fixture();
  noWoLine2.packet.projects[0].formStoreNumber = 'A';
  noWoLine2.v4Read.facts.snapshot.projects[0].formStore = 'A';
  delete noWoLine2.v4Read.facts.wo.thirstyServiceAddress.street2;
  await code(verifyLinkageAtRead(signed(noWoLine2)),
    'CHART_FALLBACK_ADDRESS_UNVERIFIED');
});

test('native 18-character selection cannot be replaced by number or short ID', async () => {
  const input = signed(fixture());
  await code(verifyLinkageAtRead({...input,
    selectedNativeWorkOrderId: '401'}), 'V4_SOURCE_NOT_ELIGIBLE');
  await code(verifyLinkageAtRead({...input,
    selectedNativeWorkOrderId: WO.slice(0, 15)}),
  'V4_SOURCE_NOT_ELIGIBLE');
});

test('charted Case and work-order identity must equal protected evidence', async () => {
  const input = fixture();
  input.v4Read.facts.snapshot.projects[0].cases[0].id =
    sf18(`500${'a'.repeat(10)}02`);
  await code(verifyLinkageAtRead(signed(input)),
    'CHART_LINKAGE_EVIDENCE_MISMATCH');
});

test('full cohort parent-child edges must match, even for another WO', async () => {
  const input = fixture();
  const firstCase = input.packet.projects[0].cases[0];
  const secondCase = structuredClone(firstCase);
  secondCase.nativeCaseId = sf18(`500${'a'.repeat(10)}02`);
  secondCase.workOrders[0].nativeCaseId = secondCase.nativeCaseId;
  secondCase.workOrders[0].nativeWorkOrderId =
    sf18(`0WO${'a'.repeat(10)}02`);
  secondCase.workOrders[0].workOrderNumber = '402';
  input.packet.projects[0].cases.push(secondCase);
  const chartSecond = structuredClone(
    input.v4Read.facts.snapshot.projects[0].cases[0]);
  chartSecond.id = secondCase.nativeCaseId;
  chartSecond.workOrders[0].id =
    secondCase.workOrders[0].nativeWorkOrderId;
  chartSecond.workOrders[0].number = '402';
  input.v4Read.facts.snapshot.projects[0].cases.push(chartSecond);
  const moved = secondCase.workOrders.pop();
  moved.nativeCaseId = firstCase.nativeCaseId;
  firstCase.workOrders.push(moved);
  await code(verifyLinkageAtRead(signed(input)),
    'CHART_LINKAGE_EVIDENCE_MISMATCH');
});

test('reviewed linkage packet must be at least as fresh as the V4 source', async () => {
  const input = fixture();
  input.v4Read.source.sourceAsOfUtc = '2026-01-01T00:05:00Z';
  input.v4Read.facts.overlay.observedAtUtc =
    input.v4Read.source.sourceAsOfUtc;
  await code(verifyLinkageAtRead(signed(input)),
    'LINKAGE_EVIDENCE_OLDER_THAN_V4');
});

test('contact change requires a new chart/release and never silently changes To', async () => {
  const input = fixture();
  input.packet.linkageRows[0].plannerEmail = 'newplanner@example.invalid';
  input.packet.directoryRows[0].plannerEmail = 'newplanner@example.invalid';
  await code(verifyLinkageAtRead(signed(input)),
    'DATED_RECIPIENT_MISMATCH');
});

test('approval ETag or V4 phase drift between stages fails before first draft', async () => {
  const input = signed(fixture());
  const first = await verifyLinkageAtRead(input);
  const changedEtag = structuredClone(input);
  changedEtag.ownerApproval.etag = 'etag-v2';
  const later = await verifyLinkageAtRead(changedEtag);
  assert.throws(() => assertSameLinkage(first, later), error =>
    error instanceof LinkageReadHeldError &&
    error.code === 'LINKAGE_CHANGED_DURING_DRAFT');
  const changedPhase = structuredClone(input);
  changedPhase.v4Read.facts.datedPhase = 'Pending Scheduled Date';
  const postclaim = await verifyLinkageAtRead(changedPhase);
  assert.throws(() => assertSameLinkage(first, postclaim), error =>
    error instanceof LinkageReadHeldError &&
    error.code === 'LINKAGE_CHANGED_DURING_DRAFT');
});

test('a stale or terminal V4 source cannot be rescued by current linkage evidence', async () => {
  const input = signed(fixture());
  input.v4Read.source.eligibility = 'source_stale';
  await code(verifyLinkageAtRead(input), 'V4_SOURCE_NOT_ELIGIBLE');
});

test('port performs separate fresh reads at initial, latest, and postclaim', async () => {
  const input = signed(fixture());
  const calls = {evidence: 0, approval: 0};
  const port = createLinkageVerificationPort({
    readCurrentEvidenceJson: async id => {
      assert.equal(id, WO);
      calls.evidence++;
      return input.evidenceJson;
    },
    readOwnerApproval: async id => {
      assert.equal(id, WO);
      calls.approval++;
      return structuredClone(input.ownerApproval);
    },
    approvedOwnerOids: [OWNER],
    clock: () => NOW,
  });
  const initial = await port.verify(input.v4Read, WO);
  const latest = await port.verify(input.v4Read, WO);
  const postclaim = await port.verify(input.v4Read, WO);
  port.assertSame(initial, latest);
  port.assertSame(initial, postclaim);
  assert.deepEqual(calls, {evidence: 3, approval: 3});
});
