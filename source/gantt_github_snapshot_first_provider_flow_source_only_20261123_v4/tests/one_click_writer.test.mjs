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
  receipts: '55555555-5555-4555-8555-555555555555'});
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
    this.rows = new Map([[LISTS.ganttRelease, [f.release]],
      [LISTS.claims, []], [LISTS.receipts, []]]);
    this.messages = new Map();
    this.claimPosts = 0;
    this.receiptPosts = 0;
    this.draftPosts = 0;
    this.messageReads = 0;
    this.requestCalls = [];
    this.failClaimAfterPersist = false;
    this.failDraftAfterPersist = false;
    this.changeReleaseAfterClaim = false;
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
        'Arbys Coordinator Action Receipts';
    const key = release ? 'ReleaseKey' :
      listId === LISTS.claims ? 'DispatchKey' : 'ReceiptKey';
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
        (listId === LISTS.claims ? CLAIM_COLUMNS : RECEIPT_COLUMNS)
          .map(name => ({name, required: name === key,
            indexed: name === key, enforceUniqueValues: name === key,
            text: {}}))}};
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
function harness(options = {}) {
  const f = options.fixture ?? fixture();
  const graph = new FakeGraph(f);
  let uuid = 0;
  const writer = new SnapshotProviderActionWriter({config: config(options.config),
    graph, now: () => f.nowMs,
    randomUUID: () => `77777777-7777-4777-8777-${String(++uuid).padStart(12, '0')}`,
    domParserClass: BrowserParser});
  const actionPort = options.actionPortFactory?.(writer, graph) ?? writer;
  const releaseReader = new GanttReleaseReader({graph,
    siteId: SITE_ID, listId: LISTS.ganttRelease,
    siteUrl: SITE_URL, payloadUrl: PAYLOAD_URL});
  const flow = createSnapshotFirstProviderFlow({enabled: true,
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
    actionPort, now: () => f.nowMs});
  return {f, graph, writer, flow};
}
const rejectsCode = (operation, code) => assert.rejects(operation,
  error => error?.code === code);
function portWith(writer, createFirstDraft) {
  return {observe: (...args) => writer.observe(...args),
    resume: (...args) => writer.resume(...args),
    checkSent: (...args) => writer.checkSent(...args),
    createFirstDraft};
}

test('checked-in v4 config remains held; disabled writer makes no POST', async () => {
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

test('a Claim raced into the writer is reread as occupied without a second draft', async () => {
  const seed = harness();
  await seed.flow.draft(WO);
  const priorClaim = structuredClone(seed.graph.rows.get(LISTS.claims)[0]);
  const h = harness({actionPortFactory: (writer, graph) =>
    portWith(writer, async command => {
      graph.rows.get(LISTS.claims).push(structuredClone(priorClaim));
      return writer.createFirstDraft(command);
    })});
  h.f.actor = ACTOR_B;
  const result = await h.flow.draft(WO);
  assert.equal(result.status, 'draft_status_unverified');
  assert.equal(result.dispatchKey, providerDispatchKey(WO));
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

test('missing or ambiguous contact yields empty-To draft with explicit review state', async () => {
  for (const mutate of [
    f => { delete f.snapshot.projects[0].cases[0].workOrders[0]
      .providerContactCandidate; },
    f => { f.snapshot.projects[0].cases[0].workOrders[0]
      .providerContactCandidate.state = 'ambiguous'; },
  ]) {
    const f = fixture(); mutate(f); seal(f);
    const h = harness({fixture: f});
    const preview = await h.flow.preview(WO);
    assert.deepEqual(preview.to, []);
    const result = await h.flow.draft(WO);
    assert.equal(result.status, 'recipient_review_required');
    assert.deepEqual(h.graph.messages.get(result.immutableId).toRecipients, []);
    assert.equal(h.graph.draftPosts, 1);
  }
});

test('shared manager/planner mailbox is To once and remains receipt-readable', async () => {
  const f = fixture();
  f.snapshot.projects[0].cases[0].workOrders[0]
    .providerContactCandidate.plannerEmail = 'manager@example.invalid';
  seal(f);
  const h = harness({fixture: f});
  const first = await h.flow.draft(WO);
  assert.equal(first.status, 'draft');
  assert.deepEqual(JSON.parse(h.graph.rows.get(LISTS.receipts)[0]
    .fields.IntendedToJson), ['manager@example.invalid']);
  const repeat = await h.flow.draft(WO);
  assert.equal(repeat.status, 'draft');
  assert.deepEqual([h.graph.claimPosts, h.graph.draftPosts,
    h.graph.receiptPosts], [1, 1, 1]);
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
  const h = harness({fixture: f});
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
  const actions = {
    async preview(kind, id) {
      customerCalls.push(['preview', kind, id]);
      return {kind, id, status: 'eligible', storeNumber: null,
        to: ['customer@example.invalid'], cc: [],
        validUntilUtc: '2099-01-01T00:00:00Z'};
    },
    async customerDraft(id) {
      customerCalls.push(['customerDraft', id]);
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
  assert.equal((await adapter.preview('provider', WO)).canDraft, true);
  assert.equal((await adapter.createOrOpenProviderDraft(WO)).state, 'draft');
  assert.equal(h.graph.draftPosts, 1);
  await adapter.preview('customer', 'F:123:456');
  await adapter.createOrOpenCustomerDraft('F:123:456');
  assert.deepEqual(customerCalls, [['preview', 'customer', 'F:123:456'],
    ['customerDraft', 'F:123:456']]);
});

test('snapshot adapter shows an explicitly missing store without inventing one', async () => {
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
  const p = await adapter.preview('provider', WO);
  assert.equal(p.storeNumber, null);
  assert.equal(p.canDraft, true);
  assert.deepEqual(p.to, ['manager@example.invalid', 'planner@example.invalid']);
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
