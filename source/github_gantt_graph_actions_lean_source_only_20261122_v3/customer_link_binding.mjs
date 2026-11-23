import {canonicalFormSourceKey, HeldActionError,
  validatedCustomerTrackerUrl} from './contract.mjs';

const TRACKER_BASE = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/';
const CIPHER_SCHEMA = 'arbys-customer-cipher/v1';
const FORM_PROOF_CIPHER_SCHEMA = 'arbys-customer-form-proof-cipher/v1';
const FORM_PROOF_SCHEMA = 'arbys-customer-form-proof/v1';
const STATUS_AAD_PREFIX = 'arbys-customer-status/v1:';
const FORM_PROOF_AAD_PREFIX = 'arbys-customer-form-proof/v1:';
const FORM_DIGEST_PREFIX = 'arbys-form-source-key/v1\0';
const PROJECT_SCHEMAS = new Set([
  'arbys-customer-status/v1',
  'arbys-customer-status/v2',
  'arbys-customer-status/roster-v1',
  'arbys-customer-status/observed-v2',
]);
const SHA = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const DAY = 24 * 60 * 60_000;
const MAX_FILE_BYTES = 32_768;

function fail(code) { throw new HeldActionError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}
function subtle() {
  if (!globalThis.crypto?.subtle) fail('RELEASE_TRACKER_CRYPTO_UNAVAILABLE');
  return globalThis.crypto.subtle;
}
function bytesOf(value) { return new TextEncoder().encode(value); }
function hex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sha256(bytes) {
  return hex(new Uint8Array(await subtle().digest('SHA-256', bytes)));
}
function decode64(value, code) {
  if (typeof value !== 'string' || !B64.test(value)) fail(code);
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const normalized = btoa(binary).replace(/\+/g, '-')
      .replace(/\//g, '_').replace(/=+$/, '');
    if (normalized !== value) fail(code);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch { fail(code); }
}
function encode64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-')
    .replace(/\//g, '_').replace(/=+$/, '');
}
function parseJson(bytes, code) {
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch { fail(code); }
}
function capability(trackerUrl) {
  const url = new URL(validatedCustomerTrackerUrl(trackerUrl));
  const handle = url.searchParams.get('p');
  const key = decode64(url.hash.slice(3), 'RELEASE_TRACKER_KEY_INVALID');
  if (key.length !== 32) fail('RELEASE_TRACKER_KEY_INVALID');
  return {handle, key};
}
export function customerTrackerHandle(trackerUrl) {
  return capability(trackerUrl).handle;
}
async function digestFormKey(formSourceKey) {
  return sha256(bytesOf(FORM_DIGEST_PREFIX +
    canonicalFormSourceKey(formSourceKey)));
}
async function decrypt(raw, {handle, key, schema, aadPrefix, code}) {
  const envelope = parseJson(raw, code);
  if (!exactKeys(envelope, ['schema', 'handle', 'nonce', 'ciphertext']) ||
      envelope.schema !== schema || envelope.handle !== handle) fail(code);
  const nonce = decode64(envelope.nonce, code);
  const ciphertext = decode64(envelope.ciphertext, code);
  if (nonce.length !== 12 || ciphertext.length < 17) fail(code);
  let plaintext;
  try {
    const cryptoKey = await subtle().importKey('raw', key, 'AES-GCM',
      false, ['decrypt']);
    plaintext = await subtle().decrypt({
      name: 'AES-GCM', iv: nonce,
      additionalData: bytesOf(aadPrefix + handle), tagLength: 128,
    }, cryptoKey, ciphertext);
  } catch { fail(code); }
  return parseJson(new Uint8Array(plaintext), code);
}
async function readPublicFile(fetchImpl, url, code) {
  let response;
  try {
    response = await fetchImpl(url, {method: 'GET', cache: 'no-store',
      credentials: 'omit', redirect: 'error'});
  } catch { fail(code); }
  if (response?.status !== 200 || response.redirected === true ||
      response.url !== url || typeof response.arrayBuffer !== 'function') {
    fail(code);
  }
  let raw;
  try { raw = new Uint8Array(await response.arrayBuffer()); }
  catch { fail(code); }
  if (raw.length === 0 || raw.length > MAX_FILE_BYTES) fail(code);
  return raw;
}

// Publish this once per FORM project, after the owner has verified the FORM
// source and the tracker it belongs to. It is a separate encrypted file, so
// the existing customer viewer and private URL need no change.
export async function createCustomerFormLinkProof({
  formSourceKey, trackerUrl, nonceBytes = globalThis.crypto?.getRandomValues?.(
    new Uint8Array(12)),
}) {
  const {handle, key} = capability(trackerUrl);
  if (!(nonceBytes instanceof Uint8Array) || nonceBytes.length !== 12) {
    fail('RELEASE_TRACKER_PROOF_NONCE_INVALID');
  }
  const proof = {schema: FORM_PROOF_SCHEMA, handle,
    formSourceKeySha256: await digestFormKey(formSourceKey)};
  let ciphertext;
  try {
    const cryptoKey = await subtle().importKey('raw', key, 'AES-GCM',
      false, ['encrypt']);
    ciphertext = new Uint8Array(await subtle().encrypt({
      name: 'AES-GCM', iv: nonceBytes,
      additionalData: bytesOf(FORM_PROOF_AAD_PREFIX + handle),
      tagLength: 128,
    }, cryptoKey, bytesOf(JSON.stringify(proof))));
  } catch { fail('RELEASE_TRACKER_PROOF_CRYPTO_FAILED'); }
  return JSON.stringify({schema: FORM_PROOF_CIPHER_SCHEMA, handle,
    nonce: encode64(nonceBytes), ciphertext: encode64(ciphertext)}) + '\n';
}

export async function verifyPublishedCustomerBinding({
  formSourceKey, trackerUrl, ciphertextSha256, nowMs = Date.now(),
  fetchImpl = globalThis.fetch,
}) {
  const key = canonicalFormSourceKey(formSourceKey);
  const {handle, key: capabilityKey} = capability(trackerUrl);
  if (!SHA.test(ciphertextSha256 ?? '') || !Number.isFinite(nowMs) ||
      typeof fetchImpl !== 'function') fail('RELEASE_TRACKER_BINDING_INPUT_INVALID');
  const mainUrl = new URL('data/' + handle + '.json', TRACKER_BASE).href;
  const proofUrl = new URL('data/' + handle + '.link.json', TRACKER_BASE).href;
  const [mainRaw, proofRaw] = await Promise.all([
    readPublicFile(fetchImpl, mainUrl, 'RELEASE_TRACKER_PAGE_UNAVAILABLE'),
    readPublicFile(fetchImpl, proofUrl, 'RELEASE_TRACKER_PROOF_UNAVAILABLE'),
  ]);
  if (await sha256(mainRaw) !== ciphertextSha256) {
    fail('RELEASE_TRACKER_CIPHERTEXT_MISMATCH');
  }
  const project = await decrypt(mainRaw, {
    handle, key: capabilityKey, schema: CIPHER_SCHEMA,
    aadPrefix: STATUS_AAD_PREFIX, code: 'RELEASE_TRACKER_PAGE_INVALID',
  });
  if (!object(project) || !PROJECT_SCHEMAS.has(project.schema) ||
      project.slug !== handle ||
      typeof project.lastVerifiedAtUtc !== 'string' ||
      !UTC.test(project.lastVerifiedAtUtc)) fail('RELEASE_TRACKER_PAGE_INVALID');
  const verifiedAtMs = Date.parse(project.lastVerifiedAtUtc);
  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs - nowMs > 5 * 60_000 ||
      nowMs - verifiedAtMs >= DAY) fail('RELEASE_TRACKER_PAGE_STALE');
  const proof = await decrypt(proofRaw, {
    handle, key: capabilityKey, schema: FORM_PROOF_CIPHER_SCHEMA,
    aadPrefix: FORM_PROOF_AAD_PREFIX,
    code: 'RELEASE_TRACKER_PROOF_INVALID',
  });
  if (!exactKeys(proof, ['schema', 'handle', 'formSourceKeySha256']) ||
      proof.schema !== FORM_PROOF_SCHEMA || proof.handle !== handle ||
      !SHA.test(proof.formSourceKeySha256 ?? '') ||
      proof.formSourceKeySha256 !== await digestFormKey(key)) {
    fail('RELEASE_TRACKER_FORM_MISMATCH');
  }
  return Object.freeze({handle, verifiedAtMs,
    validUntilMs: verifiedAtMs + DAY});
}
