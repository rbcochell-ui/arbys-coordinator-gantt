import assert from 'node:assert/strict';
import test from 'node:test';
import {CORRELATION_HEADER} from '../contract.mjs';
import {GraphClient} from '../graph.mjs';

const CORRELATION = '33333333-3333-4333-8333-333333333333';
const SINCE = '2026-11-23T09:00:00.000Z';
const SENT_AT = '2026-11-23T10:00:00.000Z';
const candidate = (id, value = CORRELATION) => ({
  id, sentDateTime: SENT_AT,
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
  const h = harness([first, {value: [candidate('sent-copy-item')]}]);
  const path = new URL('/v1.0/me/mailFolders/sentitems/messages',
    'https://graph.microsoft.com');
  path.search = new URLSearchParams({
    '$select': 'id,internetMessageHeaders,sentDateTime',
    '$filter': 'sentDateTime ge ' + SINCE,
    '$orderby': 'sentDateTime desc', '$top': '25',
    '$skiptoken': 'second-page',
  }).toString();
  first['@odata.nextLink'] = path.href;
  assert.equal(await h.client.findSentByCorrelation(CORRELATION, SINCE),
    'sent-copy-item');
  assert.equal(h.paths.length, 2);
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
