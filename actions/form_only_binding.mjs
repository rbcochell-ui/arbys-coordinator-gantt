// Held source-only codec for one FORM-only tracker binding. This module has no
// Outlook, network, shared-Claim, or Send capability.
import {PINNED_FORM_ONLY_COMMITMENTS} from './release_commitments.mjs';
import {UNKNOWN_FORM_ONLY_SELECTION_DIGESTS} from './unknown_store_allowlist.mjs';
export const FORM_ONLY_BINDING_SCHEMA = 'arbys-gantt-form-only-customer-binding/v3';
export const FORM_ONLY_BUNDLE_SCHEMA = 'arbys-gantt-local-binding-bundle/v1';
export const PUBLISHER_KEY_ID =
  '0744acf08d55fab5a343900b663ddfe8d28a32d371b74b30091d975da69d646a';
export const PUBLISHER_SPKI_BASE64URL =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXZQEwh45wyaqrU3cbd5W62GG7Dg57xUeRVbdK2G_z2MKnfl1lRRFpUVmACn-DpQ2z3d0Ysk-KpeJsJTVUl_O7A';

const TRACKER_ORIGIN = 'https://rbcochell-ui.github.io';
const TRACKER_PATH = '/arbys-customer-status-preview/';
const DOMAIN = 'arbys-gantt-form-only-binding-envelope/v3';
export const FORM_ONLY_COMMITMENT_DOMAIN =
  'arbys-gantt-form-only-complete-commitment/v3';
const HKDF_SALT = 'arbys-gantt-form-only-binding/hkdf-salt/v3';
const HKDF_INFO = 'arbys-gantt-form-only-binding/aes-256-gcm/v3';
export const FORM_ONLY_TEMPLATE_POLICY_SCHEMA =
  'arbys-gantt-form-only-template-policy/v1';
const SOURCE_WINDOW_MS = 30 * 86_400_000;
const INTENT_ISSUANCE_WINDOW_MS = 86_400_000;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/u;
const STORE = /^[0-9]{1,7}$/u;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/u;
const HEX = /^[0-9a-f]{64}$/u;
const B64 = /^[A-Za-z0-9_-]+$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u;
const PAYLOAD_KEYS = [
  'schema', 'formSourceKey', 'storeNumber', 'recipientName', 'recipientEmail',
  'recipientReview', 'trackerUrl', 'sourceAsOfUtc', 'validUntilUtc',
  'sourceRowSha256', 'bindingManifestSha256', 'bindingFileSha256',
  'carrierSha256', 'sourceEvidenceSha256', 'captureManifestSha256',
  'acceptedAuditSha256', 'chartCipherSha256', 'intentDigest',
  'intentIssuedAtUtc', 'templatePolicy', 'releaseState',
];
const POLICY_KEYS = [
  'schema', 'mode', 'sourceDateUtc', 'maxSourceAgeDays',
  'sourceDateDisplayRequired', 'coordinatorVerificationBeforeSend',
  'pageStatusClaim', 'freshWorkOrderClaimAllowed',
];
const ENVELOPE_KEYS = ['schema', 'nonce', 'ciphertext', 'keyId', 'signature'];

function exactKeys(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every(name => Object.hasOwn(value, name));
}
function bad() { throw new Error('Form-only binding unavailable'); }
function decodeBase64Url(value) {
  if (typeof value !== 'string' || !B64.test(value)) bad();
  const binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') +
    '='.repeat((4 - value.length % 4) % 4));
  const canonical = btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_')
    .replace(/=+$/u, '');
  if (canonical !== value) bad();
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-')
    .replace(/\//gu, '_').replace(/=+$/u, '');
}
function strictUtc(value) {
  if (typeof value !== 'string' || !UTC.test(value)) bad();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || ![
    new Date(time).toISOString(),
    new Date(time).toISOString().replace('.000Z', 'Z'),
  ].includes(value)) bad();
  return time;
}
function trackerUrl(value) {
  let url;
  try { url = new URL(value); } catch { bad(); }
  const query = [...url.searchParams.entries()];
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (url.origin !== TRACKER_ORIGIN || url.pathname !== TRACKER_PATH ||
      url.username || url.password || query.length !== 1 || query[0][0] !== 'p' ||
      !/^p_[0-9a-f]{32}$/u.test(query[0][1]) ||
      fragment.length !== 1 || fragment[0][0] !== 'k' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(fragment[0][1]) ||
      decodeBase64Url(fragment[0][1]).length !== 32 ||
      url.href !== `${TRACKER_ORIGIN}${TRACKER_PATH}?p=${query[0][1]}#k=${fragment[0][1]}`) bad();
  return url.href;
}

export function validateFormOnlyPayload(value, expectedKey, nowMs = Date.now()) {
  if (!exactKeys(value, PAYLOAD_KEYS) ||
      value.schema !== FORM_ONLY_BINDING_SCHEMA ||
      !FORM_KEY.test(value.formSourceKey ?? '') ||
      value.formSourceKey !== expectedKey ||
      !(value.storeNumber === null || STORE.test(value.storeNumber ?? '')) ||
      typeof value.recipientName !== 'string' ||
      value.recipientName.trim() !== value.recipientName ||
      value.recipientName.length < 1 || value.recipientName.length > 120 ||
      /[\x00-\x1f\x7f]/u.test(value.recipientName) ||
      typeof value.recipientEmail !== 'string' ||
      !EMAIL.test(value.recipientEmail) ||
      value.recipientEmail !== value.recipientEmail.toLowerCase() ||
      value.recipientEmail.length > 254 ||
      value.recipientReview !== 'suggestion_only_unverified' ||
      !exactKeys(value.templatePolicy, POLICY_KEYS) ||
      value.templatePolicy.schema !== FORM_ONLY_TEMPLATE_POLICY_SCHEMA ||
      value.templatePolicy.mode !== 'template_only' ||
      value.templatePolicy.maxSourceAgeDays !== 30 ||
      value.templatePolicy.sourceDateDisplayRequired !== true ||
      value.templatePolicy.coordinatorVerificationBeforeSend !== true ||
      value.templatePolicy.pageStatusClaim !== 'FORM_RECEIVED_ONLY' ||
      value.templatePolicy.freshWorkOrderClaimAllowed !== false ||
      value.releaseState !== 'HELD_UNISSUED' ||
      ['sourceRowSha256', 'bindingManifestSha256', 'bindingFileSha256',
        'carrierSha256', 'sourceEvidenceSha256', 'captureManifestSha256',
        'acceptedAuditSha256', 'chartCipherSha256', 'intentDigest']
        .some(k => !HEX.test(value[k] ?? ''))) bad();
  trackerUrl(value.trackerUrl);
  const source = strictUtc(value.sourceAsOfUtc);
  const validUntil = strictUtc(value.validUntilUtc);
  const issued = strictUtc(value.intentIssuedAtUtc);
  if (value.templatePolicy.sourceDateUtc !==
        value.sourceAsOfUtc.slice(0, 10) ||
      !Number.isFinite(nowMs) || validUntil - source !== SOURCE_WINDOW_MS ||
      issued < source || issued - source >= INTENT_ISSUANCE_WINDOW_MS ||
      source > nowMs + 60_000 ||
      nowMs >= validUntil) bad();
  return Object.freeze({...value,
    templatePolicy: Object.freeze({...value.templatePolicy})});
}

function masterKey(masterBytes) {
  if (!(masterBytes instanceof Uint8Array) || masterBytes.length !== 32 ||
      !globalThis.crypto?.subtle) bad();
  return masterBytes;
}
function aad(formSourceKey) {
  if (!FORM_KEY.test(formSourceKey)) bad();
  return new TextEncoder().encode(
    `${FORM_ONLY_BINDING_SCHEMA}\n${formSourceKey}\n${TRACKER_ORIGIN}${TRACKER_PATH}`);
}
async function derive(masterBytes, usage) {
  const key = await crypto.subtle.importKey('raw', masterKey(masterBytes),
    'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(HKDF_SALT),
    info: new TextEncoder().encode(HKDF_INFO)},
  key, {name: 'AES-GCM', length: 256}, false, [usage]);
}

/** The fixed HMAC pins identify the three Unknown FORM selections without
 * putting their plaintext keys in client source. Null is allowed only for
 * those selections; assigning a numeric store to them also fails closed. */
async function checkStoreSelection(value, masterBytes) {
  const digest = await actionSelectionDigest(masterBytes, value.formSourceKey);
  const isUnknown = UNKNOWN_FORM_ONLY_SELECTION_DIGESTS.includes(digest);
  if (isUnknown !== (value.storeNumber === null)) bad();
}

/** The publisher alone may use this pure encryptor, then sign its envelope. */
export async function encryptFormOnlyPayload(value, masterBytes,
    nowMs = Date.now()) {
  const payload = validateFormOnlyPayload(value, value?.formSourceKey, nowMs);
  await checkStoreSelection(payload, masterBytes);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(masterBytes, 'encrypt');
  const cipher = await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce,
    additionalData: aad(payload.formSourceKey), tagLength: 128}, key,
  new TextEncoder().encode(JSON.stringify(payload)));
  return Object.freeze({schema: FORM_ONLY_BINDING_SCHEMA,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(cipher))});
}

/** Fixed-order bytes; one signed binding cannot be replayed for another key. */
export function canonicalFormOnlyEnvelopeBytes(envelope, selectedKey) {
  const unsigned = exactKeys(envelope,
    ['schema', 'nonce', 'ciphertext', 'keyId']);
  const signed = exactKeys(envelope, ENVELOPE_KEYS);
  if ((!unsigned && !signed) || !FORM_KEY.test(selectedKey ?? '') ||
      envelope.schema !== FORM_ONLY_BINDING_SCHEMA ||
      envelope.keyId !== PUBLISHER_KEY_ID ||
      typeof envelope.nonce !== 'string' || envelope.nonce.length !== 16 ||
      decodeBase64Url(envelope.nonce).length !== 12 ||
      typeof envelope.ciphertext !== 'string' ||
      envelope.ciphertext.length < 24 || envelope.ciphertext.length > 3000 ||
      decodeBase64Url(envelope.ciphertext).length < 17) bad();
  return new TextEncoder().encode(JSON.stringify([DOMAIN, selectedKey,
    envelope.schema, envelope.keyId, envelope.nonce, envelope.ciphertext]));
}

async function verifyPinnedEnvelope(envelope, selectedKey) {
  if (!exactKeys(envelope, ENVELOPE_KEYS) ||
      typeof envelope.signature !== 'string' ||
      envelope.signature.length !== 86 ||
      decodeBase64Url(envelope.signature).length !== 64) bad();
  const spki = decodeBase64Url(PUBLISHER_SPKI_BASE64URL);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
  if ([...hash].map(b => b.toString(16).padStart(2, '0')).join('') !==
      PUBLISHER_KEY_ID) bad();
  const key = await crypto.subtle.importKey('spki', spki,
    {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  if (!await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'},
      key, decodeBase64Url(envelope.signature),
      canonicalFormOnlyEnvelopeBytes(envelope, selectedKey))) bad();
}

/** Production trust anchor is fixed; caller-supplied public keys are ignored. */
export async function decryptFormOnlyEnvelope(envelope, masterBytes,
    selectedKey, nowMs = Date.now()) {
  try {
    masterKey(masterBytes);
    await verifyPinnedEnvelope(envelope, selectedKey);
    const key = await derive(masterBytes, 'decrypt');
    const clear = await crypto.subtle.decrypt({name: 'AES-GCM',
      iv: decodeBase64Url(envelope.nonce),
      additionalData: aad(selectedKey), tagLength: 128}, key,
    decodeBase64Url(envelope.ciphertext));
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(clear));
    const payload = validateFormOnlyPayload(value, selectedKey, nowMs);
    await checkStoreSelection(payload, masterBytes);
    return payload;
  } catch { bad(); }
}

/** The independent pin covers the complete recipient, store, URL, Intent,
 * source, chart and 30-day template-only policy. The bundle hash is outside
 * its ciphertext because a self-hash inside the ciphertext is circular. */
export async function formOnlyCommitment(payload, nowMs = Date.now()) {
  const value = validateFormOnlyPayload(payload, payload?.formSourceKey, nowMs);
  const bytes = new TextEncoder().encode(JSON.stringify([
    FORM_ONLY_COMMITMENT_DOMAIN, value.schema, value.formSourceKey,
    value.trackerUrl, value.recipientEmail, value.recipientName,
    value.storeNumber, value.recipientReview, value.intentDigest,
    value.sourceRowSha256, value.bindingManifestSha256,
    value.bindingFileSha256, value.carrierSha256,
    value.sourceEvidenceSha256, value.captureManifestSha256,
    value.acceptedAuditSha256, value.chartCipherSha256,
    value.sourceAsOfUtc, value.validUntilUtc, value.intentIssuedAtUtc,
    value.templatePolicy.schema, value.templatePolicy.mode,
    value.templatePolicy.sourceDateUtc,
    value.templatePolicy.maxSourceAgeDays,
    value.templatePolicy.sourceDateDisplayRequired,
    value.templatePolicy.coordinatorVerificationBeforeSend,
    value.templatePolicy.pageStatusClaim,
    value.templatePolicy.freshWorkOrderClaimAllowed,
    value.releaseState,
  ]));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function checkFormOnlyCommitment(payload, expectedDigest,
    nowMs = Date.now()) {
  if (typeof expectedDigest !== 'string' || !HEX.test(expectedDigest) ||
      await formOnlyCommitment(payload, nowMs) !== expectedDigest) bad();
  return true;
}
async function actionSelectionDigest(masterBytes, selectedKey) {
  masterKey(masterBytes);
  if (!FORM_KEY.test(selectedKey ?? '')) bad();
  const key = await crypto.subtle.importKey('raw', masterBytes,
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const bytes = new TextEncoder().encode(
    ['arbys-gantt-action/v2', 'customer', selectedKey].join('\u0000'));
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Accepts the existing bundle parser's shape but not its pilot-only decoder.
 * Its independent commitments are currently empty, so every action holds.
 */
export async function decryptSelectedFormOnlyBinding(bundle, masterBytes,
    selection) {
  const nowMs = Date.now();
  if (selection?.kind !== 'customer' || !FORM_KEY.test(selection.id ?? '') ||
      !bundle?.customerByKey?.[selection.id]) bad();
  const value = await decryptFormOnlyEnvelope(bundle.customerByKey[selection.id],
    masterBytes, selection.id, nowMs);
  const selectedDigest = await actionSelectionDigest(masterBytes, selection.id);
  await checkFormOnlyCommitment(value,
    PINNED_FORM_ONLY_COMMITMENTS[selectedDigest], nowMs);
  return value;
}
