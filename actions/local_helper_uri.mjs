import {COMPOSE_RELEASE} from './action_release.mjs';

// A public chart can identify the selected item, but must not hand Outlook
// recipients, a customer tracker link, or its own decryption key to a URI
// handler. The installed helper resolves and validates those values itself.
const BASE = 'arbysgantt://draft/v1';
const SENT_BASE = 'arbysgantt://sent/v1';
const WO_ID = /^0WO[A-Za-z0-9]{15}$/;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;
// The prior customer pilot and one uncertain canary are held by chart-keyed
// digests. The public source contains no native ID or enumerable plain hash.
// No native ID, recipient, or private tracker link belongs in public source.
// The helper's signed admission independently holds legacy/uncertain cases.
export const ADOPTION_REQUIRED_CUSTOMER_DIGEST =
  '16998cb9608e15cfcd7ee63cd73184719cc3838806d28f914adff7de799b858d';
export const UNCERTAIN_CUSTOMER_DIGEST =
  'e8ca0b2a97845d9d3418d3439168a6526e88192e505e230081249c2565edd9e8';
const DIGEST_RE = /^[0-9a-f]{64}$/u;

export function selectedHandoffHold(selection, digest,
    releaseConfig = COMPOSE_RELEASE) {
  if (!DIGEST_RE.test(digest)) return 'identity_unverified';
  if (selection?.kind === 'provider' &&
      !releaseConfig?.providerDraftDigests?.includes(digest))
    return 'provider_first_draft_held';
  if (selection?.kind === 'customer' &&
      (digest === ADOPTION_REQUIRED_CUSTOMER_DIGEST ||
       digest === UNCERTAIN_CUSTOMER_DIGEST)) return 'adoption_required';
  return null;
}

function buildUri(base, selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) ||
      Object.keys(selection).sort().join(',') !== 'id,kind') {
    throw new TypeError('Only a selected kind and ID may enter the helper URI');
  }
  const {kind, id} = selection;
  if (typeof id !== 'string' || (kind === 'provider' ? !WO_ID.test(id) :
      kind === 'customer' ? !FORM_KEY.test(id) : true)) {
    throw new TypeError('Invalid helper selection');
  }
  return `${base}?kind=${kind}&id=${encodeURIComponent(id)}`;
}

export function buildLocalHelperUri(selection) {
  return buildUri(BASE, selection);
}

export function buildLocalSentUri(selection) {
  return buildUri(SENT_BASE, selection);
}

/** A chart snapshot can select an ID; source freshness is the helper's gate. */
export function buildAllowlistedHandoffUri(selection, allowed,
    action = 'draft') {
  const uri = action === 'draft' ? buildLocalHelperUri(selection) :
    action === 'sent' ? buildLocalSentUri(selection) : null;
  if (uri === null) throw new TypeError('Invalid helper action');
  if (!Array.isArray(allowed?.providerIds) ||
      !Array.isArray(allowed?.customerKeys) ||
      !(selection.kind === 'provider'
        ? allowed.providerIds.includes(selection.id)
        : allowed.customerKeys.includes(selection.id))) {
    throw new TypeError('Selection is not allowlisted by this chart');
  }
  return uri;
}

export function localHandoffEnabled(kind, selection, allowed, release,
    action = 'draft', selectionDigest = null,
    releaseConfig = COMPOSE_RELEASE) {
  if (release !== 'enabled' || selection?.kind !== kind ||
      selectedHandoffHold(selection, selectionDigest, releaseConfig) !== null) return false;
  try { buildAllowlistedHandoffUri(selection, allowed, action); return true; }
  catch { return false; }
}

/** Only a trusted top-level click can invoke the helper; source is not a gate. */
export function requestLocalHandoff({event, kind, action = 'draft', release,
    disabled, selection, selectionDigest, releaseConfig = COMPOSE_RELEASE,
    allowed, topLevel, navigate}) {
  if (release !== 'enabled' || event?.type !== 'click' ||
      event.isTrusted !== true || disabled === true ||
      selection?.kind !== kind ||
      selectedHandoffHold(selection, selectionDigest, releaseConfig) !== null)
    return 'ignored';
  if (topLevel !== true) return 'framed';
  if (typeof navigate !== 'function') throw new TypeError('Navigation is required');
  navigate(buildAllowlistedHandoffUri(selection, allowed, action));
  return 'requested';
}

/** Parse a URI as hostile input; the local helper must still verify its source. */
export function parseLocalHelperUri(raw) {
  if (typeof raw !== 'string' || raw.length > 160) {
    throw new TypeError('Invalid helper URI');
  }
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('Invalid helper URI'); }
  const fields = [...url.searchParams.entries()];
  if (url.protocol !== 'arbysgantt:' || url.hostname !== 'draft' ||
      url.pathname !== '/v1' || url.username || url.password || url.port ||
      url.hash || fields.length !== 2 || fields[0][0] !== 'kind' ||
      fields[1][0] !== 'id') {
    throw new TypeError('Invalid helper URI');
  }
  const selection = {kind: fields[0][1], id: fields[1][1]};
  // The exact canonical spelling rejects duplicate/encoded parameter names,
  // unknown fields, alternate hosts, and normalization surprises.
  if (raw !== buildLocalHelperUri(selection)) {
    throw new TypeError('Invalid helper URI');
  }
  return Object.freeze(selection);
}

export function parseLocalSentUri(raw) {
  if (typeof raw !== 'string' || raw.length > 160) {
    throw new TypeError('Invalid helper URI');
  }
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('Invalid helper URI'); }
  const fields = [...url.searchParams.entries()];
  if (url.protocol !== 'arbysgantt:' || url.hostname !== 'sent' ||
      url.pathname !== '/v1' || url.username || url.password || url.port ||
      url.hash || fields.length !== 2 || fields[0][0] !== 'kind' ||
      fields[1][0] !== 'id') {
    throw new TypeError('Invalid helper URI');
  }
  const selection = {kind: fields[0][1], id: fields[1][1]};
  if (raw !== buildLocalSentUri(selection)) {
    throw new TypeError('Invalid helper URI');
  }
  return Object.freeze(selection);
}
