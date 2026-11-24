import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actionUiState} from '../actions/action_ui_policy.mjs';
import {COMPOSE_RELEASE, digestSelection, releaseForSelection} from
  '../actions/action_release.mjs';
import {buildLocalSentUri, localHandoffEnabled, requestLocalHandoff,
  ADOPTION_REQUIRED_CUSTOMER_DIGEST} from
  '../actions/local_helper_uri.mjs';

const provider = {kind: 'provider', id: `0WO${'A'.repeat(15)}`};
const pilot = {kind: 'customer', id: 'F:123:788'};
const newCustomer = {kind: 'customer', id: 'F:123:789'};
const chartKey = Uint8Array.from({length: 32}, (_, index) => index);
const providerDigest = await digestSelection(provider, chartKey);
const customerDigest = await digestSelection(newCustomer, chartKey);
const allowed = {providerIds: [provider.id],
  customerKeys: [pilot.id, newCustomer.id]};
const state = (selection, action = 'draft', options = {}) => actionUiState({
  action, selection, allowed, release: 'enabled',
  selectionDigest: selection?.kind === 'provider' ? providerDigest :
    selection?.id === newCustomer.id ? customerDigest : null,
  ...options,
});

test('selection digests are chart-keyed, stable, and distinct', async () => {
  assert.equal(await digestSelection(provider, chartKey), providerDigest);
  assert.equal(await digestSelection(newCustomer, chartKey), customerDigest);
  assert.notEqual(providerDigest, customerDigest);
  assert.notEqual(await digestSelection({kind: 'customer', id: 'F:123:790'}, chartKey),
    customerDigest);
  assert.notEqual(await digestSelection(newCustomer,
    Uint8Array.from({length: 32}, (_, index) => index + 1)), customerDigest);
  await assert.rejects(digestSelection(newCustomer), /Invalid selection/);
  assert.match(customerDigest, /^[0-9a-f]{64}$/u);
  assert.equal(customerDigest.includes(newCustomer.id), false);
});

test('provider stays held while its digest is absent from public release', () => {
  for (const action of ['draft', 'sent']) {
    assert.deepEqual(state(provider, action),
      {enabled: false, code: action === 'draft'
        ? 'provider_first_draft_held' : 'provider_sent_held'});
    assert.equal(localHandoffEnabled('provider', provider, allowed,
      'enabled', action, providerDigest), false);
    let launches = 0;
    assert.equal(requestLocalHandoff({event: {type: 'click', isTrusted: true},
      action, kind: 'provider', release: 'enabled', disabled: false,
      selection: provider, selectionDigest: providerDigest, allowed,
      topLevel: true, navigate: () => { launches++; }}), 'ignored');
    assert.equal(launches, 0);
  }
});

test('an occupied provider draft can get a receipt-only route', () => {
  const receiptOnly = {...COMPOSE_RELEASE, sent: 'enabled',
    providerSentDigests: [providerDigest], providerDraftDigests: []};
  assert.equal(releaseForSelection('draft', provider, providerDigest,
    receiptOnly), 'held');
  assert.equal(releaseForSelection('sent', provider, providerDigest,
    receiptOnly), 'enabled');
  assert.deepEqual(state(provider, 'draft', {releaseConfig: receiptOnly}),
    {enabled: false, code: 'provider_first_draft_held'});
  assert.deepEqual(state(provider, 'sent', {releaseConfig: receiptOnly}),
    {enabled: true, code: 'sent_candidate_only'});
  const launches = [];
  assert.equal(requestLocalHandoff({event: {type: 'click', isTrusted: true},
    action: 'draft', kind: 'provider', release: 'enabled', disabled: false,
    selection: provider, selectionDigest: providerDigest,
    releaseConfig: receiptOnly, allowed, topLevel: true,
    navigate: uri => launches.push(uri)}), 'ignored');
  assert.equal(requestLocalHandoff({event: {type: 'click', isTrusted: true},
    action: 'sent', kind: 'provider', release: 'enabled', disabled: false,
    selection: provider, selectionDigest: providerDigest,
    releaseConfig: receiptOnly, allowed, topLevel: true,
    navigate: uri => launches.push(uri)}), 'requested');
  assert.deepEqual(launches, [buildLocalSentUri(provider)]);
});

test('a release flag alone enables no key; one exact digest can be staged', () => {
  const staged = {...COMPOSE_RELEASE, provider: 'enabled',
    customer: 'enabled', sent: 'enabled',
    providerDraftDigests: [providerDigest],
    customerDraftDigests: [customerDigest],
    providerSentDigests: [], customerSentDigests: [customerDigest]};
  assert.equal(releaseForSelection('draft', provider, providerDigest), 'held');
  assert.equal(releaseForSelection('draft', provider, providerDigest,
    {...staged, providerDraftDigests: []}), 'held');
  assert.equal(releaseForSelection('draft', provider, providerDigest, staged),
    'enabled');
  assert.equal(releaseForSelection('draft', newCustomer, customerDigest, staged),
    'enabled');
  assert.equal(releaseForSelection('draft', pilot,
    ADOPTION_REQUIRED_CUSTOMER_DIGEST, staged), 'held');
  assert.equal(releaseForSelection('sent', provider, providerDigest, staged),
    'held');
  assert.equal(releaseForSelection('sent', newCustomer, customerDigest, staged),
    'enabled');
  assert.equal(releaseForSelection('draft', newCustomer, providerDigest, staged),
    'held');
  assert.equal(releaseForSelection('send', newCustomer, customerDigest, staged),
    'held');
  assert.equal(releaseForSelection('draft', newCustomer, null, staged), 'held');
  assert.deepEqual(state(provider, 'draft', {releaseConfig: staged}),
    {enabled: true, code: 'draft_request_only'});
  assert.deepEqual(state(newCustomer, 'draft', {releaseConfig: staged}),
    {enabled: true, code: 'draft_request_only'});
});

test('legacy customer digest holds reopen and Sent until verified adoption', () => {
  for (const action of ['draft', 'sent']) {
    assert.deepEqual(state(pilot, action,
      {selectionDigest: ADOPTION_REQUIRED_CUSTOMER_DIGEST}),
      {enabled: false, code: 'adoption_required'});
    assert.equal(localHandoffEnabled('customer', pilot, allowed,
      'enabled', action, ADOPTION_REQUIRED_CUSTOMER_DIGEST), false);
  }
});

test('new customer action needs exact digest, browser context and first-attempt state', () => {
  assert.deepEqual(state(newCustomer, 'draft', {release: 'held'}),
    {enabled: false, code: 'release_held'});
  assert.deepEqual(state(newCustomer, 'draft', {embedded: true}),
    {enabled: false, code: 'embedded'});
  assert.deepEqual(state(newCustomer, 'draft', {attempted: true}),
    {enabled: false, code: 'inspect_only'});
  assert.deepEqual(state(newCustomer, 'draft'),
    {enabled: true, code: 'draft_request_only'});
  assert.deepEqual(state(newCustomer, 'sent'),
    {enabled: true, code: 'sent_candidate_only'});
  assert.deepEqual(state(newCustomer, 'draft', {selectionDigest: null}),
    {enabled: false, code: 'identity_unverified'});
  assert.deepEqual(state({kind: 'customer', id: 'F:123:999'}),
    {enabled: false, code: 'identity_unverified'});
  assert.deepEqual(state(null), {enabled: false, code: 'no_selection'});
  assert.throws(() => state(newCustomer, 'send'), /Invalid action/);
});

test('active viewer labels Outlook identity unverified and Sent unavailable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../view_clipboard.mjs', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../actions/action_release.mjs',
    import.meta.url), 'utf8');
  const local = readFileSync(new URL('../actions/local_helper_uri.mjs',
    import.meta.url), 'utf8');
  assert.match(html, /This page does not verify your Outlook account/);
  assert.match(html, /complete private Gantt link/);
  assert.match(html, /Check Sent is unavailable/);
  assert.match(view, /sentCheck\.disabled = true/);
  assert.match(view, /Outlook opening requested with To and subject only/);
  assert.match(view, /writeClipboardPayload/);
  assert.doesNotMatch(view, /(?:sendMail|markComplete)\s*\(/i);
  assert.doesNotMatch(release + local, /F:[0-9]+:[0-9]+|0WO[A-Za-z0-9]{15}/);
  assert.equal(COMPOSE_RELEASE.providerDraftDigests.length, 0);
  assert.equal(COMPOSE_RELEASE.customerDraftDigests.length, 0);
});
