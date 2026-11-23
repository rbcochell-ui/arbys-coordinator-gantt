import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {REDIRECT_URI} from '../src/auth_config.mjs';
import {validateProviderOnlyConfig} from '../src/compose_site.mjs';
import {ProviderOnlyActions, requireVerifiedRolePair,
  strictProviderSource, makeProviderPreviewBinding,
  assertSourceMatchesPreview} from '../src/provider_only_actions.mjs';
import {createProviderOnlyParentAdapter} from
  '../src/provider_only_parent_adapter.mjs';
import {buildProviderDraft, PICOS_PARTS} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {ProviderSourceResolver} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/provider_source.mjs';

const WO = '0WO000000000000GAA';
const SITE = 'groups.coca-cola.com,11111111-0000-4000-8000-000000000001,11111111-0000-4000-8000-000000000002';
const IDS = Object.freeze({tenant: '11111111-0000-4000-8000-000000000010',
  client: '11111111-0000-4000-8000-000000000011',
  coordinator: '11111111-0000-4000-8000-000000000012',
  owner: '11111111-0000-4000-8000-000000000018',
  wo: '11111111-0000-4000-8000-000000000013',
  contacts: '11111111-0000-4000-8000-000000000014',
  claims: '11111111-0000-4000-8000-000000000015',
  receipts: '11111111-0000-4000-8000-000000000016',
  legacy: '11111111-0000-4000-8000-000000000017'});

function source(overrides = {}) {
  return {nativeWoId: WO, woNumber: '900001', agentCode: 'A1',
    storeNumber: '10001', workOrderStatus: 'Pending Readiness',
    observedAtUtc: '2026-11-23T14:50:00Z',
    digest: 'a'.repeat(64), etagsJson: '{"wo":{"etag":"one"}}',
    to: ['manager@example.invalid', 'planner@example.invalid'],
    recipientReviewRequired: false, validUntilMs: Date.now() + 60_000,
    ...overrides};
}

function config() {
  return {enabled: true,
    encryptedPayloadUrl: 'https://rbcochell-ui.github.io/arbys-coordinator-gantt/data/gantt.enc.json',
    auth: {enabled: true, tenantId: IDS.tenant, clientId: IDS.client,
      coordinatorOids: [IDS.coordinator], redirectUri: REDIRECT_URI},
    lean: {enabled: true, tenantId: IDS.tenant, clientId: IDS.client,
      siteId: SITE, coordinatorOids: [IDS.coordinator],
      releaseOwnerOids: [IDS.owner],
      occupiedPilotClaimsMigrated: true,
      emptyToDraftCanaryPassed: false,
      providerEnabled: true, customerEnabled: false,
      lists: {woSource: IDS.wo, verifiedContacts: IDS.contacts,
        customerReleases: null, claims: IDS.claims, receipts: IDS.receipts},
      eligibleRawSpStatuses: [],
      eligibleWorkOrderStatuses: ['Pending Readiness'],
      eligibleServiceTypeCodes: ['9'],
      eligibleWorkOrderTypes: ['Installation']},
    legacyInventory: {siteId: SITE,
      siteUrl: 'https://groups.coca-cola.com/sites/ArbysOperations',
      releaseListId: IDS.legacy,
      releaseListTitle: 'Arbys Coordinator Gantt Releases',
      releaseKey: 'arbys-coordinator-gantt:provider-snapshot',
      ownerOids: [IDS.owner]}, legacyOwner: null,
    cohort: {enabled: true, mode: 'approved-chart-selection-v2',
      releaseListId: IDS.legacy}};
}

async function protectedSource({contactChange = null, woChange = null,
    noContact = false} = {}) {
  const nowMs = Date.parse('2026-11-23T15:10:00Z');
  const actor = {id: IDS.coordinator, address: 'coordinator@example.invalid'};
  const acn = '12345';
  const store = '10001';
  const keyBytes = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(['A1', acn, store])));
  const contactKey = [...new Uint8Array(keyBytes)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const woFields = {NativeWorkOrderId: WO, SourceComplete: true,
    SourceObservedAtUtc: '2026-11-23T15:00:00Z',
    SourceRevision: 'a'.repeat(64), NormalizedVisitKind: 'Install',
    ActivityType: 'Installation', WorkOrderType: 'Installation',
    WorkOrderStatus: 'Pending Readiness', ServiceTypeCode: '9',
    AssignedAgentCode: 'A1', OutletACN: acn, StoreNumber: store,
    ServiceAddressKey: '123 MAIN ST|CITY|ST|12345',
    WorkOrderNumber: '900001', ...woChange};
  const contactFields = {ContactKey: contactKey, AgentCode: 'A1',
    OutletACN: acn, StoreNumber: store,
    ServiceAddressKey: woFields.ServiceAddressKey,
    InstallManagerEmail: 'manager@example.invalid',
    PlannerEmail: 'planner@example.invalid', Verified: true,
    VerifiedAtUtc: '2026-11-22T12:00:00Z',
    SourceCheckedAtUtc: '2026-11-23T14:00:00Z',
    SourceEvidenceDigest: 'b'.repeat(64), ...contactChange};
  const data = (fields, id) => ({id: String(id), eTag: '"1"', fields});
  const graph = {
    async getMe() { return actor; },
    async request(path) {
      const contact = path.includes(`/lists/${IDS.contacts}`);
      const listId = contact ? IDS.contacts : IDS.wo;
      if (!path.includes(`/lists/${listId}`)) throw new Error('Other List');
      const title = contact ? 'Arbys Provider Parts Verified Contacts' :
        'Arbys Provider Parts WO Action Source';
      if (path.includes('/columns?')) return {status: 200, data: {value: [{
        name: contact ? 'ContactKey' : 'NativeWorkOrderId',
        required: true, indexed: true, enforceUniqueValues: true, text: {},
      }]}};
      if (path.includes('/items?')) return {status: 200, data: {value:
        contact && noContact ? [] : [data(contact ? contactFields : woFields,
          contact ? 2 : 1)]}};
      if (path.includes('/items/')) return {status: 200,
        data: data(contact ? contactFields : woFields, contact ? 2 : 1)};
      return {status: 200, data: {id: listId, displayName: title,
        webUrl: `https://groups.coca-cola.com/sites/ArbysOperations/Lists/${encodeURIComponent(title)}`}};
    },
  };
  const resolver = strictProviderSource(new ProviderSourceResolver({graph,
    config: config().lean, now: () => nowMs}));
  return {resolver, actor};
}

test('provider-only config has no Customer Release or FORM/Case dependency', () => {
  assert.doesNotThrow(() => validateProviderOnlyConfig(config()));
  for (const [mutate, reason] of [
    [c => { c.lean.customerEnabled = true; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.lean.lists.customerReleases = IDS.legacy; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.lean.emptyToDraftCanaryPassed = true; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.encryptedPayloadUrl = 'https://example.invalid/chart.enc.json'; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.cohort.enabled = false; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.cohort.releaseListId = IDS.claims; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.legacyInventory = null; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.legacyInventory.releaseKey = 'wrong:release'; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.legacyInventory.ownerOids = [IDS.coordinator]; },
      /PROVIDER_SITE_BINDING_MISMATCH/],
    [c => { c.lean.lists.receipts = IDS.claims; },
      /PROVIDER_SOURCE_NOT_RELEASED/],
  ]) {
    const c = config(); mutate(c);
    assert.throws(() => validateProviderOnlyConfig(c), reason);
  }
});

test('only an exact distinct verified two-role pair can reach the writer', () => {
  assert.equal(requireVerifiedRolePair(source()).agentCode, 'A1');
  for (const change of [
    {to: []}, {to: ['manager@example.invalid']},
    {to: ['same@example.invalid', 'same@example.invalid']},
    {to: ['manager@example.invalid', 'bad address']},
    {recipientReviewRequired: true},
    {nativeWoId: '0WO000000000000GAB'},
    {woNumber: ''}, {agentCode: ''},
  ]) {
    assert.throws(() => requireVerifiedRolePair(source(change)),
      /PROVIDER_ROLE_PAIR_NOT_VERIFIED/);
  }
});

test('role pair is checked again after the physical Claim', async () => {
  let confirmations = 0;
  const wrapped = strictProviderSource({
    async resolve() { return source(); },
    async confirmUnchanged() {
      confirmations++;
      return source({to: []});
    },
  });
  assert.deepEqual((await wrapped.resolve(WO, {})).to,
    ['manager@example.invalid', 'planner@example.invalid']);
  await assert.rejects(() => wrapped.confirmUnchanged(source(), {}),
    /PROVIDER_ROLE_PAIR_NOT_VERIFIED/);
  assert.equal(confirmations, 1);
});

test('provider preview binds both roles and reopens an occupied draft',
    async () => {
  const nowMs = Date.parse('2026-11-23T15:00:00Z');
  let detailTo = ['manager@example.invalid', 'planner@example.invalid'];
  let status = 'eligible';
  let receivedCommand = null;
  const actions = {
    async preview(kind, id) {
      return {kind, id, status, storeNumber: '10001',
        to: status === 'eligible' ?
          ['manager@example.invalid', 'planner@example.invalid'] : [],
        cc: [], recipientReviewRequired: false,
        validUntilUtc: '2026-11-23T15:05:00Z'};
    },
    async providerPreviewDetails() {
      const binding = makeProviderPreviewBinding(source({to: detailTo,
        validUntilMs: nowMs + 5 * 60_000}),
      {releaseBinding: 'b'.repeat(64),
        validUntilMs: nowMs + 5 * 60_000}, nowMs);
      return {nativeWoId: WO, woNumber: '900001', storeNumber: '10001',
        agentCode: 'A1', workOrderStatus: 'Pending Readiness',
        observedAtUtc: '2026-11-23T14:50:00Z', to: detailTo,
        validUntilMs: nowMs + 5 * 60_000, binding};
    },
    async providerDraftWithPreview(command) {
      receivedCommand = command;
      return status === 'draft_occupied'
        ? {status: 'draft', webLink: 'https://outlook.office.com/mail/id/synthetic'}
        : {status: 'not_started'};
    },
    async checkSent() { return {status: 'not_started'}; },
    async customerDraft() { throw new Error('Customer called'); },
    async checkCustomerSent() { throw new Error('Customer called'); },
  };
  const adapter = createProviderOnlyParentAdapter({enabled: true, actions,
    signIn: async () => {}, now: () => nowMs});
  await adapter.signInFromClick();
  const preview = await adapter.preview('provider', WO);
  assert.equal(preview.canDraft, true);
  assert.equal(preview.woNumber, '900001');
  assert.equal(preview.agentCode, 'A1');
  assert.equal(preview.workOrderStatus, 'Pending Readiness');
  assert.equal(preview.observedAtUtc, '2026-11-23T14:50:00Z');
  assert.deepEqual(preview.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal(preview.binding.sourceDigest, 'a'.repeat(64));
  assert.equal((await adapter.createOrOpenProviderDraft(WO,
    preview.binding)).state, 'held');
  await assert.rejects(() => adapter.createOrOpenProviderDraft(WO,
    preview.binding), /PROVIDER_PREVIEW_BINDING_REQUIRED/);
  status = 'draft_occupied';
  const occupied = await adapter.preview('provider', WO);
  assert.equal(occupied.canDraft, true);
  assert.equal((await adapter.createOrOpenProviderDraft(WO,
    occupied.binding)).state, 'draft');
  assert.equal(receivedCommand.id, WO);
  assert.equal(receivedCommand.binding, occupied.binding);
  detailTo = ['changed@example.invalid', 'planner@example.invalid'];
  status = 'eligible';
  await assert.rejects(() => adapter.preview('provider', WO),
    /PROVIDER_PREVIEW_CHANGED_DURING_READ/);
  await assert.rejects(() => adapter.preview('customer', 'F:1:1'),
    /CUSTOMER_ACTIONS_NOT_RELEASED/);
  await assert.rejects(() => adapter.createOrOpenCustomerDraft('F:1:1'),
    /CUSTOMER_ACTIONS_NOT_RELEASED/);
});

test('a source change after preview stops before the inherited Claim path',
    async () => {
  const nowMs = Date.parse('2026-11-23T15:00:00Z');
  const first = source({validUntilMs: nowMs + 60_000});
  const binding = makeProviderPreviewBinding(first, {
    releaseBinding: 'b'.repeat(64), validUntilMs: nowMs + 60_000,
  }, nowMs);
  let claims = 0;
  let changed = {agentCode: 'B2'};
  const actions = new ProviderOnlyActions({config: {},
    graph: {bindAccount() { return {request() {}}; }},
    now: () => nowMs,
    cohortPolicy: {async assertAllowed() {
      return {releaseBinding: binding.releaseBinding};
    }}});
  actions._context = async () => ({graph: {request() {}}, actor: {},
    store: {async createClaim() { claims++; }},
    source: {async resolve() {
      return source({...changed, validUntilMs: nowMs + 60_000});
    }}});
  for (const change of [{agentCode: 'B2'},
    {to: ['new@example.invalid', 'planner@example.invalid']},
    {etagsJson: '{"contact":{"etag":"two"}}'}]) {
    changed = change;
    await assert.rejects(() => actions.providerDraftWithPreview({id: WO,
      binding}), /PROVIDER_SOURCE_CHANGED_SINCE_PREVIEW/);
  }
  assert.equal(claims, 0);
});

test('the post-Claim source wrapper rejects changed ETags and recipients',
    async () => {
  const nowMs = Date.parse('2026-11-23T15:00:00Z');
  const first = source({validUntilMs: nowMs + 60_000});
  const binding = makeProviderPreviewBinding(first, {
    releaseBinding: 'b'.repeat(64), validUntilMs: nowMs + 60_000,
  }, nowMs);
  let releaseReads = 0;
  const wrapped = strictProviderSource({
    async resolve() { return first; },
    async confirmUnchanged() {
      return source({to: ['new@example.invalid', 'planner@example.invalid'],
        etagsJson: '{"contact":{"etag":"two"}}',
        validUntilMs: nowMs + 60_000});
    },
  }, {binding, graph: {request() {}}, cohortPolicy: {
    async assertAllowed() { releaseReads++; },
  }});
  assert.equal((await wrapped.resolve(WO, {})).agentCode, 'A1');
  await assert.rejects(() => wrapped.confirmUnchanged(first, {}),
    /PROVIDER_SOURCE_CHANGED_SINCE_PREVIEW/);
  assert.equal(releaseReads, 3);
});

test('release revocation during a protected source read holds the action',
    async () => {
  const nowMs = Date.parse('2026-11-23T15:00:00Z');
  const first = source({validUntilMs: nowMs + 60_000});
  const binding = makeProviderPreviewBinding(first, {
    releaseBinding: 'b'.repeat(64), validUntilMs: nowMs + 60_000,
  }, nowMs);
  let reads = 0;
  const wrapped = strictProviderSource({
    async resolve() { return first; },
    async confirmUnchanged() { return first; },
  }, {binding, graph: {request() {}}, cohortPolicy: {
    async assertAllowed() {
      reads++;
      if (reads === 2) throw new Error('PROVIDER_COHORT_CHANGED');
    },
  }});
  await assert.rejects(() => wrapped.resolve(WO, {}),
    /PROVIDER_COHORT_CHANGED/);
  assert.equal(reads, 2);
});

test('a changed previewed recipient, agent, digest, or ETag holds', () => {
  const nowMs = Date.parse('2026-11-23T15:00:00Z');
  const first = source({validUntilMs: nowMs + 60_000});
  const binding = makeProviderPreviewBinding(first, {
    releaseBinding: 'b'.repeat(64), validUntilMs: nowMs + 60_000,
  }, nowMs);
  for (const changed of [
    {to: ['new@example.invalid', 'planner@example.invalid']},
    {agentCode: 'B2'}, {digest: 'c'.repeat(64)},
    {etagsJson: '{"wo":{"etag":"two"}}'},
    {workOrderStatus: 'Pending Scheduled Date'},
  ]) {
    assert.throws(() => assertSourceMatchesPreview({...first, ...changed},
      binding), /PROVIDER_SOURCE_CHANGED_SINCE_PREVIEW/);
  }
  assert.equal(assertSourceMatchesPreview(first, binding), first);
});

test('protected List reader joins current native WO and distinct role contacts', async () => {
  const {resolver, actor} = await protectedSource();
  const first = await resolver.resolve(WO, actor);
  assert.equal(first.nativeWoId, WO);
  assert.equal(first.woNumber, '900001');
  assert.equal(first.agentCode, 'A1');
  assert.deepEqual(first.to, ['manager@example.invalid', 'planner@example.invalid']);
  assert.equal((await resolver.confirmUnchanged(first, actor)).digest,
    first.digest);
});

test('no contact, shared email, or held WO never reaches a draft', async () => {
  for (const variant of [
    {noContact: true},
    {contactChange: {PlannerEmail: 'manager@example.invalid'}},
    {contactChange: {Verified: false}},
    {contactChange: {AgentCode: 'B2'}},
    {woChange: {WorkOrderStatus: 'Closed'}},
  ]) {
    const {resolver, actor} = await protectedSource(variant);
    await assert.rejects(() => resolver.resolve(WO, actor));
  }
});

test('a stale saved WO Source row cannot arm the provider preview', async () => {
  const {resolver, actor} = await protectedSource({
    woChange: {SourceObservedAtUtc: '2026-11-19T15:00:00Z'},
  });
  await assert.rejects(() => resolver.resolve(WO, actor),
    /WO_OBSERVATION_STALE/);
});

test('customer draft path remains held even with a direct method call', async () => {
  const actions = new ProviderOnlyActions({config: {},
    graph: {bindAccount() { throw new Error('Graph must not be called'); }}});
  await assert.rejects(() => actions.providerDraft(WO),
    /PROVIDER_PREVIEW_BINDING_REQUIRED/);
  await assert.rejects(() => actions.customerDraft('F:1:1'),
    /CUSTOMER_ACTIONS_NOT_RELEASED/);
  await assert.rejects(() => actions.checkCustomerSent('F:1:1'),
    /CUSTOMER_ACTIONS_NOT_RELEASED/);
});

test('draft text still has all six exact myCoke links and no send scope', async () => {
  const draft = buildProviderDraft(source());
  assert.equal(draft.to.length, 2);
  assert.deepEqual(draft.requiredLinks, PICOS_PARTS.map(part => part.url));
  for (const part of PICOS_PARTS) {
    assert.ok(draft.htmlBody.includes(`href="${part.url}"`));
    assert.ok(draft.htmlBody.includes(`myCoke material ${part.material}`));
  }
  const authText = await readFile(fileURLToPath(
    new URL('../src/auth_config.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(authText, /Mail\.Send/u);
});

test('checked-in site is unbound and drops customer selection markers', async () => {
  const configText = await readFile(fileURLToPath(
    new URL('../site/actions/integration_config.mjs', import.meta.url)),
  'utf8');
  const viewText = await readFile(fileURLToPath(
    new URL('../site/view.mjs', import.meta.url)), 'utf8');
  assert.match(configText, /enabled: false/u);
  assert.match(viewText, /allowedCustomerKeys: \[\]/u);
});
