import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLocalSentUri, parseLocalSentUri, requestLocalHandoff,
  ADOPTION_REQUIRED_CUSTOMER_DIGEST}
  from '../actions/local_helper_uri.mjs';
import {COMPOSE_RELEASE, digestSelection} from '../actions/action_release.mjs';

const selected = {kind: 'customer', id: 'F:123:788'};
const allowed = {providerIds: [], customerKeys: [selected.id]};
const newSelection = {kind: 'customer', id: 'F:123:789'};
const newAllowed = {providerIds: [], customerKeys: [newSelection.id]};
const chartKey = Uint8Array.from({length: 32}, (_, index) => index);
const selectedDigest = await digestSelection(selected, chartKey);
const newDigest = await digestSelection(newSelection, chartKey);

test('Check Sent URI contains only the exact FORM key', () => {
  const uri = buildLocalSentUri(selected);
  assert.equal(uri,
    'arbysgantt://sent/v1?kind=customer&id=F%3A123%3A788');
  assert.deepEqual(parseLocalSentUri(uri), selected);
  for (const changed of [uri + '&to=person%40example.test',
    uri.replace('sent/v1', 'draft/v1'),
    uri.replace('F%3A', 'F:'), uri + '#private']) {
    assert.throws(() => parseLocalSentUri(changed));
  }
});

test('Check Sent remains disabled until the separate receipt release', () => {
  assert.notEqual(COMPOSE_RELEASE.sent, 'enabled');
  let launches = 0;
  const base = {event: {type: 'click', isTrusted: true}, kind: 'customer',
    action: 'sent', release: COMPOSE_RELEASE.sent, disabled: true,
    selection: selected, selectionDigest: selectedDigest, allowed, topLevel: true,
    navigate: () => { launches++; }};
  assert.equal(requestLocalHandoff(base), 'ignored');
  assert.equal(launches, 0);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="sentCheck"[^>]*disabled/);
});

test('an adoption-required pilot cannot launch Check Sent even if enabled', () => {
  let launches = 0;
  assert.equal(requestLocalHandoff({
    event: {type: 'click', isTrusted: true}, kind: 'customer',
    action: 'sent', release: 'enabled', disabled: false,
    selection: selected, selectionDigest: ADOPTION_REQUIRED_CUSTOMER_DIGEST,
    allowed, topLevel: true,
    navigate: () => { launches++; },
  }), 'ignored');
  assert.equal(launches, 0);
});

test('an admitted new-key selection can use a separately enabled read-only Sent route',
  () => {
    const launches = [];
    assert.equal(requestLocalHandoff({
      event: {type: 'click', isTrusted: true}, kind: 'customer',
      action: 'sent', release: 'enabled', disabled: false,
      selection: newSelection, selectionDigest: newDigest,
      allowed: newAllowed, topLevel: true,
      navigate: uri => launches.push(uri),
    }), 'requested');
    assert.deepEqual(launches, [buildLocalSentUri(newSelection)]);
  });
