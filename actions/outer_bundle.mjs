// Pure cryptographic codec. This module does not fetch, navigate, draft or
// send. Callers must supply an independently fixed expected release pin.
export const OUTER_SCHEMA = 'arbys-gantt-oneclick-customer-bundle/v2';
const INNER_SCHEMA = 'arbys-gantt-local-binding-bundle/v1';
const SALT = 'arbys-gantt-oneclick-customer-bundle/hkdf-salt/v2';
const INFO = 'arbys-gantt-oneclick-customer-bundle/aes-256-gcm/v2';
const DOMAIN = 'arbys-gantt-oneclick-customer-bundle/aad/v2';
const HEX = /^[0-9a-f]{64}$/u;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u;
const B64 = /^[A-Za-z0-9_-]+$/u;
const MAX_INNER = 350_000;
const TEMPLATE_WINDOW_MS = 30 * 86_400_000;
export const MAX_OUTER_BYTES = 600_000;
const ENVELOPE_KEYS = ['schema', 'nonce', 'ciphertext', 'innerSha256',
  'sidecarSha256', 'sourceAsOfUtc', 'validUntilUtc', 'entryCount'];

function bad() { throw new Error('One-click customer bundle unavailable'); }
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}
function b64encode(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replace(/\+/gu, '-')
    .replace(/\//gu, '_').replace(/=+$/u, '');
}
function b64decode(value) {
  if (typeof value !== 'string' || !B64.test(value)) bad();
  const raw = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') +
    '='.repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  if (b64encode(bytes) !== value) bad();
  return bytes;
}
function sourceWindow(source, end, nowMs) {
  if (typeof source !== 'string' || typeof end !== 'string' ||
      !UTC.test(source) || !UTC.test(end)) bad();
  const from = Date.parse(source);
  const until = Date.parse(end);
  const sourceIso = Number.isFinite(from) ? new Date(from).toISOString() : '';
  const endIso = Number.isFinite(until) ? new Date(until).toISOString() : '';
  if (!Number.isFinite(from) || !Number.isFinite(until) ||
      ![sourceIso, sourceIso.replace('.000Z', 'Z')].includes(source) ||
      ![endIso, endIso.replace('.000Z', 'Z')].includes(end) ||
      until - from !== TEMPLATE_WINDOW_MS ||
      !Number.isFinite(nowMs) || from > nowMs + 60_000 ||
      nowMs >= until) bad();
}
function innerCount(innerText) {
  if (typeof innerText !== 'string' ||
      new TextEncoder().encode(innerText).length > MAX_INNER) bad();
  let inner;
  try { inner = JSON.parse(innerText); } catch { bad(); }
  if (!exactKeys(inner, ['schema', 'entries']) ||
      inner.schema !== INNER_SCHEMA || !Array.isArray(inner.entries) ||
      inner.entries.length < 1 || inner.entries.length > 100) bad();
  const seen = new Set();
  for (const entry of inner.entries) {
    if (!exactKeys(entry, ['kind', 'id', 'envelope']) ||
        entry.kind !== 'customer' || !FORM_KEY.test(entry.id) ||
        seen.has(entry.id) || !exactKeys(entry.envelope,
          ['schema', 'nonce', 'ciphertext', 'keyId', 'signature'])) bad();
    seen.add(entry.id);
  }
  return inner.entries.length;
}
function masterKey(masterBytes) {
  if (!(masterBytes instanceof Uint8Array) || masterBytes.length !== 32 ||
      !globalThis.crypto?.subtle) bad();
  return masterBytes;
}
async function derive(masterBytes, usage) {
  const source = await crypto.subtle.importKey('raw', masterKey(masterBytes),
    'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(SALT),
    info: new TextEncoder().encode(INFO)},
  source, {name: 'AES-GCM', length: 256}, false, [usage]);
}
function aad(value) {
  return new TextEncoder().encode(JSON.stringify([DOMAIN, value.schema,
    value.innerSha256, value.sidecarSha256, value.sourceAsOfUtc,
    value.validUntilUtc, value.entryCount]));
}
export async function sha256Hex(value) {
  if (typeof value !== 'string') bad();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Encrypt a reviewed inner bundle; output has no plaintext entry IDs. */
export async function sealOuterBundle(innerText, masterBytes, metadata,
    nowMs = Date.now()) {
  masterKey(masterBytes);
  const entryCount = innerCount(innerText);
  if (!metadata || !HEX.test(metadata.sidecarSha256 ?? '')) bad();
  sourceWindow(metadata.sourceAsOfUtc, metadata.validUntilUtc, nowMs);
  const partial = {
    schema: OUTER_SCHEMA,
    nonce: b64encode(crypto.getRandomValues(new Uint8Array(12))),
    innerSha256: await sha256Hex(innerText),
    sidecarSha256: metadata.sidecarSha256,
    sourceAsOfUtc: metadata.sourceAsOfUtc,
    validUntilUtc: metadata.validUntilUtc,
    entryCount,
  };
  const key = await derive(masterBytes, 'encrypt');
  const cipher = await crypto.subtle.encrypt({name: 'AES-GCM',
    iv: b64decode(partial.nonce), additionalData: aad(partial), tagLength: 128},
  key, new TextEncoder().encode(innerText));
  const envelope = Object.freeze({schema: partial.schema, nonce: partial.nonce,
    ciphertext: b64encode(new Uint8Array(cipher)),
    innerSha256: partial.innerSha256,
    sidecarSha256: partial.sidecarSha256,
    sourceAsOfUtc: partial.sourceAsOfUtc,
    validUntilUtc: partial.validUntilUtc,
    entryCount});
  const json = JSON.stringify(envelope) + '\n';
  if (new TextEncoder().encode(json).length > MAX_OUTER_BYTES) bad();
  return Object.freeze({json, outerSha256: await sha256Hex(json),
    innerSha256: partial.innerSha256, entryCount});
}

/** Low-level verifier for invented tests and the fixed-pin browser wrapper. */
export async function unsealOuterBundle(outerText, masterBytes, expected,
    nowMs = Date.now()) {
  masterKey(masterBytes);
  if (typeof outerText !== 'string' ||
      new TextEncoder().encode(outerText).length > MAX_OUTER_BYTES ||
      !expected || !HEX.test(expected.outerSha256 ?? '') ||
      !HEX.test(expected.innerSha256 ?? '') ||
      !HEX.test(expected.sidecarSha256 ?? '') ||
      await sha256Hex(outerText) !== expected.outerSha256) bad();
  let value;
  try { value = JSON.parse(outerText); } catch { bad(); }
  if (!exactKeys(value, ENVELOPE_KEYS) || value.schema !== OUTER_SCHEMA ||
      !HEX.test(value.innerSha256 ?? '') ||
      !HEX.test(value.sidecarSha256 ?? '') ||
      value.innerSha256 !== expected.innerSha256 ||
      value.sidecarSha256 !== expected.sidecarSha256 ||
      value.sourceAsOfUtc !== expected.sourceAsOfUtc ||
      value.validUntilUtc !== expected.validUntilUtc ||
      value.entryCount !== expected.entryCount ||
      !Number.isInteger(value.entryCount) ||
      value.entryCount < 1 || value.entryCount > 100 ||
      typeof value.nonce !== 'string' || value.nonce.length !== 16 ||
      b64decode(value.nonce).length !== 12 ||
      typeof value.ciphertext !== 'string' ||
      value.ciphertext.length < 24 ||
      value.ciphertext.length > MAX_OUTER_BYTES ||
      b64decode(value.ciphertext).length < 17) bad();
  sourceWindow(value.sourceAsOfUtc, value.validUntilUtc, nowMs);
  let inner;
  try {
    const key = await derive(masterBytes, 'decrypt');
    const clear = await crypto.subtle.decrypt({name: 'AES-GCM',
      iv: b64decode(value.nonce), additionalData: aad(value),
      tagLength: 128}, key, b64decode(value.ciphertext));
    inner = new TextDecoder('utf-8', {fatal: true}).decode(clear);
  } catch { bad(); }
  if (await sha256Hex(inner) !== value.innerSha256 ||
      innerCount(inner) !== value.entryCount) bad();
  return inner;
}

