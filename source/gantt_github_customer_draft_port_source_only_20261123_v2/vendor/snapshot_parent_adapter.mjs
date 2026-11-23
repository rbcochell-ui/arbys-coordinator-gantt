const PREVIEW_STATUSES = new Set([
  'eligible', 'draft_occupied', 'draft_status_unverified',
  'legacy_occupied', 'claim_outcome_unverified',
  'sent_recorded_unverified', 'sent',
  'sent_with_changes',
]);
const DRAFT_STATUSES = new Set([
  'draft', 'recipient_review_required', 'draft_review_required',
  'source_changed_review_required', 'legacy_draft_review_required',
]);
const HELD_REASONS = Object.freeze({
  not_started: 'NOT_STARTED',
  draft_status_unverified: 'DRAFT_OWNED_ELSEWHERE',
  legacy_occupied: 'LEGACY_OCCUPIED',
  claim_outcome_unverified: 'CLAIM_OUTCOME_UNVERIFIED',
  sent_recorded_unverified: 'SHARED_SENT_RECORD_UNVERIFIED',
  unresolved: 'SENT_STATE_UNRESOLVED',
});

export class AdapterHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AdapterHeldError';
    this.code = code;
  }
}
function fail(code) { throw new AdapterHeldError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function outlookLink(value) {
  if (typeof value !== 'string' || value.length > 4096) fail('OUTLOOK_LINK_INVALID');
  let url;
  try { url = new URL(value); }
  catch { fail('OUTLOOK_LINK_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      !['outlook.office.com', 'outlook.office365.com'].includes(url.hostname)) {
    fail('OUTLOOK_LINK_INVALID');
  }
  return url.href;
}
function requireAddresses(values) {
  if (!Array.isArray(values) || values.length > 20 ||
      values.some(value => typeof value !== 'string' || value.length > 254)) {
    fail('PREVIEW_RECIPIENTS_INVALID');
  }
  return Object.freeze([...values]);
}
function customerBinding(value, id, to, validUntilUtc) {
  const keys = ['formSourceKey', 'sourceDigest', 'sourceETagsJson',
    'recipientEmail', 'trackerUrlSha256', 'validUntilMs'];
  if (!object(value) || Object.keys(value).length !== keys.length ||
      keys.some(name => !Object.hasOwn(value, name)) ||
      value.formSourceKey !== id ||
      !/^[0-9a-f]{64}$/u.test(value.sourceDigest ?? '') ||
      !/^[0-9a-f]{64}$/u.test(value.trackerUrlSha256 ?? '') ||
      typeof value.sourceETagsJson !== 'string' ||
      !value.sourceETagsJson || value.sourceETagsJson.length > 4096 ||
      value.recipientEmail !== to[0] || to.length !== 1 ||
      !Number.isSafeInteger(value.validUntilMs) ||
      value.validUntilMs !== Date.parse(validUntilUtc)) {
    fail('CUSTOMER_PREVIEW_BINDING_INVALID');
  }
  return Object.freeze(Object.fromEntries(keys.map(name =>
    [name, value[name]])));
}
function normalizeResult(result) {
  if (!object(result) || typeof result.status !== 'string') {
    fail('V2_RESULT_UNVERIFIED');
  }
  if (DRAFT_STATUSES.has(result.status)) {
    return Object.freeze({
      state: 'draft', reviewState: result.status,
      webLink: outlookLink(result.webLink),
      recipientReviewRequired: result.recipientReviewRequired === true ||
        result.status === 'recipient_review_required',
      contentReviewRequired: result.contentReviewRequired === true ||
        result.status === 'legacy_draft_review_required' ||
        ['draft_review_required', 'source_changed_review_required']
          .includes(result.status),
    });
  }
  if (result.status === 'sent' || result.status === 'sent_with_changes') {
    return Object.freeze({state: result.status});
  }
  if (Object.hasOwn(HELD_REASONS, result.status)) {
    return Object.freeze({state: 'held', reason: HELD_REASONS[result.status]});
  }
  fail('V2_RESULT_STATUS_UNVERIFIED');
}

/**
 * Versioned V2 parent adapter for the snapshot provider route. It preserves
 * the atomic providerFlow boundary and permits an explicitly missing store
 * number; the exact charted native WO remains the action identity.
 */
export function createV2ParentAdapter({enabled = false, actions = null,
    signIn = null, providerFlow = null} = {}) {
  if (enabled !== true) {
    const disabled = () => fail('RUNTIME_DISABLED');
    return Object.freeze({
      enabled: false,
      signInFromClick: disabled, preview: disabled,
      createOrOpenProviderDraft: disabled,
      createOrOpenCustomerDraft: disabled,
      verifySentBySelection: disabled,
    });
  }
  const baseMethods = providerFlow
    ? ['preview', 'customerDraft', 'checkCustomerSent']
    : ['preview', 'providerDraft', 'customerDraft', 'checkSent',
      'checkCustomerSent'];
  if (typeof signIn !== 'function' || !actions ||
      baseMethods.some(name => typeof actions[name] !== 'function') ||
      (providerFlow !== null &&
        (!object(providerFlow) || ['preview', 'draft', 'checkSent']
          .some(name => typeof providerFlow[name] !== 'function')))) {
    throw new TypeError('V2 actions and interactive sign-in callback are required');
  }
  // The alternate provider route must replace all three operations together.
  // A dated snapshot preview alone must never arm a different draft writer.
  const provider = providerFlow ?? Object.freeze({
    preview: id => actions.preview('provider', id),
    draft: id => actions.providerDraft(id),
    checkSent: id => actions.checkSent(id),
  });
  let signedIn = false;
  function requireSignIn() {
    if (!signedIn) fail('SIGN_IN_REQUIRED');
  }
  return Object.freeze({
    enabled: true,
    async signInFromClick() {
      await signIn();
      signedIn = true;
    },
    async preview(kind, id) {
      requireSignIn();
      if (kind !== 'provider' && kind !== 'customer') fail('ACTION_KIND_INVALID');
      const result = kind === 'provider'
        ? await provider.preview(id) : await actions.preview(kind, id);
      if (!object(result) || result.kind !== kind || result.id !== id ||
          !PREVIEW_STATUSES.has(result.status) || result.webLink) {
        fail('V2_PREVIEW_UNVERIFIED');
      }
      const to = requireAddresses(result.to);
      const cc = requireAddresses(result.cc);
      if (result.status === 'eligible' && kind === 'provider' &&
          result.storeNumber !== null &&
          (typeof result.storeNumber !== 'string' ||
            !result.storeNumber.trim())) fail('PROVIDER_PREVIEW_INCOMPLETE');
      if (result.status === 'eligible' &&
          (typeof result.validUntilUtc !== 'string' ||
            !Number.isFinite(Date.parse(result.validUntilUtc)))) {
        fail('PREVIEW_WINDOW_UNVERIFIED');
      }
      const binding = kind === 'customer' && result.status === 'eligible' ?
        customerBinding(result.binding, id, to, result.validUntilUtc) : null;
      return Object.freeze({
        kind, id, status: result.status,
        canDraft: result.status === 'eligible' ||
          result.status === 'draft_occupied',
        storeNumber: typeof result.storeNumber === 'string' ?
          result.storeNumber : null,
        to, cc,
        recipientReviewRequired: result.recipientReviewRequired === true,
        validUntilUtc: result.status === 'eligible'
          ? result.validUntilUtc : null,
        binding,
      });
    },
    async createOrOpenProviderDraft(id) {
      requireSignIn();
      return normalizeResult(await provider.draft(id));
    },
    async createOrOpenCustomerDraft(id, binding) {
      requireSignIn();
      return normalizeResult(await actions.customerDraft(id, binding));
    },
    async verifySentBySelection(kind, id) {
      requireSignIn();
      if (kind === 'provider') return normalizeResult(await provider.checkSent(id));
      if (kind === 'customer') return normalizeResult(await actions.checkCustomerSent(id));
      fail('ACTION_KIND_INVALID');
    },
  });
}
