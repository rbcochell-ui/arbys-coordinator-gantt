/**
 * The one-use marker binds every field in the frozen Sent POST body. A fresh
 * observation may generate another RecordedAtUtc, so the material-only form
 * is used for the final source comparison, never as the marker digest.
 */
export const LEGACY_SENT_FIELDS = Object.freeze([
  'Title', 'ReceiptKey', 'DispatchKey', 'Kind', 'ClaimItemId',
  'ActorOid', 'DraftImmutableId', 'SentImmutableId', 'ActualSubject',
  'ActualBodySha256', 'ActualLinksSha256', 'ActualToJson',
  'ActualCcJson', 'ActualBccJson', 'SentAtUtc',
  'SentInternetMessageId', 'ReviewReason', 'RecordedAtUtc',
  'MigratedFrom',
]);

export const LEGACY_SENT_ATTEMPT_FIELDS = Object.freeze([
  'Title', 'ReceiptKey', 'DispatchKey', 'Kind', 'ClaimItemId',
  'ActorOid', 'DraftImmutableId', 'PlannedSentSha256',
  'RecordedAtUtc', 'MigratedFrom',
]);

const sorted = values => [...values].sort((a, b) =>
  a < b ? -1 : a > b ? 1 : 0);

function canonical(fields, materialOnly) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) ||
      JSON.stringify(sorted(Object.keys(fields))) !==
        JSON.stringify(sorted(LEGACY_SENT_FIELDS))) {
    throw new TypeError('Exact Sent receipt fields required');
  }
  return JSON.stringify(Object.fromEntries(
    Object.entries(fields).filter(([name]) =>
      !materialOnly || name !== 'RecordedAtUtc')
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));
}

export function canonicalSentPlan(fields) { return canonical(fields, false); }
export function canonicalSentMaterial(fields) { return canonical(fields, true); }

export async function sentPlanDigest(fields) {
  const canonical = canonicalSentPlan(fields);
  if (!globalThis.crypto?.subtle?.digest) {
    throw new TypeError('SHA-256 digest unavailable');
  }
  const bytes = new TextEncoder().encode(
    `arbys-legacy-sent-fields/v1\n${canonical}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
