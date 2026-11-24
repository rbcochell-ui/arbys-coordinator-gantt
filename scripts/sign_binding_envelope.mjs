// Local publisher utility. Keep PKCS#8 bytes outside Git and never print them.
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {resolve, sep} from 'node:path';
import {canonicalBindingEnvelopeBytes, BINDING_SIGNING_KEY_ID,
  verifySignedBindingEnvelope} from '../actions/binding_signature.mjs';

function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export function readPrivateSigningKey(keyPath, repoRoot) {
  const real = realpathSync(resolve(keyPath));
  const root = realpathSync(resolve(repoRoot)).toLowerCase();
  const lower = real.toLowerCase();
  if (lower === root || lower.startsWith(`${root}${sep}`) ||
      !real.toLowerCase().endsWith('.pk8') || !statSync(real).isFile()) {
    throw new Error('Signing key must be a protected PKCS#8 file outside the public repository');
  }
  const key = readFileSync(real);
  if (key.length < 100 || key.length > 2048) {
    key.fill(0);
    throw new Error('Signing key file is invalid');
  }
  return key;
}

export async function signBindingEnvelope(envelope, kind, selectedId, privatePkcs8) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'ciphertext,nonce,schema') {
    throw new Error('Unsigned binding envelope is required');
  }
  const unsigned = Object.freeze({...envelope, keyId: BINDING_SIGNING_KEY_ID});
  const message = canonicalBindingEnvelopeBytes(unsigned, kind, selectedId);
  if (!(privatePkcs8 instanceof Uint8Array) || !globalThis.crypto?.subtle) {
    throw new Error('Binding signing key unavailable');
  }
  try {
    const key = await crypto.subtle.importKey('pkcs8', privatePkcs8,
      {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
    const raw = new Uint8Array(await crypto.subtle.sign(
      {name: 'ECDSA', hash: 'SHA-256'}, key, message));
    if (raw.length !== 64) throw new Error('Unexpected ECDSA signature');
    const signed = Object.freeze({...unsigned, signature: encodeBase64Url(raw)});
    if (!await verifySignedBindingEnvelope(signed, kind, selectedId)) {
      throw new Error('Signing key does not match the pinned public key');
    }
    return signed;
  } catch {
    throw new Error('Binding signing failed; check the protected key and pinned public key');
  }
}
