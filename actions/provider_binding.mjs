import {decodeBase64Url} from '../crypto.mjs';
import {PROVIDER_BINDING_SCHEMA, verifySignedBindingEnvelope} from './binding_signature.mjs';

export {PROVIDER_BINDING_SCHEMA} from './binding_signature.mjs';
const HKDF_SALT = 'arbys-gantt-provider-contact-binding/hkdf-salt/v2';
const HKDF_INFO = 'arbys-gantt-provider-contact-binding/aes-256-gcm/v2';
const WO_ID = /^0WO[A-Za-z0-9]{15}$/;
const AGENT = /^[A-Za-z][A-Za-z0-9]{0,9}$/;
const STORE = /^[0-9]{1,7}$/;
const ACN = /^[0-9]{4,12}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function aad(value) {
  if (!WO_ID.test(value?.nativeWoId) || !AGENT.test(value?.agentCode) ||
      !STORE.test(value?.storeNumber) || !ACN.test(value?.outletAcn)) {
    throw new Error('Invalid provider binding identity');
  }
  return new TextEncoder().encode(`${PROVIDER_BINDING_SCHEMA}\n${value.nativeWoId}\n${value.agentCode.toUpperCase()}\n${value.storeNumber}\n${value.outletAcn}`);
}

async function derivedKey(masterBytes, usage) {
  if (!(masterBytes instanceof Uint8Array) || masterBytes.length !== 32 ||
      !globalThis.crypto?.subtle) throw new Error('Invalid Gantt capability key');
  const master = await crypto.subtle.importKey('raw', masterBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(HKDF_SALT),
    info: new TextEncoder().encode(HKDF_INFO)},
  master, {name: 'AES-GCM', length: 256}, false, [usage]);
}

export function validateProviderBindingPayload(value, expectedSource) {
  const keys = ['schema', 'nativeWoId', 'agentCode', 'storeNumber', 'outletAcn',
    'installManagerEmail', 'plannerEmail', 'contactKey', 'sourceEvidenceDigest',
    'sourceRecordSha256', 'sourceCheckedAtUtc', 'verifiedAtUtc'];
  if (!exactKeys(value, keys) || value.schema !== PROVIDER_BINDING_SCHEMA ||
      !WO_ID.test(value.nativeWoId) || !AGENT.test(value.agentCode) ||
      !STORE.test(value.storeNumber) || !ACN.test(value.outletAcn) ||
      typeof value.installManagerEmail !== 'string' || !EMAIL.test(value.installManagerEmail) ||
      typeof value.plannerEmail !== 'string' || !EMAIL.test(value.plannerEmail) ||
      value.installManagerEmail.toLowerCase() === value.plannerEmail.toLowerCase() ||
      !SHA256.test(value.contactKey) || !SHA256.test(value.sourceEvidenceDigest) ||
      !SHA256.test(value.sourceRecordSha256) ||
      !UTC.test(value.sourceCheckedAtUtc) || !Number.isFinite(Date.parse(value.sourceCheckedAtUtc)) ||
      !UTC.test(value.verifiedAtUtc) || !Number.isFinite(Date.parse(value.verifiedAtUtc))) {
    throw new Error('Invalid provider binding');
  }
  if (expectedSource && (value.nativeWoId !== expectedSource.nativeWoId ||
      value.agentCode.toUpperCase() !== expectedSource.agentCode.toUpperCase() ||
      value.storeNumber !== expectedSource.storeNumber ||
      value.outletAcn !== expectedSource.outletAcn ||
      expectedSource.suggestedRecipients?.length !== 2 ||
      value.installManagerEmail.toLowerCase() !== expectedSource.suggestedRecipients[0].toLowerCase() ||
      value.plannerEmail.toLowerCase() !== expectedSource.suggestedRecipients[1].toLowerCase())) {
    throw new Error('Provider binding does not match the selected work order');
  }
  return Object.freeze({...value});
}

export async function encryptProviderBinding(payload, masterBytes) {
  const validated = validateProviderBindingPayload(payload);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivedKey(masterBytes, 'encrypt');
  const cipher = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce, additionalData: aad(validated), tagLength: 128,
  }, key, new TextEncoder().encode(JSON.stringify(validated)));
  return Object.freeze({schema: PROVIDER_BINDING_SCHEMA,
    nonce: encodeBase64Url(nonce), ciphertext: encodeBase64Url(new Uint8Array(cipher))});
}

// The production export below binds the pinned verifier. Local bundle content
// has no field or parameter that selects a different trust anchor.
export function createProviderBindingDecoder(verifier) {
  if (typeof verifier !== 'function') throw new Error('Provider verifier unavailable');
  return async function decryptProviderBindingWithVerifier(envelope, masterBytes, source) {
    if (!exactKeys(envelope, ['schema', 'nonce', 'ciphertext', 'keyId', 'signature']) ||
        envelope.schema !== PROVIDER_BINDING_SCHEMA ||
        typeof envelope.nonce !== 'string' || envelope.nonce.length !== 16 ||
        typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 24 ||
        envelope.ciphertext.length > 3000) throw new Error('Provider binding unavailable');
    if (!await verifier(envelope, 'provider', source?.nativeWoId)) {
      throw new Error('Provider binding unavailable');
    }
    const nonce = decodeBase64Url(envelope.nonce);
    const cipher = decodeBase64Url(envelope.ciphertext);
    if (nonce.length !== 12 || cipher.length < 17) throw new Error('Provider binding unavailable');
    try {
      const key = await derivedKey(masterBytes, 'decrypt');
      const clear = await crypto.subtle.decrypt({name: 'AES-GCM', iv: nonce,
        additionalData: aad(source), tagLength: 128}, key, cipher);
      const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(clear));
      return validateProviderBindingPayload(value, source);
    } catch {
      throw new Error('Provider binding unavailable');
    }
  };
}

export const decryptProviderBinding = createProviderBindingDecoder(verifySignedBindingEnvelope);
