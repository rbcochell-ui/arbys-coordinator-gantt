import assert from 'node:assert/strict';
import test from 'node:test';
import {CORRELATION_HEADER} from '../contract.mjs';
import {GraphClient} from '../graph.mjs';

const CORRELATION = '33333333-3333-4333-8333-333333333333';
const SINCE = '2026-11-23T09:00:00.000Z';
const LOOKBACK = '2026-11-23T08:55:00.000Z';
const SENT_AT = '2026-11-23T10:00:00.000Z';
const candidate = (id, value = CORRELATION, sentDateTime = SENT_AT) => ({
  id, sentDateTime,
  internetMessageHeaders: [{name: CORRELATION_HEADER, value}],
});

function harness(pages) {
  const paths = [];
  const client = new GraphClient({
    tokenProvider: {async acquireToken() { return 'synthetic-token-for-tests'; }},
    fetchImpl() { throw new Error('network forbidden'); },
  });
  client.request = async (path, options) => {
    paths.push(path);
    assert.deepEqual(options.scopes, ['Mail.ReadWrite']);
    assert.equal(options.headers.Prefer, 'IdType="ImmutableId"');
    return {status: 200, data: pages.shift()};
  };
  return {client, paths};
}

test('bounded owner Sent scan finds one exact custom header through pagination', async () => {
  const first = {value: [candidate('unrelated-item', 'other')]};
  const h = harness([first, {value: [candidate('sent-copy-item',
    CORRELATION, '2026-11-23T08:58:00.000Z')]}]);
  const path = new URL('/v1.0/me/mailFolders/sentitems/messages',
    'https://graph.microsoft.com');
  path.search = new URLSearchParams({
    '$select': 'id,internetMessageHeaders,sentDateTime',
    '$filter': 'sentDateTime ge ' + LOOKBACK,
    '$orderby': 'sentDateTime desc', '$top': '25',
    '$skiptoken': 'second-page',
  }).toString();
  first['@odata.nextLink'] = path.href;
  assert.equal(await h.client.findSentByCorrelation(CORRELATION, SINCE),
    'sent-copy-item');
  assert.equal(h.paths.length, 2);
  assert.equal(new URL(h.paths[0], 'https://graph.microsoft.com')
    .searchParams.get('$filter'), 'sentDateTime ge ' + LOOKBACK);
  assert.ok(h.paths.every(value =>
    value.startsWith('/v1.0/me/mailFolders/sentitems/messages?')));
});

test('duplicate correlation headers cannot be taken as one Sent receipt', async () => {
  const h = harness([{value: [candidate('sent-copy-one'),
    candidate('sent-copy-two')]}]);
  await assert.rejects(
    h.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_AMBIGUOUS'});
});

test('five-minute lookback crosses a UTC day boundary exactly', async () => {
  const h = harness([{value: []}]);
  assert.equal(await h.client.findSentByCorrelation(CORRELATION,
    '2026-11-23T00:02:00.000Z'), null);
  const query = new URL(h.paths[0], 'https://graph.microsoft.com').searchParams;
  assert.equal(query.get('$filter'),
    'sentDateTime ge 2026-11-22T23:57:00.000Z');
  assert.equal(query.get('$orderby'), 'sentDateTime desc');
});

test('five-minute boundary is inclusive, and an older returned item is rejected', async () => {
  const onBoundary = harness([{value: [candidate('sent-boundary-item',
    CORRELATION, LOOKBACK)]}]);
  assert.equal(await onBoundary.client.findSentByCorrelation(CORRELATION,
    SINCE), 'sent-boundary-item');

  const beforeBoundary = harness([{value: [candidate('sent-too-early-item',
    CORRELATION, '2026-11-23T08:54:59.999Z')]}]);
  await assert.rejects(
    beforeBoundary.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_INCOMPLETE'});
});

test('partial or redirected scans stay unverified', async () => {
  const h = harness([{value: [candidate('sent-copy-one')],
    '@odata.nextLink': 'https://example.invalid/steal'}]);
  await assert.rejects(
    h.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_INCOMPLETE'});
  assert.equal(h.paths.length, 1);
});

test('missing headers stay unverified rather than looking like no match', async () => {
  const h = harness([{value: [{id: 'sent-copy-one', sentDateTime: SENT_AT}]}]);
  await assert.rejects(
    h.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_INCOMPLETE'});
});
