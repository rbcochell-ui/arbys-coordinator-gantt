import test from 'node:test';
import assert from 'node:assert/strict';
import {PICOS_PARTS as CHART_PARTS} from '../actions/picos_parts.mjs';
import {PICOS_PARTS as INTENT_PARTS, buildProviderIntent,
  buildCustomerIntent} from '../actions/contract.mjs';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const PROVIDER = Object.freeze({
  kind: 'Installation', readyForPartsDraft: true, hold: false,
  nativeWoId: `0WO${'A'.repeat(15)}`, displayWoNumber: '1234567',
  agentCode: 'T01', installManagerEmail: 'manager@example.test',
  plannerEmail: 'planner@example.test', receiptSha256: 'a'.repeat(64),
  verifiedAtUtc: '2026-11-24T11:58:00Z',
  validUntilUtc: '2026-11-24T12:10:00Z',
});
const TRACKER = `https://rbcochell-ui.github.io/arbys-customer-status-preview/?p=p_${'a'.repeat(32)}#k=${'A'.repeat(43)}`;
const CUSTOMER = Object.freeze({
  releaseState: 'Ready', readyForCustomerDraft: true,
  formSourceKey: 'F:123:456', customerEmail: 'contact@example.test',
  customerName: 'Test Contact', trackerUrl: TRACKER,
  receiptSha256: 'b'.repeat(64),
  verifiedAtUtc: '2026-11-24T11:58:00Z',
  validUntilUtc: '2026-11-24T12:10:00Z',
});

test('both draft builders use exactly Ryan’s six reviewed PICOS-to-myCoke mappings', () => {
  const expected = [
    ['125124', '3517264', 'https://www.mycoke.com/product/tubing-fs-16ln-14-38-2-12-re-bndl/01tPY000009IyzqYAC'],
    ['29915', '3510205', 'https://www.mycoke.com/product/chase-4in-x-4in-x-48in-assy-ss/01tPY000009IqcYYAS'],
    ['122795', '3523343', 'https://www.mycoke.com/product/valve-shutoff-12in-barb-gray/01tPY000009J5DJYA0'],
    ['21191', '3524217', 'https://www.mycoke.com/product/valveshut-off-38in-barb/01tPY000009IpEzYAK'],
    ['148791', '3514278', 'https://www.mycoke.com/product/kit-arbys-new-equipment-installati/01tPY000009IQq6YAG'],
    ['148136', '3508899', 'https://www.mycoke.com/product/leverwatersfv1uf1extendedlit/01tPY000009JjlqYAC'],
  ];
  for (const parts of [CHART_PARTS, INTENT_PARTS]) {
    assert.deepEqual(parts.map(({code, material, url}) => [code, material, url]),
      expected);
  }
  const draft = buildProviderIntent(PROVIDER, NOW);
  assert.deepEqual(draft.to, ['manager@example.test', 'planner@example.test']);
  assert.deepEqual(draft.requiredLinks, expected.map(part => part[2]));
  for (const [code, material, url] of expected) {
    assert.match(draft.htmlBody, new RegExp(`${code} [^<]+<\\/a> \\(myCoke material ${material}\\)`));
    assert.ok(draft.htmlBody.includes(`href="${url}"`));
  }
  assert.match(draft.htmlBody, /quantity is two if this visit needs two/);
  assert.match(draft.htmlBody, /Verify the current service date in Thirsty/);
});

test('provider intent requires an eligible installation, explicit unheld state and fresh source', () => {
  for (const change of [{kind: 'Survey'}, {readyForPartsDraft: false},
    {hold: true}, {hold: null}, {hold: undefined}, {hold: '0'}]) {
    assert.throws(() => buildProviderIntent({...PROVIDER, ...change}, NOW),
      {code: 'WO_NOT_READY'});
  }
  assert.throws(() => buildProviderIntent({...PROVIDER,
    verifiedAtUtc: '2026-11-24T11:44:59Z'}, NOW),
  {code: 'SOURCE_WINDOW_EXPIRED'});
});

test('customer intent injects the complete per-project URL and rejects the viewer base', () => {
  const draft = buildCustomerIntent(CUSTOMER, NOW);
  assert.deepEqual(draft.to, ['contact@example.test']);
  assert.deepEqual(draft.requiredLinks, [TRACKER]);
  assert.ok(draft.htmlBody.includes(`href="${TRACKER}"`));
  assert.match(draft.htmlBody, /please reply to this email/);
  for (const trackerUrl of [
    'https://rbcochell-ui.github.io/arbys-customer-status-preview/',
    TRACKER.split('#')[0],
    TRACKER.replace('?p=', '?other='),
  ]) {
    assert.throws(() => buildCustomerIntent({...CUSTOMER, trackerUrl}, NOW),
      {code: 'INVALID_CUSTOMER_TRACKER_URL'});
  }
  assert.throws(() => buildCustomerIntent({...CUSTOMER,
    formSourceKey: 'F:123:457', releaseState: 'Held'}, NOW),
  {code: 'CUSTOMER_RELEASE_NOT_READY'});
});
