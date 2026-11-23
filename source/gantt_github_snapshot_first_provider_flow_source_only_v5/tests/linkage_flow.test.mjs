import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {GanttReleaseReader, GANTT_RELEASE_KEY} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs';
import {createLinkageVerificationPort} from
  '../../gantt_linkage_read_adapter_source_only_v1/linkage_read_adapter.mjs';
import {createSnapshotFirstProviderFlow} from
  '../snapshot_first_provider_flow.mjs';
import {createV2ParentAdapter} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/snapshot_parent_adapter.mjs';
import {RUNTIME_CONFIG} from '../runtime_config.mjs';

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

const OBSERVED = '2026-01-01T00:00:00Z';
const NOW = Date.parse('2026-01-01T01:00:00Z');
const LINK_UNTIL = '2026-01-01T01:05:00Z';
const LINK_UNTIL_ISO = new Date(Date.parse(LINK_UNTIL)).toISOString();
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  address: 'coordinator@example.invalid'};
const SITE_ID = 'example.invalid,cccccccc-cccc-4ccc-8ccc-cccccccccccc,dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LIST_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SITE_URL = 'https://example.invalid/site';
const PAYLOAD_URL = 'https://example.invalid/opaque.enc';
const FORM = 'F:1:1';
const CASE = sf18(`500${'a'.repeat(10)}01`);
const WO = sf18(`0WO${'a'.repeat(10)}01`);
const NUMBER = '12345';
const ADDRESS = {street: '101 EXAMPLE ST', street2: '',
  city: 'SAMPLE CITY', state: 'OH', zip: '43001-1234'};
const PAIR = {installManagerEmail: 'manager@example.invalid',
  plannerEmail: 'planner@example.invalid'};
const hash = value => createHash('sha256').update(value).digest('hex');

function htmlFor(f) {
  return '<!doctype html><html><head>' +
    `<script type="application/json" id="snapshotData">${JSON.stringify(f.snapshot)}</script>` +
    `<script type="application/json" id="providerVisitSourceOverlay">${JSON.stringify(f.overlay)}</script>` +
    '</head><body>Invented chart</body></html>';
}

function fixture({unknownFormStore = false} = {}) {
  const store = unknownFormStore ? 'A' : '201';
  const rawAgent = 'K79 - Example Provider';
  const wo = {id: WO, number: NUMBER, type: 'Installation',
    status: 'Pending Readiness', serviceType: 'A - Install Fountain Equipment',
    assignedSpAgentCode: 'K79', assignedSpName: 'Example Provider',
    acn: '301', woStore: '201', thirstyServiceAddress: {...ADDRESS},
    nativeFields: {'Work Order ID': WO.slice(0, 15),
      'Work Order Number': NUMBER, 'Assigned SP - Name': rawAgent},
    providerContactCandidate: {state: 'two_source_file_candidate', ...PAIR}};
  const snapshot = {schema: 'arbys-local-exact-form-project-preview/v16',
    asOfDate: '2026-01-01', counts: {nativeWorkOrders: 1},
    projects: [{caseKey: FORM, formStore: store,
      formAddress: {...ADDRESS}, cases: [{id: CASE, workOrders: [wo]}]}]};
  const overlay = {schema: 'ArbysProviderVisitSourceOverlay/v2',
    observedAtUtc: OBSERVED, reportId: `00O${'a'.repeat(15)}`,
    sourceRows: 1, sourceSha256: 'b'.repeat(64),
    rows: {[WO]: {nativeWorkOrderId: WO.slice(0, 15),
      workOrderNumber: NUMBER, activityType: 'Installation',
      workOrderType: 'Installation', serviceType: wo.serviceType,
      status: 'Pending Readiness', hold: '0', spStatus: ''}}};
  const packet = {schema: 'ArbysReviewedLinkageEvidence/v1',
    observedAtUtc: OBSERVED,
    projects: [{formSourceKey: FORM, formStoreNumber: store,
      formAddress: {...ADDRESS}, cases: [{nativeCaseId: CASE,
        linkedFormSourceKey: FORM, customerAcn: '301',
        workOrders: [{nativeWorkOrderId: WO, nativeCaseId: CASE,
          workOrderNumber: NUMBER, storeNumber: '201', outletAcn: '301',
          serviceAddress: {...ADDRESS}, assignedSpName: rawAgent,
          assignedSpAgentCode: 'K79'}]}]}],
    linkageRows: [{storeNumber: '201', outletAcn: '301',
      serviceAddress: {...ADDRESS}, agentCode: 'K79', ...PAIR}],
    directoryRows: [{agentCode: 'K79', ...PAIR}]};
  const f = {nowMs: NOW, snapshot, overlay, packet,
    ciphertextBytes: new TextEncoder().encode('invented ciphertext'),
    release: {id: '1', etag: 'etag-release', siteId: SITE_ID,
      listId: LIST_ID, payloadUrl: PAYLOAD_URL,
      modifiedBy: OWNER, modifiedAt: '2026-01-01T00:11:00Z',
      fields: {ReleaseKey: GANTT_RELEASE_KEY,
        ReleaseState: 'Approved',
        EncryptedPayloadUrl: PAYLOAD_URL,
        SnapshotAsOfDate: snapshot.asOfDate,
        OverlayObservedAtUtc: overlay.observedAtUtc,
        SourceReportSha256: overlay.sourceSha256,
        ApprovedAtUtc: '2026-01-01T00:10:00Z',
        ValidUntilUtc: '2026-01-01T12:00:00Z',
        ApprovedByOid: OWNER}}};
  f.release.fields.DecryptedHtmlSha256 = hash(htmlFor(f));
  f.release.fields.EncryptedPayloadSha256 = hash(f.ciphertextBytes);
  return f;
}

function reviewed(packet, etag = 'etag-linkage') {
  const evidenceJson = JSON.stringify(packet);
  return {evidenceJson, ownerApproval: {
    schema: 'ArbysLinkageOwnerApproval/v1',
    payloadSha256: hash(evidenceJson), observedAtUtc: OBSERVED,
    approvedAtUtc: '2026-01-01T00:10:00Z',
    modifiedAtUtc: '2026-01-01T00:11:00Z',
    validUntilUtc: LINK_UNTIL, approvedByOid: OWNER,
    modifiedByOid: OWNER, etag}};
}

class FakeReleaseReader extends GanttReleaseReader {
  constructor(f) {
    super({graph: {request: async () => {
      throw new Error('No network request permitted in fixture');
    }}, siteId: SITE_ID, listId: LIST_ID,
    siteUrl: SITE_URL, payloadUrl: PAYLOAD_URL});
    this.f = f;
  }
  async read() { return structuredClone(this.f.release); }
}

class FakeActionPort {
  constructor(f) {
    this.f = f;
    this.state = 'absent';
    this.createCalls = 0;
    this.resumeCalls = 0;
    this.postclaim = null;
    this.command = null;
    this.onClaim = null;
  }
  async observe(key) { return {status: this.state, dispatchKey: key}; }
  async resume() {
    this.resumeCalls++;
    return {status: this.state === 'draft_occupied'
      ? 'draft_review_required' : this.state};
  }
  async checkSent() { return {status: 'not_started'}; }
  async createFirstDraft(command) {
    this.createCalls++;
    this.command = command;
    this.state = 'claim_outcome_unverified';
    if (this.onClaim) this.onClaim();
    this.postclaim = await command.verifySourceAfterClaim();
    this.state = 'draft_occupied';
    return {status: 'draft'};
  }
}

function harness({f = fixture(), versions = null, absent = false,
    linkagePortOverride = null} = {}) {
  let evidenceReads = 0;
  let approvalReads = 0;
  const packets = versions ?? [reviewed(f.packet)];
  const linkagePort = createLinkageVerificationPort({
    readCurrentEvidenceJson: async id => {
      assert.equal(id, WO);
      const value = packets[Math.min(evidenceReads++, packets.length - 1)];
      return absent ? null : value.evidenceJson;
    },
    readOwnerApproval: async id => {
      assert.equal(id, WO);
      const value = packets[Math.min(approvalReads++, packets.length - 1)];
      return structuredClone(value.ownerApproval);
    },
    approvedOwnerOids: [OWNER], clock: () => f.nowMs,
  });
  const actionPort = new FakeActionPort(f);
  const releaseReader = new FakeReleaseReader(f);
  const flow = createSnapshotFirstProviderFlow({enabled: true,
    releaseReader, ownerOids: [OWNER],
    linkagePort: linkagePortOverride ?? linkagePort,
    loadAuthenticatedChart: async () => ({html: htmlFor(f),
      encryptedPayloadBytes: f.ciphertextBytes,
      encryptedPayloadUrl: PAYLOAD_URL}),
    getActor: async () => ACTOR,
    selectionPort: {capture: () => ({kind: 'provider', id: WO, epoch: 1}),
      isCurrent: token => token.id === WO && token.epoch === 1,
      ensureReady: async () => {}},
    actionPort, now: () => f.nowMs});
  return {f, flow, actionPort,
    counts: () => ({evidenceReads, approvalReads})};
}

const rejectsCode = (work, code) => assert.rejects(work,
  error => error?.code === code);

test('shipped V5 stays disabled and missing protected linkage holds preflight', async () => {
  assert.equal(RUNTIME_CONFIG.enabled, false);
  assert.equal(RUNTIME_CONFIG.linkagePort, null);
  assert.throws(() => createSnapshotFirstProviderFlow({enabled: true}),
    error => error?.code === 'LINKAGE_EVIDENCE_UNCONFIGURED');

  const f = fixture();
  const flow = createSnapshotFirstProviderFlow({enabled: false,
    releaseReader: new FakeReleaseReader(f), ownerOids: [OWNER],
    loadAuthenticatedChart: async () => ({html: htmlFor(f),
      encryptedPayloadBytes: f.ciphertextBytes,
      encryptedPayloadUrl: PAYLOAD_URL}),
    now: () => f.nowMs});
  const preview = await flow.snapshotPreview(WO);
  assert.equal(preview.eligibility, 'linkage_held');
  assert.equal(preview.reasonCode, 'LINKAGE_EVIDENCE_UNCONFIGURED');
  assert.equal(preview.canDraft, false);
  await rejectsCode(() => flow.draft(WO),
    'SNAPSHOT_PROVIDER_DRAFTS_DISABLED');
});

test('preview uses minimum V4 and owner-approval expiry without an action', async () => {
  const h = harness();
  const preview = await h.flow.preview(WO);
  assert.equal(preview.status, 'eligible');
  assert.equal(preview.validUntilUtc, LINK_UNTIL_ISO);
  assert.deepEqual(h.counts(), {evidenceReads: 1, approvalReads: 1});
  assert.equal(h.actionPort.createCalls, 0);
});

test('shared unverified Sent record stays occupied without a second draft', async () => {
  const h = harness();
  h.actionPort.state = 'sent_recorded_unverified';
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.existingStatus, 'sent_recorded_unverified');
  assert.equal(dated.canDraft, false);
  const preview = await h.flow.preview(WO);
  assert.equal(preview.status, 'sent_recorded_unverified');
  assert.deepEqual(preview.to, []);
  const resumed = await h.flow.draft(WO);
  assert.equal(resumed.status, 'sent_recorded_unverified');
  assert.equal(h.actionPort.createCalls, 0);
  assert.equal(h.actionPort.resumeCalls, 1);
  assert.deepEqual(h.counts(), {evidenceReads: 0, approvalReads: 0});
});

test('V5 and reviewed V4 parent adapter hold a shared unverified Sent row', async () => {
  const h = harness();
  h.actionPort.state = 'sent_recorded_unverified';
  const adapter = createV2ParentAdapter({enabled: true,
    providerFlow: h.flow, signIn: async () => {},
    actions: {preview: async () => { throw new Error('customer unused'); },
      customerDraft: async () => { throw new Error('customer unused'); },
      checkCustomerSent: async () => { throw new Error('customer unused'); }}});
  await adapter.signInFromClick();
  const preview = await adapter.preview('provider', WO);
  assert.equal(preview.status, 'sent_recorded_unverified');
  assert.equal(preview.canDraft, false);
  const result = await adapter.createOrOpenProviderDraft(WO);
  assert.deepEqual(result, {state: 'held',
    reason: 'SHARED_SENT_RECORD_UNVERIFIED'});
  assert.equal(h.actionPort.createCalls, 0);
  assert.deepEqual(h.counts(), {evidenceReads: 0, approvalReads: 0});
});

test('historical occupied draft can resume only through owner recovery', async () => {
  const h = harness();
  h.actionPort.state = 'legacy_occupied';
  h.actionPort.resume = async () => {
    h.actionPort.resumeCalls++;
    return {status: 'legacy_draft_review_required'};
  };
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'legacy_draft_review_required');
  assert.equal(h.actionPort.createCalls, 0);
  assert.equal(h.actionPort.resumeCalls, 1);
  assert.deepEqual(h.counts(), {evidenceReads: 0, approvalReads: 0});
});

test('absent reviewed evidence holds read-only panel and action preflight', async () => {
  const h = harness({absent: true});
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'linkage_held');
  assert.equal(dated.reasonCode, 'EVIDENCE_ABSENT');
  assert.equal(dated.recipientSuggestion, 'none');
  assert.deepEqual(dated.to, []);
  await rejectsCode(() => h.flow.preview(WO), 'EVIDENCE_ABSENT');
  await rejectsCode(() => h.flow.draft(WO), 'EVIDENCE_ABSENT');
  assert.equal(h.actionPort.createCalls, 0);
});

test('incomplete fake linkage port cannot arm preview or draft', async () => {
  const incompletePort = {verify: async (c, id) => ({
    nativeWorkOrderId: id, recipientSuggestion: c.source.to,
    validUntilMs: Date.parse(LINK_UNTIL), sendAllowed: false,
  })};
  const h = harness({linkagePortOverride: incompletePort});
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'linkage_held');
  assert.equal(dated.reasonCode, 'LINKAGE_PORT_RESULT_UNVERIFIED');
  assert.equal(dated.recipientSuggestion, 'none');
  assert.deepEqual(dated.to, []);
  await rejectsCode(() => h.flow.preview(WO),
    'LINKAGE_PORT_RESULT_UNVERIFIED');
  await rejectsCode(() => h.flow.draft(WO),
    'LINKAGE_PORT_RESULT_UNVERIFIED');
  assert.equal(h.actionPort.createCalls, 0);
});

test('scope-excluded visit never displays unverified recipients', async () => {
  const f = fixture();
  const wo = f.snapshot.projects[0].cases[0].workOrders[0];
  wo.serviceType = '9 - Scheduled Service Survey';
  f.overlay.rows[WO].serviceType = wo.serviceType;
  f.release.fields.DecryptedHtmlSha256 = hash(htmlFor(f));
  const h = harness({f, absent: true});
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'scope_excluded');
  assert.equal(dated.reasonCode, 'VISIT_SCOPE_EXCLUDED');
  assert.equal(dated.recipientSuggestion, 'none');
  assert.deepEqual(dated.to, []);
  assert.equal(dated.canDraft, false);
  assert.deepEqual(h.counts(), {evidenceReads: 0, approvalReads: 0});
});

test('three approved reads pass minimum expiry through fake action port once', async () => {
  const h = harness();
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'draft');
  assert.equal(h.actionPort.createCalls, 1);
  assert.deepEqual(h.counts(), {evidenceReads: 3, approvalReads: 3});
  assert.equal(h.actionPort.command.linkageValidUntilUtc, LINK_UNTIL_ISO);
  assert.equal(h.actionPort.postclaim.validUntilUtc, LINK_UNTIL_ISO);
  assert.equal(h.actionPort.command.linkageBinding,
    h.actionPort.postclaim.linkageBinding);
  const resumed = await h.flow.draft(WO);
  assert.equal(resumed.status, 'draft_review_required');
  assert.equal(h.actionPort.createCalls, 1);
  assert.equal(h.actionPort.resumeCalls, 1);
});

test('owner approval ETag drift holds before any claim', async () => {
  const f = fixture();
  const versions = [reviewed(f.packet, 'etag-a'),
    reviewed(f.packet, 'etag-b')];
  const h = harness({f, versions});
  await rejectsCode(() => h.flow.draft(WO),
    'LINKAGE_CHANGED_DURING_DRAFT');
  assert.equal(h.actionPort.createCalls, 0);
  assert.deepEqual(h.counts(), {evidenceReads: 2, approvalReads: 2});
});

test('fallback suite drift holds before any claim', async () => {
  const f = fixture({unknownFormStore: true});
  const changed = structuredClone(f.packet);
  changed.projects[0].formAddress.street2 = 'STE 2';
  changed.projects[0].cases[0].workOrders[0]
    .serviceAddress.street2 = 'STE 2';
  const h = harness({f, versions: [reviewed(f.packet), reviewed(changed)]});
  await rejectsCode(() => h.flow.draft(WO),
    'CHART_FALLBACK_ADDRESS_UNVERIFIED');
  assert.equal(h.actionPort.createCalls, 0);
});

test('postclaim agent drift leaves occupied claim and no second draft', async () => {
  const f = fixture();
  const changed = structuredClone(f.packet);
  changed.projects[0].cases[0].workOrders[0].assignedSpName =
    'Z9 - Example Provider';
  changed.projects[0].cases[0].workOrders[0].assignedSpAgentCode = 'Z9';
  changed.linkageRows[0].agentCode = 'Z9';
  changed.directoryRows[0].agentCode = 'Z9';
  const h = harness({f,
    versions: [reviewed(f.packet), reviewed(f.packet), reviewed(changed)]});
  await rejectsCode(() => h.flow.draft(WO),
    'CHART_LINKAGE_EVIDENCE_MISMATCH');
  assert.equal(h.actionPort.createCalls, 1);
  assert.equal(h.actionPort.postclaim, null);
  const resume = await h.flow.draft(WO);
  assert.equal(resume.status, 'claim_outcome_unverified');
  assert.equal(h.actionPort.createCalls, 1);
  assert.equal(h.actionPort.resumeCalls, 1);
});

test('approval expiry reached after claim holds before fake draft creation', async () => {
  const h = harness();
  h.actionPort.onClaim = () => {
    h.f.nowMs = Date.parse(LINK_UNTIL);
  };
  await rejectsCode(() => h.flow.draft(WO),
    'LINKAGE_EVIDENCE_EXPIRED');
  assert.equal(h.actionPort.createCalls, 1);
  assert.equal(h.actionPort.postclaim, null);
  assert.equal(h.actionPort.command.linkageValidUntilUtc, LINK_UNTIL_ISO);
});
