import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createSelectedCustomerPort, prepareCustomerPort,
  validateCustomerBinding} from '../customer_port.mjs';
import {prepareCustomerOnlyParentRuntime} from
  '../customer_parent_runtime.mjs';
import {HELD_CUSTOMER_BINDING} from '../held_config.mjs';
import {assertCurrentCustomerCsp, assertCustomerActiveCsp} from
  '../customer_csp.mjs';

const FORM = 'F:123:456';
const OTHER = 'F:123:457';
const SITE_ID = 'groups.coca-cola.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const COORDINATOR = '44444444-4444-4444-8444-444444444444';
const RELEASE = '55555555-5555-4555-8555-555555555555';
const CLAIMS = '66666666-6666-4666-8666-666666666666';
const RECEIPTS = '77777777-7777-4777-8777-777777777777';
const INVENTORY = '88888888-8888-4888-8888-888888888888';
const SHARED = Object.freeze({claims: CLAIMS, receipts: RECEIPTS});
const HELD_CSP = "default-src 'none'; connect-src 'self'; frame-src 'self' about:";
const ACTIVE_CSP = "default-src 'none'; connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com; frame-src 'self' https://login.microsoftonline.com";

function withPageCsp(content, fn) {
  const prior = globalThis.document;
  globalThis.document = {querySelector(selector) {
    assert.equal(selector,
      'meta[http-equiv="Content-Security-Policy"]');
    return {getAttribute(name) {
      assert.equal(name, 'content');
      return content;
    }};
  }};
  try { return fn(); }
  finally {
    if (prior === undefined) delete globalThis.document;
    else globalThis.document = prior;
  }
}

function inventedBinding() {
  const binding = structuredClone(HELD_CUSTOMER_BINDING);
  binding.enabled = true;
  Object.assign(binding.lean, {
    enabled: true, providerEnabled: false, customerEnabled: true,
    occupiedPilotClaimsMigrated: true,
    tenantId: '99999999-9999-4999-8999-999999999999',
    clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', siteId: SITE_ID,
    coordinatorOids: [COORDINATOR], releaseOwnerOids: [OWNER],
    approvedCustomerReleaseKinds: ['InventedPublishedReceipt/v1'],
    lists: {customerReleases: RELEASE, claims: CLAIMS,
      receipts: RECEIPTS},
  });
  binding.legacyInventory = {
    siteId: SITE_ID,
    siteUrl: 'https://groups.coca-cola.com/sites/ArbysOperations',
    releaseListId: INVENTORY,
    releaseItemId: '1',
    releaseListTitle: 'Arbys Coordinator Gantt Releases',
    releaseKey: 'arbys-coordinator-gantt:provider-snapshot',
    ownerOids: [OWNER],
    expectedSources: [
      {listId: RELEASE, title: 'Arbys Customer Draft Releases'},
      {listId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'Invented Provider Pilot'},
      {listId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'Invented Historical Intent'},
    ],
    expectedPilotLists: {
      provider: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      customer: RELEASE,
    },
    expectedWriterIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    signingPublicJwk: {kty: 'EC', crv: 'P-256',
      x: 'A'.repeat(43), y: 'B'.repeat(43)},
  };
  return binding;
}

function fixture() {
  let selection = {kind: 'customer', id: FORM};
  const calls = [];
  const actions = {
    async preview(kind, id) { calls.push(['preview', kind, id]);
      return {kind, id, status: 'eligible', to: ['person@example.invalid']}; },
    async customerDraft(id) { calls.push(['draft', id]);
      return {status: 'draft', webLink:
        'https://outlook.office.com/mail/drafts/invented'}; },
    async checkCustomerSent(id) { calls.push(['sent', id]);
      return {status: 'not_started'}; },
  };
  const port = createSelectedCustomerPort({actions,
    selectionPort: {getSelection: () => selection},
    allowedCustomerKeys: [FORM, OTHER]});
  return {port, calls, select: value => { selection = value; }};
}

test('checked-in binding is inert before any Graph or sign-in operation', () => {
  let touched = false;
  const port = prepareCustomerPort({binding: HELD_CUSTOMER_BINDING,
    graph: {bindAccount() { touched = true; }}});
  assert.equal(port.enabled, false);
  assert.equal(HELD_CUSTOMER_BINDING.lean.lists.claims, null);
  assert.equal(HELD_CUSTOMER_BINDING.legacyInventory, null);
  assert.throws(() => port.customerDraft(FORM),
    {code: 'CUSTOMER_PORT_DISABLED'});
  assert.equal(touched, false);
  const runtime = prepareCustomerOnlyParentRuntime({
    binding: HELD_CUSTOMER_BINDING,
    graph: {bindAccount() { touched = true; }},
    signInFromClick() { touched = true; },
  });
  assert.equal(runtime.enabled, false);
  assert.equal(touched, false);
});

test('invented customer binding is independent of provider activation', () => {
  const binding = inventedBinding();
  assert.equal(validateCustomerBinding(binding, SHARED), binding);
  let touched = false;
  const port = withPageCsp(ACTIVE_CSP, () => prepareCustomerPort({binding,
    sharedStoreLists: SHARED,
    graph: {bindAccount() { touched = true;
      throw new Error('Graph was touched'); }},
    selectionPort: {getSelection: () => ({kind: 'customer', id: FORM})},
    allowedCustomerKeys: [FORM]}));
  assert.equal(port.enabled, true);
  assert.equal(touched, false);
  assert.equal(typeof port.customerDraft, 'function');
  assert.equal(Object.hasOwn(port, 'providerDraft'), false);
});

test('historical pilot and current Release must be the same List', () => {
  const binding = inventedBinding();
  binding.legacyInventory.expectedPilotLists.customer =
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  assert.throws(() => validateCustomerBinding(binding, SHARED),
    {code: 'CUSTOMER_SHARED_BINDING_MISMATCH'});
});

test('customer and provider routes must share physical Claim and Receipt Lists', () => {
  const binding = inventedBinding();
  assert.throws(() => validateCustomerBinding(binding, null),
    {code: 'CUSTOMER_SHARED_BINDING_MISMATCH'});
  assert.throws(() => validateCustomerBinding(binding, {
    claims: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', receipts: RECEIPTS,
  }), {code: 'CUSTOMER_SHARED_BINDING_MISMATCH'});
  assert.throws(() => validateCustomerBinding(binding, {
    claims: CLAIMS, receipts: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  }), {code: 'CUSTOMER_SHARED_BINDING_MISMATCH'});
});

test('customer parent runtime works without enabling provider flow', async () => {
  const binding = inventedBinding();
  let signIns = 0;
  let graphCalls = 0;
  const runtime = withPageCsp(ACTIVE_CSP, () =>
    prepareCustomerOnlyParentRuntime({binding,
    sharedStoreLists: SHARED,
    graph: {bindAccount() { graphCalls++;
      throw new Error('No Graph call expected'); }},
    selectionPort: {getSelection: () => ({kind: 'customer', id: FORM})},
    allowedCustomerKeys: [FORM],
    signInFromClick() { signIns++; },
  }));
  assert.equal(runtime.enabled, true);
  assert.equal(signIns, 0);
  assert.equal(graphCalls, 0);
  await runtime.signInFromClick();
  assert.equal(signIns, 1);
  await assert.rejects(runtime.preview('provider',
    '0WOaaaaaaaaaaaaAAA'), {code: 'PROVIDER_ROUTE_HELD'});
  await assert.rejects(runtime.createOrOpenProviderDraft(
    '0WOaaaaaaaaaaaaAAA'), {code: 'PROVIDER_ROUTE_HELD'});
  assert.equal(graphCalls, 0);
});

test('active customer runtime reads the page and rejects self-only CSP', () => {
  assert.throws(() => assertCustomerActiveCsp(HELD_CSP),
    {code: 'CUSTOMER_CSP_BLOCKS_GRAPH_AUTH'});
  assert.equal(assertCustomerActiveCsp(ACTIVE_CSP), true);
  const binding = inventedBinding();
  let touched = false;
  assert.throws(() => withPageCsp(HELD_CSP, () => prepareCustomerPort({binding,
    sharedStoreLists: SHARED, cspContent: ACTIVE_CSP,
    graph: {bindAccount() { touched = true; }},
    selectionPort: {getSelection: () => ({kind: 'customer', id: FORM})},
    allowedCustomerKeys: [FORM]})),
  {code: 'CUSTOMER_CSP_BLOCKS_GRAPH_AUTH'});
  assert.throws(() => assertCurrentCustomerCsp(),
    {code: 'CUSTOMER_CSP_BLOCKS_GRAPH_AUTH'});
  assert.equal(touched, false);
});

test('exact selected FORM key gates preview, draft, and Sent check', async () => {
  const f = fixture();
  assert.equal((await f.port.preview('customer', FORM)).status, 'eligible');
  assert.equal((await f.port.customerDraft(FORM)).status, 'draft');
  assert.equal((await f.port.checkCustomerSent(FORM)).status, 'not_started');
  assert.deepEqual(f.calls, [['preview', 'customer', FORM],
    ['draft', FORM], ['sent', FORM]]);
  f.select({kind: 'provider', id: FORM});
  await assert.rejects(f.port.customerDraft(FORM),
    {code: 'CUSTOMER_SELECTION_NOT_CURRENT'});
  f.select({kind: 'customer', id: 'F:123:999'});
  await assert.rejects(f.port.customerDraft('F:123:999'),
    {code: 'CUSTOMER_SELECTION_NOT_CURRENT'});
  await assert.rejects(f.port.preview('provider', FORM),
    {code: 'CUSTOMER_ACTION_KIND_INVALID'});
  assert.equal(f.calls.length, 3);
});

test('a changed selection cannot display a stale recipient preview', async () => {
  let selection = {kind: 'customer', id: FORM};
  const port = createSelectedCustomerPort({
    actions: {async preview() {
      selection = {kind: 'customer', id: OTHER};
      return {status: 'eligible', to: ['person@example.invalid']};
    }, async customerDraft() {}, async checkCustomerSent() {}},
    selectionPort: {getSelection: () => selection},
    allowedCustomerKeys: [FORM, OTHER],
  });
  await assert.rejects(port.preview('customer', FORM),
    {code: 'CUSTOMER_SELECTION_NOT_CURRENT'});
});

test('customer capability cannot appear in the action result', async () => {
  const f = fixture();
  const port = createSelectedCustomerPort({
    actions: {async preview() { return {kind: 'customer', id: FORM,
      status: 'eligible', tracker: '?p=p_invented#k=invented'}; },
    async customerDraft() { return {status: 'draft',
      tracker: '?p=p_invented#k=invented'}; },
    async checkCustomerSent() { return {status: 'sent'}; }},
    selectionPort: {getSelection: () => ({kind: 'customer', id: FORM})},
    allowedCustomerKeys: [FORM],
  });
  await assert.rejects(port.preview('customer', FORM),
    {code: 'CUSTOMER_CAPABILITY_IN_ACTION_RESULT'});
  await assert.rejects(port.customerDraft(FORM),
    {code: 'CUSTOMER_CAPABILITY_IN_ACTION_RESULT'});
  assert.equal(f.calls.length, 0);
});

test('source-only port has no Send action, live IDs, or customer capability', () => {
  const source = ['../customer_port.mjs', '../customer_parent_runtime.mjs',
    '../customer_csp.mjs',
    '../held_config.mjs']
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /Mail\.Send|sendMail|\/send\b/);
  assert.doesNotMatch(source, /\?p=p_[0-9a-f]{32}|#k=[A-Za-z0-9_-]{43}/);
  assert.equal(HELD_CUSTOMER_BINDING.enabled, false);
});
