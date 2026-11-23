/**
 * Narrow provider-only adapter for an attended GitHub Pages coordinator UI.
 * The protected WO Source and Contacts Lists remain the draft authority.
 */
import {LeanGanttActions} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/actions.mjs';
import {canonicalSalesforceId, email, HeldActionError} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';

function held(code) { throw new HeldActionError(code); }

/** Reject a missing or collapsed role pair before a Claim or Outlook write. */
export function requireVerifiedRolePair(source) {
  let validIdentity = false;
  let validTo = false;
  try {
    validIdentity = canonicalSalesforceId(source?.nativeWoId) ===
      source?.nativeWoId;
    validTo = Array.isArray(source?.to) && source.to.length === 2 &&
      source.to.every(value => email(value) === value);
  } catch { /* The protected source must be complete. */ }
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      source.recipientReviewRequired !== false ||
      !validTo ||
      source.to[0] === source.to[1] ||
      !validIdentity || !source.nativeWoId.startsWith('0WO') ||
      !/^[0-9]{5,12}$/u.test(source.woNumber ?? '') ||
      !/^[A-Z][A-Z0-9]{0,9}$/u.test(source.agentCode ?? '') ||
      !Number.isFinite(source.validUntilMs)) {
    held('PROVIDER_ROLE_PAIR_NOT_VERIFIED');
  }
  return source;
}

export function strictProviderSource(source) {
  if (typeof source?.resolve !== 'function' ||
      typeof source?.confirmUnchanged !== 'function') {
    throw new TypeError('Protected provider source required');
  }
  return Object.freeze({
    async resolve(nativeWoId, actor) {
      return requireVerifiedRolePair(await source.resolve(nativeWoId, actor));
    },
    async confirmUnchanged(previous, actor) {
      return requireVerifiedRolePair(
        await source.confirmUnchanged(previous, actor));
    },
  });
}

/**
 * Every underlying provider read is strict, including the after-Claim reread.
 * Customer actions remain held even if a caller bypasses the UI allowlist.
 */
export class ProviderOnlyActions extends LeanGanttActions {
  async _context(action = 'provider') {
    if (action !== 'provider') held('CUSTOMER_ACTIONS_NOT_RELEASED');
    const context = await super._context('provider');
    return {...context, source: strictProviderSource(context.source)};
  }

  /** A second protected read supplies the visible, current WO review fields. */
  async providerPreviewDetails(nativeWoId) {
    const context = await this._context('provider');
    const source = await context.source.resolve(nativeWoId, context.actor);
    return Object.freeze({
      nativeWoId: source.nativeWoId,
      woNumber: source.woNumber,
      storeNumber: source.storeNumber,
      agentCode: source.agentCode,
      workOrderStatus: source.workOrderStatus,
      observedAtUtc: source.observedAtUtc,
      to: Object.freeze([...source.to]),
      validUntilMs: source.validUntilMs,
    });
  }
}
