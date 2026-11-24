// One encrypted, exact WO/contact source for an editable provider template.
// This codec cannot send mail. Its release record is fixed independently.
import {providerCommitment} from './provider_commitment.mjs';
import {digestSelection} from './action_release.mjs';

export const PROVIDER_ASSET_SCHEMA = 'arbys-gantt-oneclick-provider-source/v1';
const SOURCE_SCHEMA = 'ArbysF32ProviderComposeSource/held-v1';
const SALT = 'arbys-gantt-oneclick-provider-source/hkdf-salt/v1';
const INFO = 'arbys-gantt-oneclick-provider-source/aes-256-gcm/v1';
const DOMAIN = 'arbys-gantt-oneclick-provider-source/aad/v1';
const HEX = /^[0-9a-f]{64}$/u;
const B64 = /^[A-Za-z0-9_-]+$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u;
const MAX_SOURCE_BYTES = 8_000;
export const MAX_PROVIDER_ASSET_BYTES = 16_000;
const ENVELOPE_KEYS = ['schema', 'nonce', 'ciphertext',
  'sourceSha256', 'providerCommitmentSha256', 'selectionDigestSha256',
  'chartCipherSha256', 'sourceObservedAtUtc', 'sourceValidUntilUtc'];

function bad() { throw new Error('Provider source unavailable'); }
function exactKeys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every(name => Object.hasOwn(value, name));
}
function encode(bytes) {
  let chars = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chars += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(chars).replace(/\+/gu, '-').replace(/\//gu, '_')
    .replace(/=+$/u, '');
}
function decode(value) {
  if (typeof value !== 'string' || !B64.test(value)) bad();
  const chars = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') +
    '='.repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(chars, char => char.charCodeAt(0));
  if (encode(bytes) !== value) bad();
  return bytes;
}
async function sha(text) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(text)));
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function windowCheck(from, until, nowMs) {
  if (typeof from !== 'string' || typeof until !== 'string' ||
      !UTC.test(from) || !UTC.test(until) ||
      Date.parse(until) - Date.parse(from) !== 86_400_000 ||
      !Number.isFinite(nowMs) || Date.parse(from) > nowMs + 60_000 ||
      nowMs >= Date.parse(until)) bad();
}
function keyBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32 ||
      !globalThis.crypto?.subtle) bad();
  return bytes;
}
async function derive(bytes, usage) {
  const master = await crypto.subtle.importKey('raw', keyBytes(bytes),
    'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(SALT),
    info: new TextEncoder().encode(INFO)}, master,
  {name: 'AES-GCM', length: 256}, false, [usage]);
}
function aad(value) {
  return new TextEncoder().encode(JSON.stringify([DOMAIN, value.schema,
    value.sourceSha256, value.providerCommitmentSha256,
    value.selectionDigestSha256, value.chartCipherSha256,
    value.sourceObservedAtUtc, value.sourceValidUntilUtc]));
}
function sourceShape(text, expected, nowMs) {
  if (typeof text !== 'string' ||
      new TextEncoder().encode(text).length > MAX_SOURCE_BYTES) bad();
  let value;
  try { value = JSON.parse(text); } catch { bad(); }
  if (value?.schema !== SOURCE_SCHEMA ||
      value.releaseState !== 'HELD_SOURCE_ONLY' ||
      value.reviewAuthority !== 'CODEX_TECHNICAL_PROVISIONAL' ||
      value.spActivityDateConfirmed !== false ||
      value.chartCipherSha256 !== expected.chartCipherSha256 ||
      value.providerCommitmentSha256 !==
        expected.providerCommitmentSha256 ||
      value.source?.sourceObservedAtUtc !== expected.sourceObservedAtUtc ||
      value.source?.sourceValidUntilUtc !== expected.sourceValidUntilUtc) bad();
  windowCheck(value.source.sourceObservedAtUtc,
    value.source.sourceValidUntilUtc, nowMs);
  return value;
}

/** Stage only: sourceText is the exact protected audited source.json bytes. */
export async function sealProviderSource(sourceText, masterBytes,
    metadata, nowMs = Date.now()) {
  keyBytes(masterBytes);
  if (!metadata || !HEX.test(metadata.sourceSha256 ?? '') ||
      !HEX.test(metadata.providerCommitmentSha256 ?? '') ||
      !HEX.test(metadata.selectionDigestSha256 ?? '') ||
      !HEX.test(metadata.chartCipherSha256 ?? '') ||
      await sha(sourceText) !== metadata.sourceSha256) bad();
  const source = sourceShape(sourceText, metadata, nowMs);
  if (await providerCommitment(source.source) !==
      metadata.providerCommitmentSha256 ||
      await digestSelection({kind: 'provider', id: source.source.nativeWoId},
        masterBytes) !== metadata.selectionDigestSha256) bad();
  const partial = {schema: PROVIDER_ASSET_SCHEMA,
    nonce: encode(crypto.getRandomValues(new Uint8Array(12))),
    ...metadata};
  const key = await derive(masterBytes, 'encrypt');
  const cipher = await crypto.subtle.encrypt({name: 'AES-GCM',
    iv: decode(partial.nonce), additionalData: aad(partial), tagLength: 128},
  key, new TextEncoder().encode(sourceText));
  const envelope = Object.freeze({schema: partial.schema,
    nonce: partial.nonce, ciphertext: encode(new Uint8Array(cipher)),
    sourceSha256: partial.sourceSha256,
    providerCommitmentSha256: partial.providerCommitmentSha256,
    selectionDigestSha256: partial.selectionDigestSha256,
    chartCipherSha256: partial.chartCipherSha256,
    sourceObservedAtUtc: partial.sourceObservedAtUtc,
    sourceValidUntilUtc: partial.sourceValidUntilUtc});
  const json = JSON.stringify(envelope) + '\n';
  if (new TextEncoder().encode(json).length > MAX_PROVIDER_ASSET_BYTES) bad();
  return Object.freeze({json, assetSha256: await sha(json)});
}

/** Runtime: exact fixed hash, GCM, source digest, chart selection and WO pin. */
export async function unsealProviderSource(assetText, masterBytes,
    expected, selectedNativeWoId, nowMs = Date.now()) {
  keyBytes(masterBytes);
  if (typeof assetText !== 'string' ||
      new TextEncoder().encode(assetText).length > MAX_PROVIDER_ASSET_BYTES ||
      !expected || !HEX.test(expected.assetSha256 ?? '') ||
      await sha(assetText) !== expected.assetSha256) bad();
  let value;
  try { value = JSON.parse(assetText); } catch { bad(); }
  if (!exactKeys(value, ENVELOPE_KEYS) ||
      value.schema !== PROVIDER_ASSET_SCHEMA ||
      value.sourceSha256 !== expected.sourceSha256 ||
      value.providerCommitmentSha256 !==
        expected.providerCommitmentSha256 ||
      value.selectionDigestSha256 !== expected.selectionDigestSha256 ||
      value.chartCipherSha256 !== expected.chartCipherSha256 ||
      value.sourceObservedAtUtc !== expected.sourceObservedAtUtc ||
      value.sourceValidUntilUtc !== expected.sourceValidUntilUtc ||
      typeof value.nonce !== 'string' || value.nonce.length !== 16 ||
      decode(value.nonce).length !== 12 ||
      typeof value.ciphertext !== 'string' ||
      value.ciphertext.length < 24 ||
      decode(value.ciphertext).length < 17) bad();
  windowCheck(value.sourceObservedAtUtc, value.sourceValidUntilUtc, nowMs);
  let clear;
  try {
    const key = await derive(masterBytes, 'decrypt');
    const bytes = await crypto.subtle.decrypt({name: 'AES-GCM',
      iv: decode(value.nonce), additionalData: aad(value), tagLength: 128},
    key, decode(value.ciphertext));
    clear = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch { bad(); }
  if (await sha(clear) !== expected.sourceSha256) bad();
  const source = sourceShape(clear, expected, nowMs).source;
  if (source.nativeWoId !== selectedNativeWoId ||
      await digestSelection({kind: 'provider', id: selectedNativeWoId},
        masterBytes) !== expected.selectionDigestSha256 ||
      await providerCommitment(source) !==
        expected.providerCommitmentSha256) bad();
  return Object.freeze({...source});
}
