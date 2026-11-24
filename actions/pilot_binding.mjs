import {decodeBase64Url} from '../crypto.mjs';
import {PILOT_BINDING_SCHEMA, verifySignedBindingEnvelope} from './binding_signature.mjs';

export {PILOT_BINDING_SCHEMA} from './binding_signature.mjs';
export const CUSTOMER_TRACKER_PATH = '/arbys-customer-status-preview/';
const CUSTOMER_TRACKER_ORIGIN = 'https://rbcochell-ui.github.io';
const HKDF_SALT = 'arbys-gantt-pilot-customer-binding/hkdf-salt/v3';
const HKDF_INFO = 'arbys-gantt-pilot-customer-binding/aes-256-gcm/v3';
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STOREN = /^[0-9]{1,7}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function masterKeyBytes(keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
    throw new Error('Invalid Gantt capability key');
  }
  return keyBytes;
}

function bindingAad(formSourceKey) {
  if (typeof formSourceKey !== 'string' || !FORM_KEY.test(formSourceKey)) {
    throw new Error('Invalid FORM source key');
  }
  return new TextEncoder().encode(`${PILOT_BINDING_SCHEMA}\n${formSourceKey}\n${CUSTOMER_TRACKER_ORIGIN}${CUSTOMER_TRACKER_PATH}`);
}

async function bindingKey(masterBytes, usage) {
  masterKeyBytes(masterBytes);
  if (!globalThis.crypto?.subtle) throw new Error('Browser cryptography unavailable');
  const master = await crypto.subtle.importKey('raw', masterBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(HKDF_SALT),
    info: new TextEncoder().encode(HKDF_INFO),
  }, master, {name: 'AES-GCM', length: 256}, false, [usage]);
}

export function validateCustomerTrackerUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid customer tracker link'); }
  const query = [...url.searchParams.entries()];
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (url.origin !== CUSTOMER_TRACKER_ORIGIN || url.pathname !== CUSTOMER_TRACKER_PATH ||
      url.username || url.password ||
      query.length !== 1 || query[0][0] !== 'p' || !/^p_[0-9a-f]{32}$/.test(query[0][1]) ||
      fragment.length !== 1 || fragment[0][0] !== 'k' || !/^[A-Za-z0-9_-]{43}$/.test(fragment[0][1])) {
    throw new Error('Invalid customer tracker link');
  }
  return url.href;
}

export function validatePilotBindingPayload(value, expectedFormSourceKey) {
  const keys = ['schema', 'formSourceKey', 'storeNumber', 'recipientEmail',
    'trackerUrl', 'releaseReceiptSha256', 'trackerLastVerifiedAtUtc'];
  if (!exactKeys(value, keys) || value.schema !== PILOT_BINDING_SCHEMA ||
      typeof value.formSourceKey !== 'string' || !FORM_KEY.test(value.formSourceKey) ||
      (expectedFormSourceKey && value.formSourceKey !== expectedFormSourceKey) ||
      typeof value.storeNumber !== 'string' || !STOREN.test(value.storeNumber) ||
      typeof value.recipientEmail !== 'string' || !EMAIL.test(value.recipientEmail) ||
      /[\r\n]/.test(value.recipientEmail) ||
      typeof value.releaseReceiptSha256 !== 'string' || !SHA256.test(value.releaseReceiptSha256) ||
      typeof value.trackerLastVerifiedAtUtc !== 'string' ||
      !UTC.test(value.trackerLastVerifiedAtUtc) ||
      !Number.isFinite(Date.parse(value.trackerLastVerifiedAtUtc))) {
    throw new Error('Invalid pilot binding');
  }
  validateCustomerTrackerUrl(value.trackerUrl);
  return Object.freeze({...value});
}

/** Encrypts a pilot link with a dedicated HKDF subkey, separate from the chart key. */
export async function encryptPilotBinding(payload, masterBytes) {
  const validated = validatePilotBindingPayload(payload);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await bindingKey(masterBytes, 'encrypt');
  const cipher = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce, additionalData: bindingAad(validated.formSourceKey), tagLength: 128,
  }, key, new TextEncoder().encode(JSON.stringify(validated)));
  return Object.freeze({schema: PILOT_BINDING_SCHEMA,
    nonce: encodeBase64Url(nonce), ciphertext: encodeBase64Url(new Uint8Array(cipher))});
}

/** AAD binds the ciphertext to one FORM selection; keep ciphertext private while held. */
// The production export below binds the pinned verifier. Local bundle content
// has no field or parameter that selects a different trust anchor.
export function createPilotBindingDecoder(verifier) {
  if (typeof verifier !== 'function') throw new Error('Customer verifier unavailable');
  return async function decryptPilotBindingWithVerifier(envelope, masterBytes,
      selectedFormSourceKey) {
    if (!exactKeys(envelope, ['schema', 'nonce', 'ciphertext', 'keyId', 'signature']) ||
        envelope.schema !== PILOT_BINDING_SCHEMA ||
        typeof envelope.nonce !== 'string' || envelope.nonce.length !== 16 ||
        typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 24 ||
        envelope.ciphertext.length > 3000) throw new Error('Pilot binding unavailable');
    if (!await verifier(envelope, 'customer', selectedFormSourceKey)) {
      throw new Error('Pilot binding unavailable');
    }
    const nonce = decodeBase64Url(envelope.nonce);
    const cipher = decodeBase64Url(envelope.ciphertext);
    if (nonce.length !== 12 || cipher.length < 17) throw new Error('Pilot binding unavailable');
    try {
      const key = await bindingKey(masterBytes, 'decrypt');
      const clear = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: nonce, additionalData: bindingAad(selectedFormSourceKey), tagLength: 128,
      }, key, cipher);
      const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(clear));
      return validatePilotBindingPayload(value, selectedFormSourceKey);
    } catch {
      // Never return a key, URL, recipient, or oracle detail in an error message.
      throw new Error('Pilot binding unavailable');
    }
  };
}

export const decryptPilotBinding = createPilotBindingDecoder(verifySignedBindingEnvelope);
