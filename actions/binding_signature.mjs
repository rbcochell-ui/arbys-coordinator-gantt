import {decodeBase64Url} from '../crypto.mjs';

// This public key verifies publisher-made bindings. The signing key is stored
// separately under the local protected .codex/private folder, never in Pages.
export const BINDING_SIGNING_KEY_ID =
  '0744acf08d55fab5a343900b663ddfe8d28a32d371b74b30091d975da69d646a';
export const BINDING_PUBLIC_SPKI_BASE64URL =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXZQEwh45wyaqrU3cbd5W62GG7Dg57xUeRVbdK2G_z2MKnfl1lRRFpUVmACn-DpQ2z3d0Ysk-KpeJsJTVUl_O7A';
export const PROVIDER_BINDING_SCHEMA = 'arbys-gantt-provider-contact-binding/v2';
export const PILOT_BINDING_SCHEMA = 'arbys-gantt-pilot-customer-binding/v3';

const DOMAIN = 'arbys-gantt-signed-action-envelope/v1';
const WO_ID = /^0WO[A-Za-z0-9]{15}$/;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;
const B64 = /^[A-Za-z0-9_-]+$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Fixed-order, domain-separated bytes; selected kind and ID cannot be replayed. */
export function canonicalBindingEnvelopeBytes(envelope, kind, selectedId,
    expectedKeyId = BINDING_SIGNING_KEY_ID) {
  const signed = Object.hasOwn(envelope ?? {}, 'signature');
  const keys = ['schema', 'nonce', 'ciphertext', 'keyId', ...(signed ? ['signature'] : [])];
  const expectedSchema = kind === 'provider' ? PROVIDER_BINDING_SCHEMA :
    kind === 'customer' ? PILOT_BINDING_SCHEMA : null;
  const idPattern = kind === 'provider' ? WO_ID : kind === 'customer' ? FORM_KEY : null;
  if (!expectedSchema || typeof selectedId !== 'string' ||
      !idPattern.test(selectedId) || !exactKeys(envelope, keys) ||
      typeof expectedKeyId !== 'string' || !/^[0-9a-f]{64}$/.test(expectedKeyId) ||
      envelope.schema !== expectedSchema || envelope.keyId !== expectedKeyId ||
      typeof envelope.nonce !== 'string' || envelope.nonce.length !== 16 ||
      typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 24 ||
      envelope.ciphertext.length > 3000 || !B64.test(envelope.ciphertext) ||
      decodeBase64Url(envelope.nonce).length !== 12 ||
      decodeBase64Url(envelope.ciphertext).length < 17) {
    throw new Error('Signed action binding unavailable');
  }
  return new TextEncoder().encode(JSON.stringify([DOMAIN, kind, selectedId,
    envelope.schema, envelope.keyId, envelope.nonce, envelope.ciphertext]));
}

/** Test-only callers may supply an ephemeral trust anchor; the viewer never does. */
export async function verifyBindingEnvelopeWithKey(envelope, kind, selectedId,
    publicSpkiBase64Url, expectedKeyId) {
  try {
    if (!globalThis.crypto?.subtle) return false;
    const message = canonicalBindingEnvelopeBytes(envelope, kind, selectedId, expectedKeyId);
    if (typeof envelope.signature !== 'string' || envelope.signature.length !== 86) return false;
    const signature = decodeBase64Url(envelope.signature);
    if (signature.length !== 64) return false;
    const publicSpki = decodeBase64Url(publicSpkiBase64Url);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', publicSpki));
    const actualKeyId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (actualKeyId !== expectedKeyId) return false;
    const publicKey = await crypto.subtle.importKey('spki', publicSpki,
      {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'},
      publicKey, signature, message);
  } catch {
    return false;
  }
}

/** Production verifier: only the public key pinned in this module can pass. */
export function verifySignedBindingEnvelope(envelope, kind, selectedId) {
  return verifyBindingEnvelopeWithKey(envelope, kind, selectedId,
    BINDING_PUBLIC_SPKI_BASE64URL, BINDING_SIGNING_KEY_ID);
}
