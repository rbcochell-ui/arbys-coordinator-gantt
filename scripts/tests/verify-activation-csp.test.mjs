import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {ActivationCspError, verifyActivationCsp} from
  '../verify-activation-csp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const heldPath = resolve(root, 'index.html');
const heldHtml = readFileSync(heldPath, 'utf8');
const activatedHtml = heldHtml.replace(
  "connect-src 'self'; frame-src 'self' about:",
  "connect-src 'self' https://login.microsoftonline.com " +
  "https://graph.microsoft.com; frame-src 'self' about: " +
  'https://login.microsoftonline.com',
);

function failsWith(html, code) {
  assert.throws(() => verifyActivationCsp(html),
    error => error instanceof ActivationCspError && error.code === code);
}

test('the checked-in held page cannot pass an activation check', () => {
  failsWith(heldHtml, 'CSP_CONNECT_SRC_NOT_EXACT');
  const result = spawnSync(process.execPath,
    [resolve(root, 'scripts/verify-activation-csp.mjs'), heldPath],
    {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CSP_CONNECT_SRC_NOT_EXACT/u);
});

test('only the exact Graph and Entra destinations pass', () => {
  assert.notEqual(activatedHtml, heldHtml);
  assert.equal(verifyActivationCsp(activatedHtml), true);
  failsWith(activatedHtml.replace('https://graph.microsoft.com',
    'https://graph.microsoft.com.evil.invalid'),
  'CSP_CONNECT_SRC_NOT_EXACT');
  failsWith(activatedHtml.replace('https://graph.microsoft.com',
    'https://*.microsoft.com'), 'CSP_CONNECT_SRC_NOT_EXACT');
  failsWith(activatedHtml.replace('https://login.microsoftonline.com',
    'https://login.microsoft.com'), 'CSP_CONNECT_SRC_NOT_EXACT');
});

test('silent-auth frame destination and pinned scripts remain required', () => {
  failsWith(activatedHtml.replace(
    "frame-src 'self' about: https://login.microsoftonline.com",
    "frame-src 'self' about:"), 'CSP_FRAME_SRC_NOT_EXACT');
  failsWith(activatedHtml.replace("script-src 'self'",
    "script-src 'self' 'unsafe-inline'"), 'CSP_SCRIPT_SRC_NOT_PINNED');
  failsWith(activatedHtml.replace("img-src 'none'", 'img-src *'),
    'CSP_IMG_SRC_NOT_EXACT');
});

test('ambiguous or missing CSP meta tags fail closed', () => {
  const tag = /<meta http-equiv="Content-Security-Policy"[^>]+>/u
    .exec(activatedHtml)?.[0];
  assert.ok(tag);
  failsWith(activatedHtml.replace(tag, ''), 'CSP_META_COUNT');
  failsWith(activatedHtml.replace(tag, tag + tag), 'CSP_META_COUNT');
  failsWith(activatedHtml.replace(tag,
    tag.replace('http-equiv=', 'data-http-equiv=')), 'CSP_META_COUNT');
  failsWith(activatedHtml.replace(tag,
    tag.replace('content=', 'data-content=')), 'CSP_CONTENT_MISSING');
  failsWith(activatedHtml.replace(tag,
    tag.replace('<meta ', '<meta-data ')), 'CSP_META_COUNT');
  failsWith(activatedHtml.replace(tag,
    tag.replace('http-equiv=', 'http-equiv="refresh" http-equiv=')),
  'CSP_ATTRIBUTE_DUPLICATE');
  failsWith(activatedHtml.replace(tag,
    tag.replace('content=', 'content="default-src *" content=')),
  'CSP_ATTRIBUTE_DUPLICATE');
  failsWith(activatedHtml.replace("connect-src 'self'",
    "connect-src 'self'; connect-src 'self'"),
  'CSP_DIRECTIVE_DUPLICATE');
});
