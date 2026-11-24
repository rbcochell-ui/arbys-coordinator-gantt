import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalOutlookHeader, OutlookHeaderError} from
  '../actions/canonical_outlook_header.mjs';
import {clipboardPayload, ClipboardPayloadError} from
  '../actions/clipboard_payload.mjs';
import {writeClipboardPayload, ClipboardWriteError} from
  '../actions/clipboard_writer.mjs';
import {PICOS_PARTS} from '../actions/parts.mjs';

const providerBody = ['Hello,', '', '<invented recipient> & team', '',
  ...PICOS_PARTS.map(part => part.url), '', 'Please confirm.']
  .join('\r\n');

test('Outlook header carries recipients and subject, never the body', () => {
  const subject = 'TEST: provider parts review';
  const output = canonicalOutlookHeader({
    to: ['manager@example.test', 'planner@example.test'],
    subject, body: providerBody,
  });
  const url = new URL(output.url);
  assert.equal(url.origin, 'https://outlook.cloud.microsoft');
  assert.equal(url.pathname, '/mail/deeplink/compose');
  assert.deepEqual([...url.searchParams.keys()], ['to', 'subject']);
  assert.equal(url.searchParams.get('to'),
    'manager@example.test;planner@example.test');
  assert.equal(url.searchParams.get('subject'), subject);
  assert.equal(url.searchParams.get('body'), null);
  assert.equal(output.body, providerBody);
});

test('header rejects duplicate recipients and URL or header injection', () => {
  const valid = {to: ['manager@example.test'],
    subject: 'TEST: provider parts review', body: providerBody};
  for (const bad of [
    {...valid, to: []},
    {...valid, to: ['manager@example.test', 'MANAGER@example.test']},
    {...valid, to: ['manager@example.test?bcc=x@example.test']},
    {...valid, subject: 'TEST\nBcc: x'},
    {...valid, body: ''},
  ]) {
    assert.throws(() => canonicalOutlookHeader(bad),
      error => error instanceof OutlookHeaderError &&
        error.code === 'COMPOSE_HEADER_INVALID');
  }
});

test('provider clipboard holds six clickable escaped parts links', () => {
  const payload = clipboardPayload({kind: 'provider', body: providerBody});
  assert.equal(payload.plainText, providerBody);
  assert.equal(payload.linkCount, 6);
  assert.equal((payload.html.match(/<a href=/gu) ?? []).length, 6);
  assert.ok(payload.html.includes('&lt;invented recipient&gt; &amp; team'));
  assert.ok(!payload.html.includes('<invented recipient>'));
  for (const part of PICOS_PARTS) {
    assert.ok(payload.html.includes(`href="${part.url}"`));
  }
});

test('customer clipboard links only its exact selected tracker URL', () => {
  const link = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
    '?p=p_' + 'a'.repeat(32) + '#k=' + 'B'.repeat(43);
  const payload = clipboardPayload({kind: 'customer', trackerUrl: link,
    body: `Hi <Invented>,\r\n\r\n${link}\r\n`});
  assert.equal(payload.linkCount, 1);
  assert.equal((payload.html.match(/<a href=/gu) ?? []).length, 1);
  assert.ok(payload.html.includes('Hi &lt;Invented&gt;'));
  assert.ok(payload.html.includes(`href="${link}"`));
  assert.throws(() => clipboardPayload({kind: 'customer', trackerUrl: link,
    body: 'Hi, missing the bound URL'}),
  error => error instanceof ClipboardPayloadError &&
    error.code === 'CLIPBOARD_LINKS_MISSING');
});

test('rich clipboard write starts inside the click stack', async () => {
  const payload = clipboardPayload({kind: 'provider', body: providerBody});
  const calls = [];
  class Item { constructor(entries) { this.entries = entries; } }
  const clipboard = {write(items) { calls.push(items);
    return Promise.resolve(); }};
  const request = writeClipboardPayload(payload, clipboard, Item, Blob);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0][0].entries),
    ['text/html', 'text/plain']);
  assert.equal(await request, 'html+plain');
});

test('clipboard denial is explicit and cannot imply an Outlook body', async () => {
  const payload = clipboardPayload({kind: 'provider', body: providerBody});
  const calls = [];
  class Item { constructor(entries) { this.entries = entries; } }
  const clipboard = {
    write() { calls.push('rich'); return Promise.reject(new Error('denied')); },
    writeText(value) { calls.push(['plain', value]);
      return Promise.resolve(); },
  };
  assert.equal(await writeClipboardPayload(payload, clipboard, Item, Blob),
    'plain');
  assert.deepEqual(calls, ['rich', ['plain', providerBody]]);
  await assert.rejects(writeClipboardPayload(payload, {
    writeText() { return Promise.reject(new Error('denied')); },
  }, null, Blob),
  error => error instanceof ClipboardWriteError &&
    error.code === 'CLIPBOARD_WRITE_UNAVAILABLE');
});
