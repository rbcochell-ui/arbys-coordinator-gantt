import {decryptGantt} from '../site/crypto.mjs';

const MAX_CIPHERTEXT_BYTES = 1_700_000;

/** Fetch exact served ciphertext bytes and decrypt only in the parent. */
export function createAuthenticatedChartLoader({capabilityKey, payloadUrl,
    fetchImpl = globalThis.fetch, now = () => Date.now()} = {}) {
  if (!(capabilityKey instanceof Uint8Array) ||
      capabilityKey.byteLength !== 32 ||
      typeof payloadUrl !== 'string' ||
      typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw new TypeError('Exact chart loader inputs required');
  }
  const base = new URL(payloadUrl);
  const loopbackHttp = base.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.hash || base.search || base.username || base.password ||
      base.href !== payloadUrl ||
      !(base.protocol === 'https:' || loopbackHttp)) {
    throw new TypeError('Exact chart asset URL required');
  }
  const key = new Uint8Array(capabilityKey);
  return async function loadAuthenticatedChart() {
    const requestUrl = new URL(base.href);
    requestUrl.searchParams.set('fresh', String(now()));
    const response = await fetchImpl(requestUrl.href, {
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (response?.status !== 200 || response.url !== requestUrl.href) {
      throw new Error('ENCRYPTED_CHART_READ_UNVERIFIED');
    }
    const declared = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CIPHERTEXT_BYTES) {
      throw new Error('ENCRYPTED_CHART_TOO_LARGE');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_CIPHERTEXT_BYTES) {
      throw new Error('ENCRYPTED_CHART_TOO_LARGE');
    }
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const html = await decryptGantt(JSON.parse(raw), key);
    return Object.freeze({html, encryptedPayloadBytes: bytes,
      encryptedPayloadUrl: base.href});
  };
}
