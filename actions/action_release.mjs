// The public page never decides who may write a draft. These digest lists only
// decide which buttons it shows. The installed helper independently verifies
// its signed actor grant, positive admission, shared Claim and source.
// No native IDs or contact details belong in this public release record.
// All lists and release flags stay held until the attended paths are proven.
export const COMPOSE_RELEASE = Object.freeze({
  provider: 'held_existing_draft',
  customer: 'held_existing_draft',
  sent: 'held_receipt_unverified',
  providerDraftDigests: Object.freeze([]),
  customerDraftDigests: Object.freeze([]),
  providerSentDigests: Object.freeze([]),
  customerSentDigests: Object.freeze([]),
});

const DIGEST_RE = /^[0-9a-f]{64}$/u;

/** Chart-keyed digest for one exact native ID, computed only in memory. */
export async function digestSelection(selection, chartKeyBytes) {
  if (!selection || typeof selection.id !== 'string' ||
      !['provider', 'customer'].includes(selection.kind) ||
      !(chartKeyBytes instanceof Uint8Array) || chartKeyBytes.length !== 32 ||
      !globalThis.crypto?.subtle) throw new TypeError('Invalid selection');
  const bytes = new TextEncoder().encode(
    ['arbys-gantt-action/v2', selection.kind, selection.id].join('\u0000'));
  const key = await globalThis.crypto.subtle.importKey('raw', chartKeyBytes,
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const hash = await globalThis.crypto.subtle.sign('HMAC', key, bytes);
  return Array.from(new Uint8Array(hash), byte =>
    byte.toString(16).padStart(2, '0')).join('');
}

/** A future release must name each reviewed digest; a flag alone enables none. */
export function releaseForSelection(action, selection, digest,
    release = COMPOSE_RELEASE) {
  if (!selection || (selection.kind !== 'provider' &&
      selection.kind !== 'customer') ||
      (action !== 'draft' && action !== 'sent') ||
      !DIGEST_RE.test(digest)) return 'held';
  const flag = action === 'sent' ? release.sent : release[selection.kind];
  const field = action === 'sent'
    ? selection.kind === 'provider' ? 'providerSentDigests' : 'customerSentDigests'
    : selection.kind === 'provider' ? 'providerDraftDigests' : 'customerDraftDigests';
  const digests = release[field];
  return flag === 'enabled' && Array.isArray(digests) &&
    digests.includes(digest) ? 'enabled' : 'held';
}
