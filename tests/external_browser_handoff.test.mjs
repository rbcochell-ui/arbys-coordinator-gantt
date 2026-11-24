import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildExternalBrowserHref, parseExternalBrowserHref,
  restoreAllowlistedSelection} from '../actions/external_browser_handoff.mjs';
import {createFrameSelectionBridge} from '../actions/frame_bridge.mjs';
import {COMPOSE_RELEASE} from '../actions/action_release.mjs';

const KEY = 'A'.repeat(43);
const BASE = `https://rbcochell-ui.github.io/arbys-coordinator-gantt/#k=${KEY}`;
const WO = '0WO' + 'A'.repeat(15);
const OTHER_WO = '0WO' + 'B'.repeat(15);
const FORM = 'F:123:789';
const allowed = {providerIds: [WO], customerKeys: [FORM]};

test('outside-browser handoff keeps the complete key and only native selection', () => {
  const provider = buildExternalBrowserHref(BASE,
    {kind: 'provider', id: WO}, allowed);
  const customer = buildExternalBrowserHref(BASE,
    {kind: 'customer', id: FORM}, allowed);
  for (const [href, selection] of [
    [provider, {kind: 'provider', id: WO}],
    [customer, {kind: 'customer', id: FORM}],
  ]) {
    const parsed = parseExternalBrowserHref(href);
    assert.equal(parsed.capabilityHref, BASE);
    assert.equal(Buffer.from(parsed.key).length, 32);
    assert.deepEqual(parsed.selection, selection);
    assert.deepEqual(restoreAllowlistedSelection(parsed.selection, allowed), selection);
    assert.equal(new URL(href).search, '');
    assert.equal(href.includes('@'), false);
    assert.equal(href.includes('tracker'), false);
    assert.equal(href.includes('mycoke'), false);
    assert.equal(href.includes('recipient'), false);
  }
  assert.equal(buildExternalBrowserHref(provider, null, allowed), BASE);
  assert.equal(parseExternalBrowserHref(BASE).selection, null);
});

test('malformed or data-bearing fragments cannot restore a chart selection', () => {
  const good = buildExternalBrowserHref(BASE, {kind: 'customer', id: FORM}, allowed);
  for (const bad of [
    BASE + `&k=${KEY}`,
    BASE + '&kind=customer',
    BASE + '&kind=customer&id=F%3A123%3Aevil',
    BASE + '&kind=provider&id=' + WO + '&to=private%40example.test',
    BASE.replace('#k=', '#%6B='),
    BASE.replace('rbcochell-ui.github.io', 'attacker.example'),
    BASE.replace('/arbys-coordinator-gantt/', '/other-site/'),
    BASE.replace('#', '?id=' + WO + '#'),
    good.replace('F%3A123%3A789', FORM),
  ]) assert.throws(() => parseExternalBrowserHref(bad));
  assert.throws(() => buildExternalBrowserHref(BASE,
    {kind: 'customer', id: FORM, recipientEmail: 'private@example.test'}, allowed));
  assert.throws(() => buildExternalBrowserHref(BASE,
    {kind: 'provider', id: WO, trackerUrl: 'https://example.test/private'}, allowed));
});

test('forged but well formed ID is not selected or carried forward', () => {
  const forged = `${BASE}&kind=provider&id=${OTHER_WO}`;
  const parsed = parseExternalBrowserHref(forged);
  assert.deepEqual(parsed.selection, {kind: 'provider', id: OTHER_WO});
  assert.equal(restoreAllowlistedSelection(parsed.selection, allowed), null);
  assert.throws(() => buildExternalBrowserHref(BASE,
    parsed.selection, allowed), /allowlisted/);
});

test('restoring an allowlisted ID does not invoke a draft action', () => {
  const listeners = new Map();
  const hostWindow = {addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type)};
  let actions = 0;
  const bridge = createFrameSelectionBridge({hostWindow,
    frame: {contentWindow: {}}, initialSelection: {kind: 'provider', id: WO},
    allowedProviderIds: allowed.providerIds,
    allowedCustomerKeys: allowed.customerKeys,
    actions: {createOrOpenProviderDraft() { actions++; },
      createOrOpenCustomerDraft() { actions++; }}});
  assert.deepEqual(bridge.getSelection(), {kind: 'provider', id: WO});
  assert.equal(actions, 0);
  bridge.dispose();
  const rejected = createFrameSelectionBridge({hostWindow,
    frame: {contentWindow: {}}, initialSelection: {kind: 'provider', id: OTHER_WO},
    allowedProviderIds: allowed.providerIds,
    allowedCustomerKeys: allowed.customerKeys,
    actions: {createOrOpenProviderDraft() { actions++; },
      createOrOpenCustomerDraft() { actions++; }}});
  assert.equal(rejected.getSelection(), null);
  assert.equal(actions, 0);
  rejected.dispose();
  assert.notEqual(COMPOSE_RELEASE.provider, 'enabled');
  assert.notEqual(COMPOSE_RELEASE.customer, 'enabled');
  const runtime = readFileSync(new URL('../view.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /initialSelection: restoredSelection/);
  assert.doesNotMatch(runtime, /requestLocalHandoff\([^\n]*restoredSelection/);
});
