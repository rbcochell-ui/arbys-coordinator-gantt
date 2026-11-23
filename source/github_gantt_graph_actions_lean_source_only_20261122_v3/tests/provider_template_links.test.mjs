import assert from 'node:assert/strict';
import test from 'node:test';
import {buildProviderDraft, PICOS_PARTS} from '../contract.mjs';

test('provider draft carries all six clickable myCoke parts in PICOS order', () => {
  const draft = buildProviderDraft({
    woNumber: '900001', agentCode: 'A1',
    to: ['manager@example.invalid', 'planner@example.invalid'],
  });
  assert.deepEqual(PICOS_PARTS.map(part => part.code),
    ['125124', '29915', '122795', '21191', '148791', '148136']);
  assert.equal(new Set(PICOS_PARTS.map(part => part.code)).size, 6);
  assert.equal(new Set(PICOS_PARTS.map(part => part.url)).size, 6);
  for (const part of PICOS_PARTS) {
    assert.equal(new URL(part.url).origin, 'https://www.mycoke.com');
    assert.match(new URL(part.url).pathname, /^\/product\//u);
    assert.match(part.material, /^[0-9]{7}$/u);
  }
  const anchors = [...draft.htmlBody.matchAll(
    /<li><a href="([^"]+)">([^<]+)<\/a> \(myCoke material ([0-9]+)\)<\/li>/gu)];
  assert.equal(anchors.length, 6);
  assert.deepEqual(anchors.map(([, url, label, material]) =>
    ({url, label: label.replaceAll('&#39;', "'"), material})),
  PICOS_PARTS.map(part => ({
    url: part.url, label: `${part.code} ${part.name}`, material: part.material,
  })));
  assert.deepEqual(draft.to,
    ['manager@example.invalid', 'planner@example.invalid']);
  assert.match(draft.htmlBody, /Verify the current service date in Thirsty\./u);
  assert.match(draft.htmlBody, /reply with what you ordered, the order reference, and expected delivery date/u);
});
