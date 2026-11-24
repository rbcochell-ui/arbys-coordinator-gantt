import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {CLAIM_COLUMNS, RECEIPT_COLUMNS, ClaimReceiptStore} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/claim_receipt_store.mjs';
import {buildCustomerDraft, canonicalCustomerBody, customerDispatchKey,
  PICOS_PARTS, providerDispatchKey} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {GraphHttpError} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/graph.mjs';
import {createV2ParentAdapter} from '../snapshot_parent_adapter.mjs';
import {GanttReleaseReader, GANTT_RELEASE_FIELDS,
  GANTT_RELEASE_KEY, GANTT_RELEASE_TITLE} from '../release_reader.mjs';
import {createSnapshotFirstProviderFlow} from '../snapshot_first_provider_flow.mjs';
import {SnapshotProviderActionWriter} from '../snapshot_provider_writer.mjs';
import {SnapshotClaimReceiptStore} from '../snapshot_claim_store.mjs';
import {RUNTIME_CONFIG} from '../runtime_config.mjs';
import {createProtectedProviderJoinPort} from
  '../../gantt_github_two_button_site_integrated_source_only_20261123_v4_verified_prefill/src/compose_site.mjs';

const OBSERVED = '2026-11-22T18:43:09Z';
const NOW = Date.parse(OBSERVED) + 60 * 60_000;
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_A = {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  address: 'first@example.invalid'};
const ACTOR_B = {id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  address: 'second@example.invalid'};
const SITE_ID = 'groups.coca-cola.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
const SITE_URL = 'https://groups.coca-cola.com/sites/ArbysOperations';
const LISTS = Object.freeze({ganttRelease: '33333333-3333-4333-8333-333333333333',
  claims: '44444444-4444-4444-8444-444444444444',
  receipts: '55555555-5555-4555-8555-555555555555',
  woSource: '66666666-6666-4666-8666-666666666666',
  verifiedContacts: '88888888-8888-4888-8888-888888888888'});
const PAYLOAD_URL = 'https://example.invalid/data/gantt.enc.json';
const SHA = value => createHash('sha256').update(value).digest('hex');

function id18(serial) {
  const first15 = `0WO${String(serial).padStart(12, '0')}`;
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
const WO = id18(1);
const OUTLOOK = id => `https://outlook.office.com/mail/drafts/id/${id}`;

class BrowserParser {
  parseFromString(html) {
    return {querySelectorAll: () => [...html.matchAll(/<a\s+href="([^"]+)"/gu)]
      .map(match => ({getAttribute: () => match[1]}))};
  }
}
function releaseColumns() {
  const lengths = {ReleaseKey: 128, DecryptedHtmlSha256: 64,
    EncryptedPayloadSha256: 64, SnapshotAsOfDate: 10,
    OverlayObservedAtUtc: 40, SourceReportSha256: 64,
    ApprovedAtUtc: 40, ValidUntilUtc: 40, ApprovedByOid: 36,
    EncryptedPayloadUrl: 255};
  return [{name: 'Title', required: true, text: {maxLength: 255}},
    ...GANTT_RELEASE_FIELDS.map(name => name === 'ReleaseState'
      ? {name, required: true, choice: {choices: ['Approved', 'Revoked']}}
      : {name, required: true, text: {maxLength: lengths[name]},
        indexed: name === 'ReleaseKey',
        enforceUniqueValues: name === 'ReleaseKey'})];
}
function fixture() {
  const address = {street: '1 EXAMPLE ROAD', city: 'TESTVILLE',
    state: 'NY', zip: '10001'};
  const wo = {id: WO, number: '1234567', type: 'Installation',
    status: 'Pending Readiness', serviceType: 'A - Install Fountain Equipment',
    assignedSpAgentCode: 'A1', assignedSpName: 'EXAMPLE SERVICE',
    acn: '00123456', woStore: '1001', thirstyServiceAddress: {...address},
    providerContactCandidate: {state: 'two_source_file_candidate',
      installManagerEmail: 'manager@example.invalid',
      plannerEmail: 'planner@example.invalid'}};
  const f = {nowMs: NOW, actor: ACTOR_A, ciphertextBytes:
      new TextEncoder().encode('invented encrypted chart bytes'),
    snapshot: {schema: 'arbys-local-exact-form-project-preview/v16',
      asOfDate: '2026-11-18', counts: {nativeWorkOrders: 1},
      projects: [{formAddress: {...address}, cases: [{workOrders: [wo]}]}]},
    overlay: {schema: 'ArbysProviderVisitSourceOverlay/v2',
      observedAtUtc: OBSERVED, reportId: '00O123456789012345',
      sourceRows: 100, sourceSha256: 'a'.repeat(64),
      rows: {[WO]: {nativeWorkOrderId: WO.slice(0, 15),
        workOrderNumber: '1234567', activityType: 'Installation',
        workOrderType: 'Installation', serviceType: wo.serviceType,
        status: 'Pending Readiness', hold: '0', spStatus: ''}}},
    release: {id: '1', eTag: '"1"', lastModifiedBy: {user: {id: OWNER}},
      lastModifiedDateTime: new Date(Date.parse(OBSERVED) + 11 * 60_000).toISOString(),
      fields: {}},
    selected: {kind: 'provider', id: WO, epoch: 1}};
  seal(f);
  return f;
}
function htmlFor(f) {
  return `<!doctype html><html><head><script type="application/json" id="snapshotData">${JSON.stringify(f.snapshot)}</script><script type="application/json" id="providerVisitSourceOverlay">${JSON.stringify(f.overlay)}</script></head><body>Invented chart</body></html>`;
}
function seal(f) {
  Object.assign(f.release.fields, {
    ReleaseKey: GANTT_RELEASE_KEY, ReleaseState: 'Approved',
    DecryptedHtmlSha256: SHA(htmlFor(f)),
    EncryptedPayloadSha256: SHA(f.ciphertextBytes),
    SnapshotAsOfDate: f.snapshot.asOfDate,
    OverlayObservedAtUtc: f.overlay.observedAtUtc,
    SourceReportSha256: f.overlay.sourceSha256,
    ApprovedAtUtc: new Date(Date.parse(OBSERVED) + 10 * 60_000).toISOString(),
    ValidUntilUtc: new Date(Date.parse(OBSERVED) + 23 * 60 * 60_000).toISOString(),
    ApprovedByOid: OWNER, EncryptedPayloadUrl: PAYLOAD_URL,
  });
}
function config(overrides = {}) {
  return {enabled: true, providerSnapshotEnabled: true,
    occupiedPilotClaimsMigrated: true, emptyToDraftCanaryPassed: true,
    siteId: SITE_ID, lists: {...LISTS},
    coordinatorOids: [ACTOR_A.id, ACTOR_B.id],
    releaseOwnerOids: [OWNER], ...overrides};
}

class FakeGraph {
  constructor(f) {
    this.f = f;
    const wo = f.snapshot.projects[0].cases[0].workOrders[0];
    const key = SHA(JSON.stringify([wo.assignedSpAgentCode,
      String(Number(wo.acn)), wo.woStore]));
    const addressKey = '1 EXAMPLE ROAD|TESTVILLE|NY|10001';
    const protectedWo = {id: '1', eTag: '"1"', fields: {
      NativeWorkOrderId: wo.id, SourceComplete: true,
      SourceObservedAtUtc: f.overlay.observedAtUtc,
      SourceRevision: 'c'.repeat(64), NormalizedVisitKind: 'Install',
      ActivityType: 'Installation', WorkOrderType: wo.type,
      WorkOrderStatus: f.overlay.rows[wo.id]?.status ?? 'Pending Readiness',
      ServiceTypeCode: 'A', AssignedAgentCode: wo.assignedSpAgentCode,
      OutletACN: wo.acn, StoreNumber: wo.woStore,
      ServiceAddressKey: addressKey, WorkOrderNumber: wo.number,
    }};
    const protectedContact = {id: '1', eTag: '"1"', fields: {
      ContactKey: key, AgentCode: wo.assignedSpAgentCode,
      OutletACN: wo.acn, StoreNumber: wo.woStore,
      ServiceAddressKey: addressKey,
      InstallManagerEmail: wo.providerContactCandidate?.installManagerEmail ??
        'manager@example.invalid',
      PlannerEmail: wo.providerContactCandidate?.plannerEmail ??
        'planner@example.invalid',
      Verified: true,
      VerifiedAtUtc: new Date(f.nowMs - 3 * 24 * 60 * 60_000).toISOString(),
      SourceCheckedAtUtc: new Date(f.nowMs - 60 * 60_000).toISOString(),
      SourceEvidenceDigest: 'd'.repeat(64),
    }};
    this.rows = new Map([[LISTS.ganttRelease, [f.release]],
      [LISTS.claims, []], [LISTS.receipts, []],
      [LISTS.woSource, [protectedWo]],
      [LISTS.verifiedContacts, [protectedContact]]]);
    this.messages = new Map();
    this.claimPosts = 0;
    this.receiptPosts = 0;
    this.draftPosts = 0;
    this.messageReads = 0;
    this.sentScanCalls = [];
    this.sentScanResult = null;
    this.sentScanError = null;
    this.requestCalls = [];
    this.failClaimAfterPersist = false;
    this.failDraftAfterPersist = false;
    this.changeReleaseAfterClaim = false;
    this.beforeClaimFetch = null;
  }
  bindAccount() { return this; }
  async getMe() { return this.f.actor; }
  async getFolderId(kind) { return `folder-${kind}`; }
  async getMessage(id) {
    this.messageReads += 1;
    const message = this.messages.get(id);
    if (!message) throw new GraphHttpError(404);
    return structuredClone(message);
  }
  async findSentByCorrelation(correlationId, claimedAtUtc) {
    this.sentScanCalls.push({correlationId, claimedAtUtc});
    if (this.sentScanError) throw this.sentScanError;
    return this.sentScanResult;
  }
  async createDraft(content, correlationId, beforeFetch) {
    beforeFetch();
    this.draftPosts += 1;
    const id = `immutable-invented-${this.draftPosts}`;
    const message = {id, isDraft: true, parentFolderId: 'folder-drafts',
      sentDateTime: null, internetMessageId: null, subject: content.subject,
      body: {contentType: 'HTML', content: content.htmlBody},
      webLink: OUTLOOK(id),
      toRecipients: content.to.map(address => ({emailAddress: {address}})),
      ccRecipients: [], bccRecipients: [],
      internetMessageHeaders: [{name: 'x-arbys-correlation-id', value: correlationId}]};
    this.messages.set(id, message);
    if (this.failDraftAfterPersist) throw new Error('invented response loss');
    return structuredClone(message);
  }
  async request(path, options) {
    if (options.method === 'POST' &&
        path.includes(`/lists/${LISTS.claims}/items`)) {
      if (this.beforeClaimFetch) await this.beforeClaimFetch();
    }
    options.beforeFetch?.();
    this.requestCalls.push([path, options.method ?? 'GET']);
    assert.deepEqual(options.scopes, ['Lists.SelectedOperations.Selected']);
    const url = new URL(path, 'https://graph.microsoft.com');
    const parts = url.pathname.split('/');
    assert.equal(decodeURIComponent(parts[3]), SITE_ID);
    const listId = parts[5];
    const rows = this.rows.get(listId);
    assert.ok(rows, 'invented List ID expected');
    const release = listId === LISTS.ganttRelease;
    const title = release ? GANTT_RELEASE_TITLE :
      listId === LISTS.claims ? 'Arbys Coordinator Action Claims' :
        listId === LISTS.receipts ? 'Arbys Coordinator Action Receipts' :
          listId === LISTS.woSource ?
            'Arbys Provider Parts WO Action Source' :
            'Arbys Provider Parts Verified Contacts';
    const key = release ? 'ReleaseKey' :
      listId === LISTS.claims ? 'DispatchKey' :
        listId === LISTS.receipts ? 'ReceiptKey' :
          listId === LISTS.woSource ? 'NativeWorkOrderId' : 'ContactKey';
    if (options.method === 'POST') {
      assert.equal(parts[6], 'items');
      assert.equal(release, false);
      const fields = structuredClone(options.body.fields);
      if (listId === LISTS.claims) this.claimPosts += 1;
      else this.receiptPosts += 1;
      if (rows.some(row => row.fields[key] === fields[key])) {
        throw new GraphHttpError(409, 'duplicateValue');
      }
      const item = {id: String(rows.length + 1), eTag: '"1"', fields};
      rows.push(item);
      if (listId === LISTS.claims) {
        if (this.changeReleaseAfterClaim) this.f.release.eTag = '"2"';
        if (this.failClaimAfterPersist) throw new Error('invented response loss');
      }
      return {status: 201, data: {id: item.id}};
    }
    if (parts.length === 6) return {status: 200, data: {
      id: listId, displayName: title,
      webUrl: `${SITE_URL}/Lists/Invented`}};
    if (parts[6] === 'columns') return {status: 200, data: {
      value: release ? releaseColumns() :
        (listId === LISTS.woSource ||
        listId === LISTS.verifiedContacts) ? [{name: key,
          required: true, indexed: true,
          enforceUniqueValues: true, text: {}}] :
        (listId === LISTS.claims ? CLAIM_COLUMNS : RECEIPT_COLUMNS)
          .map(name => name === 'Kind' && listId === LISTS.receipts
            ? {name, required: true, indexed: false,
              enforceUniqueValues: false,
              choice: {allowTextEntry: false,
                choices: ['Draft', 'SentAttempt', 'Sent']}}
            : name === 'PlannedSentSha256' && listId === LISTS.receipts
              ? {name, required: false, indexed: false,
                enforceUniqueValues: false,
                text: {maxLength: 64, allowMultipleLines: false}}
              : {name, required: name === key,
                indexed: name === key, enforceUniqueValues: name === key,
                text: {}})}};
    assert.equal(parts[6], 'items');
    if (parts[7]) {
      const row = rows.find(value => value.id === parts[7]);
      assert.ok(row);
      return {status: 200, data: structuredClone(row)};
    }
    if (release) return {status: 200, data: {value: rows.map(row =>
      structuredClone(row))}};
    const filter = url.searchParams.get('$filter');
    const match = /^fields\/([A-Za-z0-9_]+) eq '([^']*)'$/u.exec(filter);
    assert.ok(match, `unexpected invented filter ${filter}`);
    return {status: 200, data: {value: rows.filter(row =>
      row.fields[match[1]] === match[2]).map(row => structuredClone(row))}};
  }
}
function inventedExactJoin(f, id) {
  const wo = f.snapshot.projects[0].cases[0].workOrders[0];
  const candidate = wo.providerContactCandidate;
  return {nativeWoId: id, woNumber: wo.number,
    agentCode: wo.assignedSpAgentCode, storeNumber: wo.woStore,
    outletAcn: wo.acn, normalizedVisitKind: 'Install',
    serviceAddressKey: '1 EXAMPLE ROAD|TESTVILLE|NY|10001',
    workOrderType: wo.type, serviceTypeCode: 'A',
    workOrderStatus: f.overlay.rows[id].status,
    to: [...new Set([candidate?.installManagerEmail,
      candidate?.plannerEmail].filter(Boolean))],
    recipientEvidence: 'verified_pair',
    recipientReviewRequired: false,
    digest: SHA('invented protected WO and Contacts rows'),
    etagsJson: JSON.stringify({wo: {itemId: '1', etag: '"1"'},
      contact: {itemId: '2', etag: '"1"'}}),
    observedAtUtc: OBSERVED, validUntilMs: f.nowMs + 10 * 60_000};
}
function siteProtectedJoin(graph, f) {
  return createProtectedProviderJoinPort({graph,
    config: {siteId: SITE_ID, lists: {woSource: LISTS.woSource,
      verifiedContacts: LISTS.verifiedContacts},
    eligibleWorkOrderTypes: ['Installation'],
    eligibleServiceTypeCodes: ['A'],
    eligibleRawSpStatuses: [],
    eligibleWorkOrderStatuses: ['Pending Readiness'],
    emptyToDraftCanaryPassed: true},
    now: () => f.nowMs});
}
function harness(options = {}) {
  const f = options.fixture ?? fixture();
  const graph = new FakeGraph(f);
  let uuid = 0;
  const writer = new SnapshotProviderActionWriter({config: config(options.config),
    graph, now: () => f.nowMs,
    randomUUID: () => `77777777-7777-4777-8777-${String(++uuid).padStart(12, '0')}`,
    domParserClass: BrowserParser});
  // This existing harness isolates snapshot Claim, Draft and Sent behavior.
  // The production composition binds a signed loader; the separate team
  // inventory tests exercise that loader and its pre/post Claim checks.
  writer._legacyFence = async () => null;
  writer._inspectLegacy = async () => ({occupied: null,
    proofDigest: 'snapshot-writer-fixture',
    validUntilMs: Date.now() + 60_000});
  const actionPort = options.actionPortFactory?.(writer, graph) ?? writer;
  const releaseReader = new GanttReleaseReader({graph,
    siteId: SITE_ID, listId: LISTS.ganttRelease,
    siteUrl: SITE_URL, payloadUrl: PAYLOAD_URL});
  const exactJoinPort = options.exactJoinPortFactory?.(graph, f) ??
    options.exactJoinPort ?? {
    resolve: async (id) => inventedExactJoin(f, id)};
  const rawFlow = createSnapshotFirstProviderFlow({enabled: true,
    releaseReader, ownerOids: [OWNER],
    loadAuthenticatedChart: async () => ({html: htmlFor(f),
      encryptedPayloadBytes: f.ciphertextBytes,
      encryptedPayloadUrl: PAYLOAD_URL}),
    getActor: () => graph.getMe(),
    selectionPort: {capture: () => ({...f.selected}),
      isCurrent: token => token.id === f.selected.id &&
        token.kind === f.selected.kind && token.epoch === f.selected.epoch,
      ensureReady: async id => {
        if (f.selected.id !== id || f.selected.kind !== 'provider') {
          const error = new Error('DATED_PREVIEW_SELECTION_REQUIRED');
          error.code = 'DATED_PREVIEW_SELECTION_REQUIRED';
          throw error;
        }
      }},
    actionPort, exactJoinPort, now: () => f.nowMs});
  // Existing writer tests model a reviewed click. Keep that preview explicit
  // at the harness boundary while exposing the raw flow for binding failures.
  let reviewed = null;
  const flow = Object.freeze({...rawFlow,
    async preview(id) {
      reviewed = await rawFlow.preview(id);
      return reviewed;
    },
    async draft(id, binding) {
      if (arguments.length < 2) {
        if (!reviewed || reviewed.id !== id) reviewed = await rawFlow.preview(id);
        binding = reviewed.status === 'eligible' ? reviewed.binding : null;
      }
      try { return await rawFlow.draft(id, binding); }
      finally { reviewed = null; }
    },
  });
  return {f, graph, writer, flow, rawFlow, exactJoinPort};
}
async function occupiedDraftWithDifferentTo() {
  const f = fixture();
  const to = ['new-manager@example.invalid',
    'new-planner@example.invalid'];
  const candidate = f.snapshot.projects[0].cases[0].workOrders[0]
    .providerContactCandidate;
  [candidate.installManagerEmail, candidate.plannerEmail] = to;
  seal(f);
  const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
  const result = await h.flow.draft(WO);
  return {to, webLink: result.webLink,
    claim: structuredClone(h.graph.rows.get(LISTS.claims)[0]),
    receipt: structuredClone(h.graph.rows.get(LISTS.receipts)[0]),
    message: structuredClone(h.graph.messages.get(result.immutableId))};
}
function insertOccupiedDraft(graph, occupied) {
  graph.rows.get(LISTS.claims).push(structuredClone(occupied.claim));
  graph.rows.get(LISTS.receipts).push(structuredClone(occupied.receipt));
  graph.messages.set(occupied.message.id,
    structuredClone(occupied.message));
}
const rejectsCode = (operation, code) => assert.rejects(operation,
  error => error?.code === code);
function portWith(writer, createFirstDraft) {
  return {observe: (...args) => writer.observe(...args),
    resume: (...args) => writer.resume(...args),
    checkSent: (...args) => writer.checkSent(...args),
    createFirstDraft};
}

test('checked-in v7 config remains held; disabled writer makes no POST', async () => {
  assert.equal(RUNTIME_CONFIG.enabled, false);
  for (const [name, value] of Object.entries(RUNTIME_CONFIG)) {
    if (name !== 'enabled') assert.equal(value, null, name);
  }
  const h = harness({config: {enabled: false}});
  await rejectsCode(() => h.flow.draft(WO), 'SNAPSHOT_WRITER_NOT_RELEASED');
  assert.equal(h.graph.requestCalls.every(([, method]) => method === 'GET'), true);
  assert.equal(h.graph.claimPosts, 0);
  assert.equal(h.graph.draftPosts, 0);
});

test('one click makes one unique Claim, one unsent six-link draft and one Draft receipt', async () => {
  const h = harness();
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'eligible');
  assert.deepEqual(p.to, ['manager@example.invalid', 'planner@example.invalid']);
  assert.deepEqual(p.binding.to, p.to);
  assert.equal(p.binding.validUntilMs, Date.parse(p.validUntilUtc));
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'draft');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
  const claim = h.graph.rows.get(LISTS.claims)[0].fields;
  const draft = h.graph.rows.get(LISTS.receipts)[0].fields;
  assert.equal(claim.DispatchKey, providerDispatchKey(WO));
  assert.equal(draft.ReceiptKey, `${providerDispatchKey(WO)}|Draft`);
  assert.equal(draft.DraftImmutableId, result.immutableId);
  assert.equal(JSON.parse(claim.SourceETagsJson).mode,
    'gantt-snapshot-one-click/v1');
  assert.equal(JSON.parse(claim.SourceETagsJson).release.itemId, '1');
  assert.deepEqual(JSON.parse(draft.IntendedToJson), p.to);
  const body = h.graph.messages.get(result.immutableId).body.content;
  for (const part of PICOS_PARTS) {
    assert.ok(body.includes(`href="${part.url}"`));
  }
  assert.equal(h.graph.requestCalls.some(([, method]) =>
    !['GET', 'POST'].includes(method)), false);
  assert.equal(typeof h.graph.sendMail, 'undefined');
});

test('an existing V4 Claim without recipient evidence remains readable', async () => {
  const h = harness();
  await h.flow.draft(WO);
  const claim = h.graph.rows.get(LISTS.claims)[0].fields;
  const evidence = JSON.parse(claim.SourceETagsJson);
  delete evidence.snapshot.recipientEvidence;
  claim.SourceETagsJson = JSON.stringify(evidence);
  claim.SourceDigest = SHA(claim.SourceETagsJson);
  const existing = await h.flow.checkSent(WO);
  assert.equal(existing.status, 'draft');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
});

test('site-composed verified Graph join reaches the V7 Claim and draft writer', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  const preview = await h.flow.preview(WO);
  assert.equal(preview.status, 'eligible');
  assert.deepEqual(preview.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal(preview.recipientEvidence, 'verified_pair');
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'draft');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
  assert.ok(h.graph.requestCalls.some(([path]) =>
    path.includes(`/lists/${LISTS.woSource}/items?`)));
  assert.ok(h.graph.requestCalls.some(([path]) =>
    path.includes(`/lists/${LISTS.verifiedContacts}/items?`)));
});

test('missing, changed, or expired provider preview binding holds before Claim', async () => {
  for (const [change, code] of [
    [() => undefined, 'PROVIDER_PREVIEW_BINDING_INVALID'],
    [preview => ({...preview.binding,
      to: ['unseen@example.invalid', preview.to[1]]}),
    'PROVIDER_PREVIEW_RECIPIENTS_CHANGED'],
    [preview => ({...preview.binding,
      releaseSourceSha256: 'f'.repeat(64)}),
    'PROVIDER_PREVIEW_RELEASE_SOURCE_CHANGED'],
  ]) {
    const h = harness();
    const preview = await h.rawFlow.preview(WO);
    await rejectsCode(() => h.rawFlow.draft(WO, change(preview)), code);
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
  }
  const h = harness();
  const preview = await h.rawFlow.preview(WO);
  h.f.nowMs = preview.binding.validUntilMs;
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_PREVIEW_EXPIRED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('preview expiry during the writer legacy check stops the physical Claim', async () => {
  const h = harness();
  const preview = await h.rawFlow.preview(WO);
  const inspectLegacy = h.writer._inspectLegacy.bind(h.writer);
  h.writer._inspectLegacy = async (...args) => {
    const proof = await inspectLegacy(...args);
    h.f.nowMs = preview.binding.validUntilMs;
    return proof;
  };
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_PREVIEW_EXPIRED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
  assert.equal(h.graph.requestCalls.every(([, method]) => method === 'GET'),
    true);
});

test('preview expiry during Graph token wait stops the physical Claim POST', async () => {
  const h = harness();
  const preview = await h.rawFlow.preview(WO);
  h.graph.beforeClaimFetch = async () => {
    h.f.nowMs = preview.binding.validUntilMs;
  };
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_PREVIEW_EXPIRED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
  assert.equal(h.graph.requestCalls.every(([, method]) => method === 'GET'),
    true);
});

test('newly approved contacts after preview cannot populate an unseen To', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  const preview = await h.rawFlow.preview(WO);
  assert.deepEqual(preview.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  const newTo = ['new-manager@example.invalid',
    'new-planner@example.invalid'];
  const candidate = h.f.snapshot.projects[0].cases[0].workOrders[0]
    .providerContactCandidate;
  [candidate.installManagerEmail, candidate.plannerEmail] = newTo;
  const protectedContact = h.graph.rows.get(LISTS.verifiedContacts)[0];
  [protectedContact.fields.InstallManagerEmail,
    protectedContact.fields.PlannerEmail] = newTo;
  protectedContact.fields.VerifiedAtUtc =
    new Date(NOW - 2 * 60_000).toISOString();
  protectedContact.fields.SourceCheckedAtUtc =
    new Date(NOW - 60_000).toISOString();
  protectedContact.fields.SourceEvidenceDigest = 'e'.repeat(64);
  protectedContact.eTag = '"2"';
  h.f.ciphertextBytes = new TextEncoder()
    .encode('invented newly approved encrypted chart bytes');
  seal(h.f);
  h.f.release.eTag = '"2"';
  h.f.release.fields.ApprovedAtUtc =
    new Date(NOW - 60_000).toISOString();
  h.f.release.lastModifiedDateTime = new Date(NOW).toISOString();
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_PREVIEW_RECIPIENTS_CHANGED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
  assert.equal(h.graph.requestCalls.every(([, method]) => method === 'GET'),
    true);
  const fresh = await h.rawFlow.preview(WO);
  assert.deepEqual(fresh.to, newTo);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('Release and protected contact revisions after preview hold before Claim', async () => {
  const changedRelease = harness();
  const releasePreview = await changedRelease.rawFlow.preview(WO);
  changedRelease.f.release.eTag = '"2"';
  changedRelease.f.release.lastModifiedDateTime = new Date(NOW).toISOString();
  await rejectsCode(() => changedRelease.rawFlow.draft(
    WO, releasePreview.binding), 'PROVIDER_PREVIEW_RELEASE_SOURCE_CHANGED');
  assert.deepEqual([changedRelease.graph.claimPosts,
    changedRelease.graph.draftPosts], [0, 0]);

  const changedJoin = harness({exactJoinPortFactory: siteProtectedJoin});
  const joinPreview = await changedJoin.rawFlow.preview(WO);
  changedJoin.graph.rows.get(LISTS.verifiedContacts)[0].eTag = '"2"';
  await rejectsCode(() => changedJoin.rawFlow.draft(WO,
    joinPreview.binding), 'PROVIDER_PREVIEW_PROTECTED_JOIN_CHANGED');
  assert.deepEqual([changedJoin.graph.claimPosts,
    changedJoin.graph.draftPosts], [0, 0]);
});

test('eligible preview cannot reopen another tab’s differently addressed draft', async () => {
  const occupied = await occupiedDraftWithDifferentTo();
  const h = harness();
  const actions = {async preview() { throw new Error('customer unused'); },
    async customerDraft() { throw new Error('customer unused'); },
    async checkCustomerSent() { throw new Error('customer unused'); }};
  const adapter = createV2ParentAdapter({enabled: true, actions,
    signIn: async () => {}, providerFlow: h.rawFlow});
  await adapter.signInFromClick();
  const eligiblePreview = await adapter.preview('provider', WO);
  assert.deepEqual(eligiblePreview.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  await rejectsCode(() => adapter.createOrOpenProviderDraft(WO),
    'PROVIDER_PREVIEW_BINDING_REQUIRED');
  insertOccupiedDraft(h.graph, occupied);
  await rejectsCode(() => adapter.createOrOpenProviderDraft(
    WO, eligiblePreview.binding), 'PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);

  const occupiedPreview = await adapter.preview('provider', WO);
  assert.equal(occupiedPreview.status, 'draft_occupied');
  assert.equal(occupiedPreview.binding, null);
  const reopened = await adapter.createOrOpenProviderDraft(
    WO, occupiedPreview.binding);
  assert.equal(reopened.state, 'draft');
  assert.equal(reopened.webLink, occupied.webLink);
  assert.deepEqual(h.graph.messages.get(occupied.message.id).toRecipients
    .map(row => row.emailAddress.address), occupied.to);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('Claim appearing at the second observe holds the bound preview', async () => {
  const occupied = await occupiedDraftWithDifferentTo();
  let observes = 0;
  let resumes = 0;
  const h = harness({actionPortFactory: (writer, graph) => ({
    ...portWith(writer, command => writer.createFirstDraft(command)),
    async observe(...args) {
      if (++observes === 4) insertOccupiedDraft(graph, occupied);
      return writer.observe(...args);
    },
    async resume(...args) {
      resumes += 1;
      return writer.resume(...args);
    },
  })});
  const preview = await h.rawFlow.preview(WO);
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
  assert.equal(observes, 4);
  assert.equal(resumes, 0);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('shared manager and planner mailbox makes one addressed draft and reopens it', async () => {
  const f = fixture();
  const candidate = f.snapshot.projects[0].cases[0].workOrders[0]
    .providerContactCandidate;
  candidate.plannerEmail = candidate.installManagerEmail;
  seal(f);
  const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
  const preview = await h.flow.preview(WO);
  assert.deepEqual(preview.to, ['manager@example.invalid']);
  const first = await h.flow.draft(WO);
  assert.equal(first.status, 'draft');
  assert.deepEqual(h.graph.messages.get(first.immutableId).toRecipients,
    [{emailAddress: {address: 'manager@example.invalid'}}]);
  assert.deepEqual(JSON.parse(h.graph.rows.get(LISTS.receipts)[0]
    .fields.IntendedToJson), ['manager@example.invalid']);
  const reopened = await h.flow.draft(WO);
  assert.equal(reopened.status, 'draft');
  assert.equal(reopened.webLink, first.webLink);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
});

test('site-composed route holds an unreviewed relocation before Claim', async () => {
  const f = fixture();
  const wo = f.snapshot.projects[0].cases[0].workOrders[0];
  wo.type = 'Relocation';
  wo.serviceType = '8 - Relocate/Remodel';
  f.overlay.rows[WO].workOrderType = wo.type;
  f.overlay.rows[WO].serviceType = wo.serviceType;
  seal(f);
  const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
  await rejectsCode(() => h.flow.preview(WO),
    'PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED');
  await rejectsCode(() => h.flow.draft(WO),
    'PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('first draft requires the independent protected WO and Contacts reader', () => {
  assert.throws(() => harness({exactJoinPort: {}}),
    /Complete snapshot source, selection and shared action port required/u);
});

test('identity, scope, status, or recipients cannot disagree with protected rows', async () => {
  for (const change of [
    row => { row.agentCode = 'B2'; },
    row => { row.storeNumber = '2002'; },
    row => { row.outletAcn = '99999999'; },
    row => { row.normalizedVisitKind = 'Relocate'; },
    row => { row.workOrderType = 'Other'; },
    row => { row.serviceTypeCode = '9'; },
    row => { row.workOrderStatus = 'Pending Scheduled Date'; },
    row => { row.to = ['other@example.invalid', 'planner@example.invalid']; },
    row => { row.etagsJson = JSON.stringify({wo: {itemId: '1', etag: '"1"'},
      contact: {state: 'absent'}}); },
  ]) {
    const f = fixture();
    const row = inventedExactJoin(f, WO);
    change(row);
    const h = harness({fixture: f, exactJoinPort: {
      resolve: async () => structuredClone(row)}});
    await rejectsCode(() => h.flow.preview(WO),
      'PROTECTED_PROVIDER_JOIN_MISMATCH');
    await rejectsCode(() => h.flow.draft(WO),
      'PROTECTED_PROVIDER_JOIN_MISMATCH');
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
  }
});

test('protected WO observation older than the chart holds before Claim', async () => {
  const f = fixture();
  const row = inventedExactJoin(f, WO);
  row.observedAtUtc = '2026-11-21T18:43:09Z';
  const h = harness({fixture: f, exactJoinPort: {
    resolve: async () => structuredClone(row)}});
  await rejectsCode(() => h.flow.draft(WO),
    'PROTECTED_WO_OLDER_THAN_CHART');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('a changed chart install code cannot reuse an older protected code', async () => {
  const f = fixture();
  const wo = f.snapshot.projects[0].cases[0].workOrders[0];
  wo.serviceType = 'C - Install Non-Serialized/Non-Dispenser';
  f.overlay.rows[WO].serviceType = wo.serviceType;
  seal(f);
  const h = harness({fixture: f});
  await rejectsCode(() => h.flow.draft(WO),
    'PROTECTED_PROVIDER_JOIN_MISMATCH');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('protected contact ETag change after Claim blocks Outlook draft', async () => {
  const f = fixture();
  let reads = 0;
  const h = harness({fixture: f, exactJoinPort: {
    async resolve(id) {
      const row = inventedExactJoin(f, id);
      if (++reads === 4) row.etagsJson = JSON.stringify({
        wo: {itemId: '1', etag: '"1"'},
        contact: {itemId: '2', etag: '"2"'},
      });
      return row;
    }}});
  await rejectsCode(() => h.flow.draft(WO),
    'PROTECTED_PROVIDER_JOIN_CHANGED');
  assert.equal(reads, 4);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 0]);
});

test('an existing Claim can reopen and check Sent when legacy proof is unavailable', async () => {
  const h = harness();
  const created = await h.flow.draft(WO);
  assert.equal(created.status, 'draft');
  h.writer._legacyFence = async () => {
    throw new Error('expired historical proof must not gate existing Claim');
  };
  h.writer._inspectLegacy = async () => {
    throw new Error('expired historical inventory must not gate existing Claim');
  };
  h.exactJoinPort.resolve = async () => {
    throw new Error('stale protected source must not block an owned draft');
  };
  const key = providerDispatchKey(WO);
  assert.equal((await h.writer.observe(key, ACTOR_A)).status, 'draft_occupied');
  assert.equal((await h.writer.resume(key, ACTOR_A)).status, 'draft');
  assert.equal((await h.writer.checkSent(key, ACTOR_A)).status, 'draft');
  assert.equal((await h.flow.draft(WO)).status, 'draft');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
});

test('late historical occupancy holds a formerly eligible preview', async () => {
  const h = harness();
  const occupied = {status: 'legacy_occupied',
    dispatchKey: providerDispatchKey(WO),
    reason: 'OWNER_RECONCILIATION_REQUIRED'};
  h.writer._legacyFence = async () => null;
  h.writer._inspectLegacy = async () => ({occupied,
    proofDigest: 'invented-occupied-proof', validUntilMs: Date.now() + 60_000});
  const preview = await h.rawFlow.preview(WO);
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('snapshot parent route accepts an owner-only historical reopen without a new draft', async () => {
  const key = providerDispatchKey(WO);
  const link = 'https://outlook.office.com/mail/deeplink/compose/invented';
  const h = harness({actionPortFactory: () => ({
    observe: async () => ({status: 'draft_occupied', dispatchKey: key}),
    resume: async () => ({status: 'legacy_draft_review_required',
      dispatchKey: key, webLink: link, sendReady: false}),
    checkSent: async () => ({status: 'legacy_draft_review_required',
      dispatchKey: key, webLink: link, sendReady: false}),
    createFirstDraft: async () => { throw new Error('no replacement draft'); },
  })});
  assert.equal((await h.flow.preview(WO)).status, 'draft_occupied');
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'legacy_draft_review_required');
  assert.equal(result.webLink, link);
  assert.equal(result.sendReady, false);
  assert.equal((await h.flow.checkSent(WO)).status,
    'legacy_draft_review_required');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('snapshot parent route leaves a nonowner historical key occupied', async () => {
  const key = providerDispatchKey(WO);
  const h = harness({actionPortFactory: () => ({
    observe: async () => ({status: 'legacy_occupied', dispatchKey: key}),
    resume: async () => ({status: 'legacy_occupied', dispatchKey: key,
      webLink: null, sendReady: false}),
    checkSent: async () => ({status: 'legacy_occupied', dispatchKey: key,
      webLink: null, sendReady: false}),
    createFirstDraft: async () => { throw new Error('no replacement draft'); },
  })});
  assert.equal((await h.flow.preview(WO)).status, 'legacy_occupied');
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'legacy_occupied');
  assert.equal(result.webLink, null);
  assert.equal((await h.flow.checkSent(WO)).status, 'legacy_occupied');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('snapshot first draft rereads the legacy fence after Claim', async () => {
  const h = harness();
  let reads = 0;
  h.writer._inspectLegacy = async () => {
    reads++;
    if (reads === 2) {
      const error = new Error('legacy proof changed after Claim');
      error.code = 'LEGACY_FENCE_UNVERIFIED';
      throw error;
    }
    return {occupied: null, proofDigest: 'invented-proof',
      validUntilMs: Date.now() + 60_000};
  };
  await rejectsCode(() => h.flow.draft(WO),
    'LEGACY_FENCE_UNVERIFIED');
  assert.equal(reads, 2);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 0, 0]);
});

test('snapshot fence expiry at draft POST leaves the Claim occupied', async () => {
  const h = harness();
  h.writer._inspectLegacy = async () => ({occupied: null,
    proofDigest: 'invented-proof', validUntilMs: Date.now() - 1});
  await rejectsCode(() => h.flow.draft(WO),
    'LEGACY_FENCE_UNVERIFIED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 0, 0]);
});

test('a Claim raced into the writer cannot reopen a different To', async () => {
  const occupied = await occupiedDraftWithDifferentTo();
  const h = harness({actionPortFactory: (writer, graph) =>
    portWith(writer, async command => {
      insertOccupiedDraft(graph, occupied);
      return writer.createFirstDraft(command);
    })});
  const preview = await h.rawFlow.preview(WO);
  await rejectsCode(() => h.rawFlow.draft(WO, preview.binding),
    'PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('a new draft result without its post-Claim reread is rejected', async () => {
  const h = harness({actionPortFactory: writer =>
    portWith(writer, async command =>
      ({status: 'draft', dispatchKey: command.dispatchKey}))});
  await rejectsCode(() => h.flow.draft(WO), 'POSTCLAIM_RECHECK_MISSING');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [0, 0, 0]);
});

test('provider and customer actions share sanitized physical Lists without raw capability or draft links', async () => {
  const h = harness();
  const customerKey = 'F:101:202';
  const privateUrl = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/?p=p_' +
    '1'.repeat(32) + '#k=' + 'A'.repeat(43);
  const dispatchKey = customerDispatchKey(customerKey);
  const etagsJson = JSON.stringify({release: {itemId: '1', etag: '"1"'}});
  h.f.actor = ACTOR_B;
  const customerStore = new ClaimReceiptStore({graph: h.graph,
    config: config(), now: () => h.f.nowMs});
  await customerStore.assertSchema();
  const claim = await customerStore.createClaim(dispatchKey, ACTOR_B,
    {formSourceKey: customerKey, etagsJson, digest: SHA(etagsJson)},
    '77777777-7777-4777-8777-000000000101',
    '77777777-7777-4777-8777-000000000102');
  const content = buildCustomerDraft({recipientEmail: 'customer@example.invalid',
    trackerUrl: privateUrl, subject: 'Invented project update',
    htmlBody: canonicalCustomerBody(privateUrl)});
  const customerMessage = {id: 'immutable-invented-customer',
    webLink: OUTLOOK('immutable-invented-customer'),
    body: {contentType: 'HTML', content: content.htmlBody}};
  const draftState = await customerStore.appendDraft(claim, ACTOR_B,
    {...content, id: customerMessage.id}, customerMessage);
  await customerStore.appendSent(draftState, ACTOR_B, {
    id: customerMessage.id, to: ['customer@example.invalid'],
    cc: [], bcc: [], sentAtUtc: new Date(NOW).toISOString(),
    internetMessageId: '<customer-invented@example.invalid>',
    subject: `Edited subject ${privateUrl}`, bodySha256: 'b'.repeat(64),
    linksSha256: 'c'.repeat(64), reviewReason: 'Subject changed in Outlook',
  });
  h.f.actor = ACTOR_A;
  const providerDraft = await h.flow.draft(WO);
  assert.equal(providerDraft.status, 'draft');
  const providerMessage = h.graph.messages.get(providerDraft.immutableId);
  providerMessage.isDraft = false;
  providerMessage.parentFolderId = 'folder-sentitems';
  providerMessage.sentDateTime = new Date(NOW).toISOString();
  providerMessage.internetMessageId = '<provider-invented@example.invalid>';
  assert.equal((await h.flow.checkSent(WO)).status, 'sent');
  assert.ok((await customerStore.getState(dispatchKey)).sent);
  const providerStore = new SnapshotClaimReceiptStore({graph: h.graph,
    config: config(), now: () => h.f.nowMs});
  assert.ok((await providerStore.getState(providerDispatchKey(WO))).sent);
  const receipts = h.graph.rows.get(LISTS.receipts).map(row => row.fields);
  assert.equal(receipts.length, 4);
  assert.equal(receipts.filter(row => row.Kind === 'Draft')
    .every(row => !Object.hasOwn(row, 'DraftWebLink')), true);
  assert.equal(receipts.filter(row => row.Kind === 'Sent')
    .every(row => /^sha256:[0-9a-f]{64}$/u.test(row.ActualSubject)), true);
  assert.equal(receipts.filter(row => row.Kind === 'Sent')
    .every(row => ['', 'SENT_DETAILS_CHANGED'].includes(row.ReviewReason)), true);
  assert.deepEqual(JSON.parse(receipts.find(row =>
    row.DispatchKey === dispatchKey && row.Kind === 'Draft')
    .RequiredLinksJson), [`sha256:${SHA(privateUrl)}`]);
  const sharedRows = JSON.stringify([h.graph.rows.get(LISTS.claims),
    h.graph.rows.get(LISTS.receipts)]);
  assert.equal(sharedRows.includes(privateUrl), false);
  assert.equal(sharedRows.includes('#k='), false);
  assert.equal(sharedRows.includes('https://outlook.office.com'), false);
});

test('snapshot reader rejects raw draft links, raw Sent subjects, and extra Claim evidence', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const claim = h.graph.rows.get(LISTS.claims)[0].fields;
  const draftReceipt = h.graph.rows.get(LISTS.receipts)[0].fields;
  draftReceipt.DraftWebLink = OUTLOOK(draft.immutableId);
  await rejectsCode(() => h.flow.preview(WO), 'SNAPSHOT_DRAFT_RECEIPT_INVALID');
  delete draftReceipt.DraftWebLink;
  const message = h.graph.messages.get(draft.immutableId);
  message.isDraft = false;
  message.parentFolderId = 'folder-sentitems';
  message.sentDateTime = new Date(NOW).toISOString();
  message.internetMessageId = '<invented@example.invalid>';
  assert.equal((await h.flow.checkSent(WO)).status, 'sent');
  const sentReceipt = h.graph.rows.get(LISTS.receipts)[1].fields;
  sentReceipt.ActualSubject = message.subject;
  await rejectsCode(() => h.flow.checkSent(WO), 'SNAPSHOT_SENT_RECEIPT_INVALID');
  sentReceipt.ActualSubject = `sha256:${SHA(message.subject)}`;
  const evidence = JSON.parse(claim.SourceETagsJson);
  evidence.snapshot.extra = 'https://outlook.office.com/private-draft';
  claim.SourceETagsJson = JSON.stringify(evidence);
  claim.SourceDigest = SHA(claim.SourceETagsJson);
  await rejectsCode(() => h.flow.preview(WO), 'SNAPSHOT_CLAIM_EVIDENCE_INVALID');
});

test('missing or ambiguous chart contact opens one blank-To review draft', async () => {
  for (const mutate of [
    f => { delete f.snapshot.projects[0].cases[0].workOrders[0]
      .providerContactCandidate; },
    f => { f.snapshot.projects[0].cases[0].workOrders[0]
      .providerContactCandidate.state = 'ambiguous'; },
  ]) {
    const f = fixture(); mutate(f); seal(f);
    const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
    h.graph.rows.set(LISTS.verifiedContacts, []);
    const preview = await h.flow.preview(WO);
    assert.equal(preview.status, 'eligible');
    assert.equal(preview.recipientEvidence, 'manual_entry');
    assert.deepEqual(preview.to, []);
    const result = await h.flow.draft(WO);
    assert.equal(result.status, 'recipient_review_required');
    assert.equal(result.recipientReviewRequired, true);
    assert.deepEqual(h.graph.messages.get(result.immutableId).toRecipients, []);
    const body = h.graph.messages.get(result.immutableId).body.content;
    for (const part of PICOS_PARTS) {
      assert.ok(body.includes(`href="${part.url}"`));
    }
    assert.equal(JSON.parse(h.graph.rows.get(LISTS.claims)[0]
      .fields.SourceETagsJson).snapshot.recipientEvidence, 'manual_entry');
    const again = await h.flow.draft(WO);
    assert.equal(again.immutableId, result.immutableId);
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
  }
});

test('current protected pair may prefill when the dated chart has no contact candidate', async () => {
  const f = fixture();
  delete f.snapshot.projects[0].cases[0].workOrders[0]
    .providerContactCandidate;
  seal(f);
  const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.recipientSuggestion, 'none');
  assert.equal(dated.recipientEvidence, 'verified_pair');
  assert.equal(dated.datedManagerEmail, null);
  assert.equal(dated.datedPlannerEmail, null);
  const preview = await h.flow.preview(WO);
  assert.deepEqual(preview.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'draft');
  assert.deepEqual(h.graph.messages.get(result.immutableId).toRecipients,
    [{emailAddress: {address: 'manager@example.invalid'}},
      {emailAddress: {address: 'planner@example.invalid'}}]);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
});

test('two fresh protected suggestions prefill both roles and keep the draft in review', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  const contact = h.graph.rows.get(LISTS.verifiedContacts)[0];
  contact.fields.Verified = false;
  contact.fields.VerifiedAtUtc = null;
  const preview = await h.flow.preview(WO);
  assert.equal(preview.recipientEvidence, 'suggested_pair');
  assert.equal(preview.recipientReviewRequired, true);
  assert.deepEqual(preview.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'recipient_review_required');
  const message = h.graph.messages.get(result.immutableId);
  assert.equal(message.isDraft, true);
  assert.deepEqual(message.toRecipients,
    [{emailAddress: {address: 'manager@example.invalid'}},
      {emailAddress: {address: 'planner@example.invalid'}}]);
  for (const part of PICOS_PARTS) {
    assert.ok(message.body.content.includes(`href="${part.url}"`));
  }
  const reopened = await h.flow.checkSent(WO);
  assert.equal(reopened.status, 'recipient_review_required');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
  assert.equal(typeof h.graph.sendMail, 'undefined');
});

test('a contradictory protected suggestion holds before Claim or draft', async () => {
  for (const mutate of [
    c => { c.PlannerEmail = 'other-planner@example.invalid'; },
    c => { c.ServiceAddressKey = '2 EXAMPLE ROAD|TESTVILLE|NY|10001'; },
    c => { c.SourceEvidenceDigest = ''; },
  ]) {
    const h = harness({exactJoinPortFactory: siteProtectedJoin});
    const contact = h.graph.rows.get(LISTS.verifiedContacts)[0];
    contact.fields.Verified = false;
    contact.fields.VerifiedAtUtc = null;
    mutate(contact.fields);
    await assert.rejects(() => h.flow.preview(WO));
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
  }
});

test('a stale protected suggestion cannot prefill Outlook To', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  const contact = h.graph.rows.get(LISTS.verifiedContacts)[0];
  contact.fields.Verified = false;
  contact.fields.VerifiedAtUtc = null;
  contact.fields.SourceCheckedAtUtc = new Date(
    NOW - 25 * 60 * 60_000).toISOString();
  const preview = await h.flow.preview(WO);
  assert.equal(preview.recipientEvidence, 'manual_entry');
  assert.deepEqual(preview.to, []);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('fresh protected one-mailbox suggestion prefills a review-required draft', async () => {
  const f = fixture();
  f.snapshot.projects[0].cases[0].workOrders[0]
    .providerContactCandidate.plannerEmail = 'manager@example.invalid';
  seal(f);
  const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
  h.graph.rows.get(LISTS.verifiedContacts)[0].fields.Verified = false;
  h.graph.rows.get(LISTS.verifiedContacts)[0].fields.VerifiedAtUtc = null;
  const preview = await h.flow.preview(WO);
  assert.equal(preview.recipientEvidence, 'suggested_pair');
  assert.deepEqual(preview.to, ['manager@example.invalid']);
  assert.equal(preview.recipientReviewRequired, true);
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.datedManagerEmail, 'manager@example.invalid');
  assert.equal(dated.datedPlannerEmail, 'manager@example.invalid');
  assert.deepEqual(dated.to, ['manager@example.invalid']);
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'recipient_review_required');
  assert.deepEqual(h.graph.messages.get(result.immutableId).toRecipients,
    [{emailAddress: {address: 'manager@example.invalid'}}]);
  assert.equal(JSON.parse(h.graph.rows.get(LISTS.claims)[0]
    .fields.SourceETagsJson).snapshot.recipientEvidence, 'suggested_pair');
  const reopened = await h.flow.checkSent(WO);
  assert.equal(reopened.status, 'recipient_review_required');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
});

test('two dated chart contacts stay out of Outlook To without protected contacts', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  h.graph.rows.set(LISTS.verifiedContacts, []);
  const preview = await h.flow.preview(WO);
  assert.equal(preview.status, 'eligible');
  assert.equal(preview.recipientEvidence, 'manual_entry');
  assert.deepEqual(preview.to, []);
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.datedManagerEmail, 'manager@example.invalid');
  assert.equal(dated.datedPlannerEmail, 'planner@example.invalid');
  assert.deepEqual(dated.to, []);
  const first = await h.flow.draft(WO);
  assert.equal(first.status, 'recipient_review_required');
  assert.deepEqual(h.graph.messages.get(first.immutableId).toRecipients, []);
  assert.equal(JSON.parse(h.graph.rows.get(LISTS.claims)[0]
    .fields.SourceETagsJson).snapshot.recipientEvidence, 'manual_entry');
  h.f.actor = ACTOR_B;
  const second = await h.flow.draft(WO);
  assert.equal(second.status, 'draft_status_unverified');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
  assert.equal(typeof h.graph.sendMail, 'undefined');
});

test('stale protected pair also leaves Outlook To blank despite dated chart suggestions', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  const contact = h.graph.rows.get(LISTS.verifiedContacts)[0];
  contact.fields.VerifiedAtUtc =
    new Date(NOW - 31 * 24 * 60 * 60_000).toISOString();
  const preview = await h.flow.preview(WO);
  assert.equal(preview.recipientEvidence, 'manual_entry');
  assert.deepEqual(preview.to, []);
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'recipient_review_required');
  assert.deepEqual(h.graph.messages.get(result.immutableId).toRecipients, []);
  assert.equal(typeof h.graph.sendMail, 'undefined');
});

test('writer rejects chart address injection into a blank-To draft before Claim', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin,
    actionPortFactory: writer => portWith(writer, command =>
      writer.createFirstDraft({...command, content: {...command.content,
        to: ['manager@example.invalid', 'planner@example.invalid']}}))});
  h.graph.rows.set(LISTS.verifiedContacts, []);
  await rejectsCode(() => h.flow.draft(WO),
    'SNAPSHOT_DRAFT_COMMAND_INVALID');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('an exact WO identity mismatch still holds when contacts are absent', async () => {
  for (const [field, value] of [
    ['AssignedAgentCode', 'B2'],
    ['StoreNumber', '2002'],
    ['OutletACN', '00999999'],
  ]) {
    const h = harness({exactJoinPortFactory: siteProtectedJoin});
    h.graph.rows.set(LISTS.verifiedContacts, []);
    h.graph.rows.get(LISTS.woSource)[0].fields[field] = value;
    await rejectsCode(() => h.flow.preview(WO),
      'PROTECTED_PROVIDER_JOIN_MISMATCH');
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
  }
});

test('an ambiguous protected WO identity also hides dated contact suggestions', async () => {
  const h = harness({exactJoinPortFactory: siteProtectedJoin});
  h.graph.rows.set(LISTS.verifiedContacts, []);
  h.graph.rows.get(LISTS.woSource)[0].fields.OutletACN = '00999999';
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'linkage_held');
  assert.equal(dated.reasonCode, 'PROTECTED_PROVIDER_JOIN_MISMATCH');
  assert.equal(dated.datedManagerEmail, null);
  assert.equal(dated.datedPlannerEmail, null);
  assert.deepEqual(dated.to, []);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('dated panel shows the protected unverified pair as suggestions', async () => {
  const f = fixture();
  const h = harness({fixture: f, exactJoinPortFactory: siteProtectedJoin});
  h.graph.rows.get(LISTS.verifiedContacts)[0].fields.Verified = false;
  h.graph.rows.get(LISTS.verifiedContacts)[0].fields.VerifiedAtUtc = null;
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'preinstall_snapshot_candidate');
  assert.equal(dated.recipientEvidence, 'suggested_pair');
  assert.equal(dated.recipientSuggestion, 'exact_saved_file_pair');
  assert.deepEqual(dated.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal(dated.recipientReviewRequired, true);
  assert.equal(dated.datedManagerEmail, 'manager@example.invalid');
  assert.equal(dated.datedPlannerEmail, 'planner@example.invalid');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('dated panel shows recipients only after a protected pair agrees', async () => {
  const h = harness();
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'preinstall_snapshot_candidate');
  assert.equal(dated.recipientSuggestion, 'exact_saved_file_pair');
  assert.deepEqual(dated.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('another coordinator sees occupied key, no link, no second Claim or draft', async () => {
  const h = harness();
  await h.flow.draft(WO);
  h.f.actor = ACTOR_B;
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'draft_status_unverified');
  assert.equal(p.webLink, null);
  const repeat = await h.flow.draft(WO);
  assert.equal(repeat.status, 'draft_status_unverified');
  assert.equal(Object.hasOwn(repeat, 'webLink'), false);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
});

test('owner reopens an unsent draft after Release expiry and revocation', async () => {
  const h = harness();
  const first = await h.flow.draft(WO);
  h.f.nowMs = Date.parse(OBSERVED) + 26 * 60 * 60_000;
  h.f.release.fields.ReleaseState = 'Revoked';
  const releaseReads = h.graph.requestCalls.filter(([path]) =>
    path.includes(`/lists/${LISTS.ganttRelease}`)).length;
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.sourceAvailable, false);
  assert.equal(dated.existingStatus, 'draft_occupied');
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'draft_occupied');
  assert.equal(p.validUntilUtc, null);
  const reopened = await h.flow.draft(WO);
  assert.equal(reopened.status, 'draft');
  assert.equal(reopened.webLink, first.webLink);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
  assert.equal(h.graph.requestCalls.filter(([path]) =>
    path.includes(`/lists/${LISTS.ganttRelease}`)).length, releaseReads);
});

test('completed or changed source cannot block owned draft reopen or expose its link', async () => {
  const h = harness();
  const first = await h.flow.draft(WO);
  h.f.snapshot.projects[0].cases[0].workOrders[0].status = 'Completed';
  h.f.overlay.rows[WO].status = 'Completed';
  seal(h.f);
  h.f.release.eTag = '"2"';
  h.f.release.lastModifiedDateTime = new Date(NOW + 10_000).toISOString();
  h.f.actor = ACTOR_B;
  const other = await h.flow.preview(WO);
  assert.equal(other.status, 'draft_status_unverified');
  assert.equal(other.webLink, null);
  const otherClick = await h.flow.draft(WO);
  assert.equal(otherClick.status, 'draft_status_unverified');
  assert.equal(Object.hasOwn(otherClick, 'webLink'), false);
  h.f.actor = ACTOR_A;
  const own = await h.flow.draft(WO);
  assert.equal(own.status, 'draft');
  assert.equal(own.webLink, first.webLink);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
});

test('uncertain occupied Claim stays occupied after the source expires', async () => {
  const h = harness();
  h.graph.failClaimAfterPersist = true;
  await rejectsCode(() => h.flow.draft(WO), 'CLAIM_OUTCOME_UNKNOWN');
  h.graph.failClaimAfterPersist = false;
  h.f.nowMs = Date.parse(OBSERVED) + 26 * 60 * 60_000;
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'claim_outcome_unverified');
  const repeat = await h.flow.draft(WO);
  assert.equal(repeat.status, 'claim_outcome_unverified');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 0]);
});

test('Claim POST uncertainty occupies key; retry never creates draft', async () => {
  const h = harness();
  h.graph.failClaimAfterPersist = true;
  await rejectsCode(() => h.flow.draft(WO), 'CLAIM_OUTCOME_UNKNOWN');
  assert.equal(h.graph.rows.get(LISTS.claims).length, 1);
  assert.equal(h.graph.draftPosts, 0);
  h.graph.failClaimAfterPersist = false;
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'claim_outcome_unverified');
  const repeat = await h.flow.draft(WO);
  assert.equal(repeat.status, 'claim_outcome_unverified');
  assert.equal(h.graph.draftPosts, 0);
});

test('ambiguous draft POST leaves one occupied Claim without retry', async () => {
  const h = harness();
  h.graph.failDraftAfterPersist = true;
  await rejectsCode(() => h.flow.draft(WO), 'DRAFT_OUTCOME_UNKNOWN');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 0]);
  h.graph.failDraftAfterPersist = false;
  const repeat = await h.flow.draft(WO);
  assert.equal(repeat.status, 'claim_outcome_unverified');
  assert.equal(h.graph.draftPosts, 1);
});

test('Release ETag change after Claim blocks Graph draft POST', async () => {
  const h = harness();
  h.graph.changeReleaseAfterClaim = true;
  await rejectsCode(() => h.flow.draft(WO),
    'GANTT_RELEASE_CHANGED_AFTER_CLAIM');
  assert.equal(h.graph.claimPosts, 1);
  assert.equal(h.graph.draftPosts, 0);
  assert.equal(h.graph.receiptPosts, 0);
});

test('held, closeout, chart conflict, and expired Release make no Claim', async () => {
  for (const [mutate, code] of [
    [f => { f.overlay.rows[WO].hold = '1'; }, 'SNAPSHOT_COMPLETED_OR_HELD'],
    [f => { f.overlay.rows[WO].status = 'Pending Closeout';
      f.snapshot.projects[0].cases[0].workOrders[0].status =
        'Pending Closeout'; }, 'SNAPSHOT_PHASE_REVIEW'],
    [f => { f.snapshot.projects[0].cases[0].workOrders[0].status =
      'Pending Scheduled Date'; }, 'SNAPSHOT_STALE_CHART_REVIEW'],
    [f => { f.nowMs = Date.parse(OBSERVED) + 24 * 60 * 60_000; },
      'GANTT_RELEASE_EXPIRED'],
  ]) {
    const f = fixture(); mutate(f); seal(f);
    const h = harness({fixture: f});
    await rejectsCode(() => h.flow.draft(WO), code);
    assert.equal(h.graph.claimPosts, 0);
    assert.equal(h.graph.draftPosts, 0);
  }
});

test('new relocation draft holds until protected classification exists', async () => {
  const f = fixture();
  const wo = f.snapshot.projects[0].cases[0].workOrders[0];
  wo.type = 'Relocation';
  wo.serviceType = '8 - Relocate/Remodel';
  f.overlay.rows[WO].workOrderType = wo.type;
  f.overlay.rows[WO].serviceType = wo.serviceType;
  seal(f);
  const h = harness({fixture: f});
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.eligibility, 'relocation_review');
  assert.equal(dated.reasonCode,
    'PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED');
  await rejectsCode(() => h.flow.preview(WO),
    'PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED');
  await rejectsCode(() => h.flow.draft(WO),
    'PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('an occupied draft reopens after the dated visit changes to relocation', async () => {
  const h = harness();
  const first = await h.flow.draft(WO);
  const wo = h.f.snapshot.projects[0].cases[0].workOrders[0];
  wo.type = 'Relocation';
  wo.serviceType = '8 - Relocate/Remodel';
  h.f.overlay.rows[WO].workOrderType = wo.type;
  h.f.overlay.rows[WO].serviceType = wo.serviceType;
  seal(h.f);
  const resumed = await h.flow.draft(WO);
  assert.equal(resumed.status, 'draft');
  assert.equal(resumed.webLink, first.webLink);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
});

test('known filter-only, survey, line-run, and fire-up visits hold before Claim', async () => {
  for (const label of ['A - Install Water Filter Only',
    'A - Survey Fountain Scope', 'A - Line Run', 'A - Fire-Up']) {
    const f = fixture();
    f.snapshot.projects[0].cases[0].workOrders[0].serviceType = label;
    f.overlay.rows[WO].serviceType = label;
    seal(f);
    const h = harness({fixture: f});
    const dated = await h.flow.snapshotPreview(WO);
    assert.equal(dated.scopeClass, 'known_other');
    assert.equal(dated.eligibility, 'scope_excluded');
    await rejectsCode(() => h.flow.draft(WO), 'VISIT_SCOPE_EXCLUDED');
    assert.equal(h.graph.claimPosts, 0);
    assert.equal(h.graph.draftPosts, 0);
  }
});

test('unknown non-dispenser scope stays unsent with scope review required', async () => {
  const f = fixture();
  const label = 'C - Install Non-Serialized/Non-Dispenser';
  f.snapshot.projects[0].cases[0].workOrders[0].serviceType = label;
  f.overlay.rows[WO].serviceType = label;
  seal(f);
  const h = harness({fixture: f, exactJoinPort: {resolve: async id => ({
    ...inventedExactJoin(f, id), serviceTypeCode: 'C'})}});
  const dated = await h.flow.snapshotPreview(WO);
  assert.equal(dated.scopeClass, 'unknown');
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'eligible');
  assert.equal(p.scopeReviewRequired, true);
  const draft = await h.flow.draft(WO);
  assert.equal(draft.status, 'draft');
  assert.equal(h.graph.messages.get(draft.immutableId).isDraft, true);
  for (const part of PICOS_PARTS) {
    assert.ok(h.graph.messages.get(draft.immutableId).body.content
      .includes(`href="${part.url}"`));
  }
});

test('attended Check Sent logs actual edited audience and content once', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const message = h.graph.messages.get(draft.immutableId);
  message.isDraft = false;
  message.parentFolderId = 'folder-sentitems';
  message.sentDateTime = new Date(NOW).toISOString();
  message.internetMessageId = '<invented@example.invalid>';
  message.toRecipients = [{emailAddress: {address: 'new@example.invalid'}}];
  message.ccRecipients = [{emailAddress: {address: 'copy@example.invalid'}}];
  message.subject += ' edited';
  message.body.content += '<p>Coordinator edit</p>';
  const result = await h.flow.checkSent(WO);
  assert.equal(result.status, 'sent_with_changes');
  assert.equal(Object.hasOwn(result, 'reviewReason'), false);
  assert.equal(h.graph.receiptPosts, 2);
  const sent = h.graph.rows.get(LISTS.receipts)[1].fields;
  assert.equal(sent.ReceiptKey, `${providerDispatchKey(WO)}|Sent`);
  assert.deepEqual(JSON.parse(sent.ActualToJson), ['new@example.invalid']);
  assert.deepEqual(JSON.parse(sent.ActualCcJson), ['copy@example.invalid']);
  assert.equal(sent.ReviewReason, 'SENT_DETAILS_CHANGED');
  assert.equal(sent.ActualSubject, `sha256:${SHA(message.subject)}`);
  assert.equal(Object.hasOwn(h.graph.rows.get(LISTS.receipts)[0].fields,
    'DraftWebLink'), false);
  // A List row is untrusted input. The V4 reader rejects a free-text
  // ReviewReason rather than echoing it to another coordinator.
  sent.ReviewReason = 'https://tracker.example.invalid/private-capability';
  h.f.actor = ACTOR_B;
  await rejectsCode(() => h.flow.checkSent(WO),
    'SNAPSHOT_SENT_RECEIPT_INVALID');
  sent.ReviewReason = 'SENT_DETAILS_CHANGED';
  const beforeSharedRead = h.graph.messageReads;
  const second = await h.flow.checkSent(WO);
  assert.equal(second.status, 'sent_recorded_unverified');
  assert.equal(h.graph.messageReads, beforeSharedRead);
  assert.equal(JSON.stringify(second).includes('private-capability'), false);
  assert.equal(Object.hasOwn(second, 'reviewReason'), false);
  assert.equal(h.graph.receiptPosts, 2);
});

test('missing immutable message is unresolved, never inferred as sent', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  h.graph.messages.delete(draft.immutableId);
  const result = await h.flow.checkSent(WO);
  assert.equal(result.status, 'unresolved');
  assert.equal(h.graph.receiptPosts, 1);
  assert.equal(h.graph.rows.get(LISTS.receipts).length, 1);
});

test('provider Sent copy with a changed ID is owner-verified once and blocks another draft', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const key = providerDispatchKey(WO);
  const original = h.graph.messages.get(draft.immutableId);
  const sentId = 'immutable-invented-provider-sent-copy';
  h.graph.messages.delete(draft.immutableId);
  h.graph.messages.set(sentId, {...structuredClone(original), id: sentId,
    isDraft: false, parentFolderId: 'folder-sentitems',
    sentDateTime: new Date(NOW).toISOString(),
    internetMessageId: '<provider-changed-id@example.invalid>'});
  h.graph.sentScanResult = sentId;
  const result = await h.flow.checkSent(WO);
  assert.equal(result.status, 'sent');
  const stored = h.graph.rows.get(LISTS.receipts)[1].fields;
  assert.equal(stored.DraftImmutableId, draft.immutableId);
  assert.equal(stored.SentImmutableId, sentId);
  const claim = h.graph.rows.get(LISTS.claims)[0].fields;
  assert.deepEqual(h.graph.sentScanCalls, [{correlationId: claim.CorrelationId,
    claimedAtUtc: claim.ClaimedAtUtc}]);
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 2]);
  h.graph.sentScanError = new Error('scan should not run again');
  assert.equal((await h.flow.checkSent(WO)).status, 'sent');
  assert.equal(h.graph.sentScanCalls.length, 1);
  assert.equal((await h.flow.draft(WO)).status, 'sent');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
  h.f.actor = ACTOR_B;
  const reads = h.graph.messageReads;
  assert.equal((await h.flow.checkSent(WO)).status,
    'sent_recorded_unverified');
  assert.equal(h.graph.messageReads, reads);
  assert.equal((await h.flow.draft(WO)).status,
    'sent_recorded_unverified');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [1, 1]);
  assert.equal((await new SnapshotClaimReceiptStore({graph: h.graph,
    config: config(), now: () => h.f.nowMs}).getState(key)).sent
    .fields.SentImmutableId, sentId);
});

test('provider missing, ambiguous, or failed Sent scan stays unresolved and occupied', async () => {
  for (const scan of [null, new Error('ambiguous or incomplete scan')]) {
    const h = harness();
    const draft = await h.flow.draft(WO);
    h.graph.messages.delete(draft.immutableId);
    if (scan instanceof Error) h.graph.sentScanError = scan;
    else h.graph.sentScanResult = scan;
    assert.equal((await h.flow.checkSent(WO)).status, 'unresolved');
    assert.equal((await h.flow.draft(WO)).status, 'unresolved');
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
      h.graph.receiptPosts], [1, 1, 1]);
  }
});

test('provider changed-ID candidate must be the correlated Sent item', async () => {
  for (const mutate of [
    message => { message.internetMessageHeaders = []; },
    message => { message.isDraft = true; message.parentFolderId = 'folder-drafts'; },
    message => { message.parentFolderId = 'folder-inbox'; },
  ]) {
    const h = harness();
    const draft = await h.flow.draft(WO);
    const original = h.graph.messages.get(draft.immutableId);
    const sentId = 'immutable-invented-provider-sent-copy';
    h.graph.messages.delete(draft.immutableId);
    const candidate = {...structuredClone(original), id: sentId,
      isDraft: false, parentFolderId: 'folder-sentitems',
      sentDateTime: new Date(NOW).toISOString(),
      internetMessageId: '<provider-changed-id@example.invalid>'};
    mutate(candidate);
    h.graph.messages.set(sentId, candidate);
    h.graph.sentScanResult = sentId;
    await assert.rejects(() => h.flow.checkSent(WO));
    assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
      h.graph.receiptPosts], [1, 1, 1]);
  }
});

test('a forged alternate Sent ID is only a hint, never mailbox proof', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const key = providerDispatchKey(WO);
  const store = new SnapshotClaimReceiptStore({graph: h.graph,
    config: config(), now: () => h.f.nowMs});
  const state = await store.getState(key);
  const original = h.graph.messages.get(draft.immutableId);
  const hintedId = 'immutable-invented-provider-hint';
  h.graph.messages.delete(draft.immutableId);
  h.graph.messages.set(hintedId, {...structuredClone(original), id: hintedId});
  await store.appendSent(state, ACTOR_A, {id: hintedId,
    to: ['manager@example.invalid', 'planner@example.invalid'],
    cc: [], bcc: [], sentAtUtc: new Date(NOW).toISOString(),
    internetMessageId: '<forged-alt@example.invalid>',
    subject: original.subject, bodySha256: SHA(original.body.content),
    linksSha256: SHA(JSON.stringify(PICOS_PARTS.map(part => part.url).sort())),
    reviewReason: ''});
  assert.equal((await h.flow.preview(WO)).status,
    'sent_recorded_unverified');
  await rejectsCode(() => h.flow.checkSent(WO), 'SENT_SCAN_NOT_SENT');
  assert.equal(h.graph.sentScanCalls.length, 0);
  assert.equal(h.graph.draftPosts, 1);
  h.f.actor = ACTOR_B;
  const before = h.graph.messageReads;
  assert.equal((await h.flow.checkSent(WO)).status,
    'sent_recorded_unverified');
  assert.equal(h.graph.messageReads, before);
});

test('a shape-valid forged Sent row never proves a send or permits a second draft', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const dispatchKey = providerDispatchKey(WO);
  const store = new SnapshotClaimReceiptStore({graph: h.graph,
    config: config(), now: () => h.f.nowMs});
  const state = await store.getState(dispatchKey);
  const message = h.graph.messages.get(draft.immutableId);
  // Any principal with Add can fabricate shape-valid fields outside this UI.
  // The actual mailbox message intentionally remains in Drafts.
  await store.appendSent(state, ACTOR_A, {id: draft.immutableId,
    to: ['manager@example.invalid', 'planner@example.invalid'],
    cc: [], bcc: [], sentAtUtc: new Date(NOW).toISOString(),
    internetMessageId: '<forged@example.invalid>',
    subject: message.subject, bodySha256: SHA(message.body.content),
    linksSha256: SHA(JSON.stringify(PICOS_PARTS.map(part => part.url).sort())),
    reviewReason: ''});
  assert.equal((await h.flow.preview(WO)).status,
    'sent_recorded_unverified');
  const draftPosts = h.graph.draftPosts;
  await rejectsCode(() => h.flow.checkSent(WO), 'DRAFT_AND_SENT_CONFLICT');
  await rejectsCode(() => h.flow.draft(WO), 'DRAFT_AND_SENT_CONFLICT');
  assert.equal(h.graph.draftPosts, draftPosts);
  h.f.actor = ACTOR_B;
  const messageReads = h.graph.messageReads;
  assert.equal((await h.flow.checkSent(WO)).status,
    'sent_recorded_unverified');
  assert.equal((await h.flow.draft(WO)).status,
    'sent_recorded_unverified');
  assert.equal(h.graph.messageReads, messageReads);
  assert.equal(h.graph.draftPosts, draftPosts);
});

test('owner rechecks an existing Sent receipt against mailbox facts', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const message = h.graph.messages.get(draft.immutableId);
  message.isDraft = false;
  message.parentFolderId = 'folder-sentitems';
  message.sentDateTime = new Date(NOW).toISOString();
  message.internetMessageId = '<sent@example.invalid>';
  assert.equal((await h.flow.checkSent(WO)).status, 'sent');
  assert.equal((await h.flow.preview(WO)).status,
    'sent_recorded_unverified');
  const receiptPosts = h.graph.receiptPosts;
  const messageReads = h.graph.messageReads;
  assert.equal((await h.flow.checkSent(WO)).status, 'sent');
  assert.equal(h.graph.receiptPosts, receiptPosts);
  assert.equal(h.graph.messageReads, messageReads + 1);
  const sent = h.graph.rows.get(LISTS.receipts)[1].fields;
  sent.ActualBodySha256 = 'f'.repeat(64);
  await rejectsCode(() => h.flow.checkSent(WO), 'SENT_RECEIPT_CONFLICT');
  assert.equal(h.graph.receiptPosts, receiptPosts);
});

test('a Sent row with a missing original immutable ID remains unresolved', async () => {
  const h = harness();
  const draft = await h.flow.draft(WO);
  const message = h.graph.messages.get(draft.immutableId);
  message.isDraft = false;
  message.parentFolderId = 'folder-sentitems';
  message.sentDateTime = new Date(NOW).toISOString();
  message.internetMessageId = '<sent@example.invalid>';
  assert.equal((await h.flow.checkSent(WO)).status, 'sent');
  h.graph.messages.delete(draft.immutableId);
  const draftPosts = h.graph.draftPosts;
  assert.equal((await h.flow.checkSent(WO)).status, 'unresolved');
  assert.equal((await h.flow.draft(WO)).status, 'unresolved');
  assert.equal(h.graph.draftPosts, draftPosts);
});

test('snapshot writer reads old V2 provider Claim as occupied', async () => {
  const h = harness();
  h.graph.rows.get(LISTS.claims).push({id: '1', eTag: '"1"', fields: {
    Title: providerDispatchKey(WO), DispatchKey: providerDispatchKey(WO),
    ActionKind: 'provider-parts', EntityId: WO,
    ActorOid: ACTOR_A.id, ActorEmail: ACTOR_A.address,
    AttemptId: '77777777-7777-4777-8777-000000000001',
    CorrelationId: '77777777-7777-4777-8777-000000000002',
    SourceDigest: 'a'.repeat(64),
    SourceETagsJson: JSON.stringify({wo: {itemId: '1', etag: '"1"'},
      contact: {state: 'absent', lookupKey: 'a'.repeat(64)}}),
    ClaimedAtUtc: new Date(NOW).toISOString(),
  }});
  const p = await h.flow.preview(WO);
  assert.equal(p.status, 'claim_outcome_unverified');
  assert.equal(h.graph.draftPosts, 0);
});

test('atomic parent adapter offers provider and customer buttons without a review modal', async () => {
  const h = harness();
  const customerCalls = [];
  const customerFormKey = 'F:123:456';
  const customerValidUntilUtc = '2099-01-01T00:00:00Z';
  const customerBinding = {formSourceKey: customerFormKey,
    sourceDigest: 'a'.repeat(64),
    sourceETagsJson: JSON.stringify({release: {itemId: '1', etag: '"1"'}}),
    recipientEmail: 'customer@example.invalid',
    trackerUrlSha256: 'b'.repeat(64),
    validUntilMs: Date.parse(customerValidUntilUtc)};
  const actions = {
    async preview(kind, id) {
      customerCalls.push(['preview', kind, id]);
      return {kind, id, status: 'eligible', storeNumber: null,
        to: ['customer@example.invalid'], cc: [],
        validUntilUtc: customerValidUntilUtc, binding: customerBinding};
    },
    async customerDraft(id, binding) {
      customerCalls.push(['customerDraft', id, binding]);
      return {status: 'draft', webLink: OUTLOOK('customer-invented')};
    },
    async checkCustomerSent(id) {
      customerCalls.push(['checkCustomerSent', id]);
      return {status: 'not_started'};
    },
  };
  const adapter = createV2ParentAdapter({enabled: true, actions,
    signIn: async () => {}, providerFlow: h.flow});
  await adapter.signInFromClick();
  const providerPreview = await adapter.preview('provider', WO);
  assert.equal(providerPreview.canDraft, true);
  assert.deepEqual(providerPreview.binding.to, providerPreview.to);
  assert.equal((await adapter.createOrOpenProviderDraft(
    WO, providerPreview.binding)).state, 'draft');
  assert.equal(h.graph.draftPosts, 1);
  const reviewed = await adapter.preview('customer', customerFormKey);
  assert.deepEqual(reviewed.binding, customerBinding);
  await adapter.createOrOpenCustomerDraft(customerFormKey, reviewed.binding);
  assert.deepEqual(customerCalls, [['preview', 'customer', customerFormKey],
    ['customerDraft', customerFormKey, customerBinding]]);
});

test('parent adapter rejects a provider preview whose binding differs from displayed To', async () => {
  const h = harness();
  const providerFlow = Object.freeze({...h.rawFlow,
    async preview(id) {
      const result = await h.rawFlow.preview(id);
      return {...result, binding: {...result.binding,
        to: ['unseen@example.invalid', result.to[1]]}};
    },
    async draft() { throw new Error('a malformed preview cannot arm a draft'); },
  });
  const actions = {async preview() { throw new Error('customer unused'); },
    async customerDraft() { throw new Error('customer unused'); },
    async checkCustomerSent() { throw new Error('customer unused'); }};
  const adapter = createV2ParentAdapter({enabled: true, actions,
    signIn: async () => {}, providerFlow});
  await adapter.signInFromClick();
  await rejectsCode(() => adapter.preview('provider', WO),
    'PROVIDER_PREVIEW_BINDING_INVALID');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('snapshot adapter holds first draft when native WO store is missing', async () => {
  const f = fixture();
  const wo = f.snapshot.projects[0].cases[0].workOrders[0];
  wo.woStore = null;
  wo.providerContactCandidate.matchMethod = 'exact_address_acn_agent';
  wo.providerContactCandidate.storeNumberStillMissing = true;
  seal(f);
  const h = harness({fixture: f});
  const actions = {async preview() { throw new Error('customer unused'); },
    async customerDraft() { throw new Error('customer unused'); },
    async checkCustomerSent() { throw new Error('customer unused'); }};
  const adapter = createV2ParentAdapter({enabled: true, actions,
    signIn: async () => {}, providerFlow: h.flow});
  await adapter.signInFromClick();
  await rejectsCode(() => adapter.preview('provider', WO),
    'SNAPSHOT_RECIPIENT_SUGGESTION_UNVERIFIED');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts], [0, 0]);
});

test('customer adapter drops raw free text from a shared Sent result', async () => {
  const h = harness();
  const actions = {
    async preview(kind, id) { return {kind, id, status: 'sent',
      storeNumber: null, to: [], cc: [], webLink: null}; },
    async customerDraft() { throw new Error('unused'); },
    async checkCustomerSent() { return {status: 'sent_with_changes',
      reviewReason: 'https://tracker.example.invalid/private-capability'}; },
  };
  const adapter = createV2ParentAdapter({enabled: true, actions,
    signIn: async () => {}, providerFlow: h.flow});
  await adapter.signInFromClick();
  const result = await adapter.verifySentBySelection('customer', 'F:123:456');
  assert.deepEqual(result, {state: 'sent_with_changes'});
});

test('adapter maps a shared Sent record to a held state without a draft link', async () => {
  const h = harness();
  const actions = {
    async preview(kind, id) { return {kind, id,
      status: 'sent_recorded_unverified', storeNumber: null,
      to: [], cc: [], webLink: null}; },
    async customerDraft() { return {status: 'sent_recorded_unverified'}; },
    async checkCustomerSent() { return {status: 'sent_recorded_unverified'}; },
  };
  const adapter = createV2ParentAdapter({enabled: true, actions,
    signIn: async () => {}, providerFlow: h.flow});
  await adapter.signInFromClick();
  const preview = await adapter.preview('customer', 'F:123:456');
  assert.equal(preview.canDraft, false);
  assert.deepEqual(await adapter.verifySentBySelection('customer', 'F:123:456'),
    {state: 'held', reason: 'SHARED_SENT_RECORD_UNVERIFIED'});
  assert.deepEqual(await adapter.createOrOpenCustomerDraft('F:123:456'),
    {state: 'held', reason: 'SHARED_SENT_RECORD_UNVERIFIED'});
});
