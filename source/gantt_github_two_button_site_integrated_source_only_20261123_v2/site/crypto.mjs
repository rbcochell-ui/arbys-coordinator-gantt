export const ENVELOPE_SCHEMA = 'arbys-gantt-cipher/v1';
export const PLAIN_SCHEMA = 'arbys-gantt-html/v1';
export const AAD = 'arbys-coordinator-gantt/v1';

const SHA256_RE = /^[0-9a-f]{64}$/u;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/u;
const B64_RE = /^[A-Za-z0-9_-]+$/u;

function exactKeys(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length
    && names.every((name) => Object.hasOwn(value, name));
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string' || !B64_RE.test(value)) throw new Error('Invalid encoding');
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/')
    + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const canonical = btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  if (canonical !== value) throw new Error('Invalid encoding');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function parseCapabilityHref(href) {
  const url = new URL(href);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!((url.protocol === 'https:') || (local && url.protocol === 'http:'))
    || url.username || url.password || url.search) throw new Error('Invalid link');
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (fragment.length !== 1 || fragment[0][0] !== 'k'
    || !KEY_RE.test(fragment[0][1])) throw new Error('Invalid link');
  const key = decodeBase64Url(fragment[0][1]);
  if (key.length !== 32) throw new Error('Invalid link key');
  return key;
}

export function validateEnvelope(envelope) {
  if (!exactKeys(envelope, ['schema', 'nonce', 'ciphertext'])
    || envelope.schema !== ENVELOPE_SCHEMA
    || typeof envelope.nonce !== 'string' || envelope.nonce.length !== 16
    || typeof envelope.ciphertext !== 'string'
    || envelope.ciphertext.length < 24 || envelope.ciphertext.length > 1_600_000) {
    throw new Error('Invalid encrypted chart');
  }
  if (decodeBase64Url(envelope.nonce).length !== 12
    || decodeBase64Url(envelope.ciphertext).length < 17) {
    throw new Error('Invalid encrypted chart');
  }
  return envelope;
}

export async function decryptGantt(envelope, keyBytes) {
  validateEnvelope(envelope);
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32
    || !globalThis.crypto?.subtle) throw new Error('Invalid chart key');
  const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const decrypted = await globalThis.crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: decodeBase64Url(envelope.nonce),
    additionalData: new TextEncoder().encode(AAD),
    tagLength: 128,
  }, key, decodeBase64Url(envelope.ciphertext));
  const plain = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted));
  if (!exactKeys(plain, ['schema', 'sha256', 'html'])
    || plain.schema !== PLAIN_SCHEMA || !SHA256_RE.test(plain.sha256)
    || typeof plain.html !== 'string' || plain.html.length > 1_000_000
    || !/^<!doctype html>/iu.test(plain.html)) throw new Error('Invalid chart payload');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain.html));
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== plain.sha256) throw new Error('Chart hash mismatch');
  return plain.html;
}
