import assert from 'node:assert/strict';
import test from 'node:test';
import {CORRELATION_HEADER} from '../contract.mjs';
import {GraphClient} from '../graph.mjs';

const CORRELATION = '33333333-3333-4333-8333-333333333333';
const SINCE = '2026-11-23T09:00:00.000Z';
const LOOKBACK = '2026-11-23T08:55:00.000Z';
const SENT_AT = '2026-11-23T10:00:00.000Z';
const candidate = (id, sentDateTime = SENT_AT) => ({id, sentDateTime});
const headers = value => [{name: CORRELATION_HEADER, value}];

function harness(pages, headersById = {}) {
  const paths = [];
  const client = new GraphClient({
    tokenProvider: {async acquireToken() { return 'synthetic-token-for-tests'; }},
    fetchImpl() { throw new Error('network forbidden'); },
  });
  client.request = async (path, options) => {
    paths.push(path);
    assert.deepEqual(options.scopes, ['Mail.ReadWrite']);
    assert.equal(options.headers.Prefer, 'IdType="ImmutableId"');
    const url = new URL(path, 'https://graph.microsoft.com');
    if (url.pathname === '/v1.0/me/mailFolders/sentitems/messages') {
      return {status: 200, data: pages.shift()};
    }
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    assert.equal(url.searchParams.get('$select'), 'id,internetMessageHeaders');
    return {status: 200, data: {id, internetMessageHeaders: headersById[id]}};
  };
  return {client, paths};
}

test('bounded owner Sent scan finds one exact custom header through pagination', async () => {
  const first = {value: [candidate('unrelated-item')]};
  const h = harness([first, {value: [candidate('sent-copy-item',
    '2026-11-23T08:58:00.000Z')]}], {
    'unrelated-item': headers('other'),
    'sent-copy-item': headers(CORRELATION),
  });
  const path = new URL('/v1.0/me/mailFolders/sentitems/messages',
    'https://graph.microsoft.com');
  path.search = new URLSearchParams({
    '$select': 'id,sentDateTime',
    '$filter': 'sentDateTime ge ' + LOOKBACK,
    '$orderby': 'sentDateTime desc', '$top': '25',
    '$skiptoken': 'second-page',
  }).toString();
  first['@odata.nextLink'] = path.href;
  assert.equal(await h.client.findSentByCorrelation(CORRELATION, SINCE),
    'sent-copy-item');
  assert.equal(h.paths.length, 4);
  assert.equal(new URL(h.paths[0], 'https://graph.microsoft.com')
    .searchParams.get('$filter'), 'sentDateTime ge ' + LOOKBACK);
  assert.equal(new URL(h.paths[0], 'https://graph.microsoft.com')
    .searchParams.get('$select'), 'id,sentDateTime');
  assert.equal(h.paths.filter(value => value.startsWith(
    '/v1.0/me/mailFolders/sentitems/messages?')).length, 2);
  assert.equal(h.paths.filter(value => value.startsWith(
    '/v1.0/me/messages/')).length, 2);
});

test('duplicate correlation headers cannot be taken as one Sent receipt', async () => {
  const h = harness([{value: [candidate('sent-copy-one'),
    candidate('sent-copy-two')]}], {
    'sent-copy-one': headers(CORRELATION),
    'sent-copy-two': headers(CORRELATION),
  });
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
    LOOKBACK)]}], {'sent-boundary-item': headers(CORRELATION)});
  assert.equal(await onBoundary.client.findSentByCorrelation(CORRELATION,
    SINCE), 'sent-boundary-item');

  const beforeBoundary = harness([{value: [candidate('sent-too-early-item',
    '2026-11-23T08:54:59.999Z')]}]);
  await assert.rejects(
    beforeBoundary.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_INCOMPLETE'});
});

test('partial or redirected scans stay unverified', async () => {
  const h = harness([{value: [candidate('sent-copy-one')],
    '@odata.nextLink': 'https://example.invalid/steal'}], {
    'sent-copy-one': headers(CORRELATION),
  });
  await assert.rejects(
    h.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_INCOMPLETE'});
  assert.equal(h.paths.length, 2);
});

test('missing Get message headers stay unverified rather than looking like no match', async () => {
  const h = harness([{value: [{id: 'sent-copy-one', sentDateTime: SENT_AT}]}]);
  await assert.rejects(
    h.client.findSentByCorrelation(CORRELATION, SINCE),
    {code: 'SENT_SCAN_INCOMPLETE'});
});

test('a complete individual-header read with no correlation is not a Sent match', async () => {
  const h = harness([{value: [candidate('unrelated-item')]}], {
    'unrelated-item': headers('other'),
  });
  assert.equal(await h.client.findSentByCorrelation(CORRELATION, SINCE), null);
});
