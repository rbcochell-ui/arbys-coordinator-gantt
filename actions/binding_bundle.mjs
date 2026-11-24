import {decryptProviderBinding} from './provider_binding.mjs';
import {decryptPilotBinding} from './pilot_binding.mjs';
import {BINDING_SIGNING_KEY_ID} from './binding_signature.mjs';

export const BINDING_BUNDLE_SCHEMA = 'arbys-gantt-local-binding-bundle/v1';
export const MAX_BINDING_BUNDLE_BYTES = 350_000;
const WO_ID = /^0WO[A-Za-z0-9]{15}$/;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Test seam for an ephemeral key; the viewer uses only the pinned parser below. */
export function createBindingBundleParser(expectedKeyId) {
  if (typeof expectedKeyId !== 'string' || !/^[0-9a-f]{64}$/.test(expectedKeyId)) {
    throw new Error('Binding verification key unavailable');
  }
  return function parseBindingBundleForKey(text, allowed) {
    if (typeof text !== 'string' || text.length > MAX_BINDING_BUNDLE_BYTES ||
        !Array.isArray(allowed?.providerIds) || !Array.isArray(allowed?.customerKeys)) {
      throw new Error('Protected action bindings are unavailable');
    }
    let value;
    try { value = JSON.parse(text); }
    catch { throw new Error('Protected action bindings are unavailable'); }
    if (!exactKeys(value, ['schema', 'entries']) || value.schema !== BINDING_BUNDLE_SCHEMA ||
        !Array.isArray(value.entries) || value.entries.length < 1 ||
        value.entries.length > 100) {
      throw new Error('Protected action bindings are unavailable');
    }
    const allowProvider = new Set(allowed.providerIds);
    const allowCustomer = new Set(allowed.customerKeys);
    const providerById = Object.create(null);
    const customerByKey = Object.create(null);
    for (const entry of value.entries) {
      if (!exactKeys(entry, ['kind', 'id', 'envelope'])) {
        throw new Error('Protected action bindings are unavailable');
      }
      const provider = entry.kind === 'provider';
      const customer = entry.kind === 'customer';
      if ((!provider && !customer) || typeof entry.id !== 'string' ||
          !(provider ? WO_ID : FORM_KEY).test(entry.id) ||
          !(provider ? allowProvider : allowCustomer).has(entry.id) ||
          !exactKeys(entry.envelope, ['schema', 'nonce', 'ciphertext', 'keyId', 'signature']) ||
          entry.envelope.keyId !== expectedKeyId ||
          typeof entry.envelope.signature !== 'string') {
        throw new Error('Protected action bindings are unavailable');
      }
      const target = provider ? providerById : customerByKey;
      if (Object.hasOwn(target, entry.id)) {
        throw new Error('Duplicate protected action binding');
      }
      target[entry.id] = Object.freeze({...entry.envelope});
    }
    return Object.freeze({providerById: Object.freeze(providerById),
      customerByKey: Object.freeze(customerByKey)});
  };
}

/** Parse a coordinator-selected local file. Its ciphertext is never uploaded. */
export const parseBindingBundle = createBindingBundleParser(BINDING_SIGNING_KEY_ID);

/** Resolve only the selected exact key; a different envelope cannot be substituted. */
export function createSelectedBindingDecoder(providerDecoder, customerDecoder) {
  if (typeof providerDecoder !== 'function' || typeof customerDecoder !== 'function') {
    throw new Error('Binding decoder unavailable');
  }
  return async function decryptSelectedBindingWithDecoders(bundle, masterBytes, sources, selection) {
    if (selection?.kind === 'provider' && WO_ID.test(selection.id)) {
      const source = sources?.providerById?.[selection.id];
      const envelope = bundle?.providerById?.[selection.id];
      if (source?.eligible !== true || source.nativeWoId !== selection.id || !envelope) return null;
      return providerDecoder(envelope, masterBytes, source);
    }
    if (selection?.kind === 'customer' && FORM_KEY.test(selection.id)) {
      const source = sources?.customerByKey?.[selection.id];
      const envelope = bundle?.customerByKey?.[selection.id];
      if (source?.eligible !== true || source.formSourceKey !== selection.id || !envelope) return null;
      const binding = await customerDecoder(envelope, masterBytes, source.formSourceKey);
      if (binding.storeNumber !== source.storeNumber) {
        throw new Error('Protected action binding does not match the selected project');
      }
      return binding;
    }
    return null;
  };
}

// The browser imports these fixed production exports; a bundle cannot pick a key.
export const decryptSelectedBinding = createSelectedBindingDecoder(
  decryptProviderBinding, decryptPilotBinding);
