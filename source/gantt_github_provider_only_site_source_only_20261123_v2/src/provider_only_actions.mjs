/**
 * Narrow provider-only adapter for an attended GitHub Pages coordinator UI.
 * The protected WO Source and Contacts Lists remain the draft authority.
 */
import {LeanGanttActions} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/actions.mjs';
import {canonicalSalesforceId, email, HeldActionError} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';

function held(code) { throw new HeldActionError(code); }
const SHA = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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

/** The exact source values displayed in the parent are the click contract. */
export function makeProviderPreviewBinding(source, cohort, nowMs) {
  requireVerifiedRolePair(source);
  if (!SHA.test(source.digest ?? '') ||
      typeof source.etagsJson !== 'string' ||
      source.etagsJson.length < 1 || source.etagsJson.length > 2048 ||
      !SHA.test(cohort?.releaseBinding ?? '') ||
      !Number.isFinite(cohort?.validUntilMs) ||
      !Number.isFinite(nowMs) ||
      !/^[0-9]+$/u.test(source.storeNumber ?? '') ||
      typeof source.workOrderStatus !== 'string' ||
      !source.workOrderStatus.trim() ||
      typeof source.observedAtUtc !== 'string' ||
      !UTC.test(source.observedAtUtc) ||
      !Number.isFinite(Date.parse(source.observedAtUtc))) {
    held('PROVIDER_PREVIEW_BINDING_INCOMPLETE');
  }
  try {
    if (!object(JSON.parse(source.etagsJson))) throw new Error();
  } catch { held('PROVIDER_PREVIEW_BINDING_INCOMPLETE'); }
  const validUntilMs = Math.min(source.validUntilMs, cohort.validUntilMs);
  if (validUntilMs <= nowMs) held('PROVIDER_PREVIEW_WINDOW_EXPIRED');
  return Object.freeze({nativeWoId: source.nativeWoId,
    woNumber: source.woNumber, storeNumber: source.storeNumber,
    agentCode: source.agentCode, workOrderStatus: source.workOrderStatus,
    observedAtUtc: source.observedAtUtc, to: Object.freeze([...source.to]),
    sourceDigest: source.digest, sourceETagsJson: source.etagsJson,
    releaseBinding: cohort.releaseBinding, validUntilMs});
}

export function assertProviderPreviewBinding(binding, nativeWoId, nowMs) {
  if (!object(binding) || binding.nativeWoId !== nativeWoId ||
      !Number.isFinite(binding.validUntilMs) ||
      !Number.isFinite(nowMs) || nowMs >= binding.validUntilMs ||
      !SHA.test(binding.sourceDigest ?? '') ||
      !SHA.test(binding.releaseBinding ?? '') ||
      typeof binding.sourceETagsJson !== 'string' ||
      binding.sourceETagsJson.length < 1 ||
      binding.sourceETagsJson.length > 2048) {
    held('PROVIDER_PREVIEW_BINDING_REQUIRED');
  }
  const source = {nativeWoId: binding.nativeWoId,
    woNumber: binding.woNumber, storeNumber: binding.storeNumber,
    agentCode: binding.agentCode, workOrderStatus: binding.workOrderStatus,
    observedAtUtc: binding.observedAtUtc, to: binding.to,
    recipientReviewRequired: false, digest: binding.sourceDigest,
    etagsJson: binding.sourceETagsJson,
    validUntilMs: binding.validUntilMs};
  const clean = makeProviderPreviewBinding(source, {
    releaseBinding: binding.releaseBinding,
    validUntilMs: binding.validUntilMs,
  }, nowMs);
  if (Object.keys(binding).length !== Object.keys(clean).length ||
      Object.keys(binding).some(key => !Object.hasOwn(clean, key))) {
    held('PROVIDER_PREVIEW_BINDING_REQUIRED');
  }
  return clean;
}

export function assertSourceMatchesPreview(source, binding) {
  requireVerifiedRolePair(source);
  if (source.nativeWoId !== binding.nativeWoId ||
      source.woNumber !== binding.woNumber ||
      source.storeNumber !== binding.storeNumber ||
      source.agentCode !== binding.agentCode ||
      source.workOrderStatus !== binding.workOrderStatus ||
      source.observedAtUtc !== binding.observedAtUtc ||
      source.digest !== binding.sourceDigest ||
      source.etagsJson !== binding.sourceETagsJson ||
      source.to.length !== 2 ||
      source.to.some((address, index) => address !== binding.to[index])) {
    held('PROVIDER_SOURCE_CHANGED_SINCE_PREVIEW');
  }
  return source;
}

export function strictProviderSource(source, {binding = null,
    cohortPolicy = null, graph = null} = {}) {
  if (typeof source?.resolve !== 'function' ||
      typeof source?.confirmUnchanged !== 'function') {
    throw new TypeError('Protected provider source required');
  }
  if (binding && typeof cohortPolicy?.assertAllowed !== 'function') {
    throw new TypeError('Protected cohort policy required for bound action');
  }
  async function checked(read, nativeWoId, actor) {
    if (binding) await cohortPolicy.assertAllowed(nativeWoId, graph,
      binding.releaseBinding);
    const current = requireVerifiedRolePair(await read());
    if (binding) {
      assertSourceMatchesPreview(current, binding);
      await cohortPolicy.assertAllowed(nativeWoId, graph,
        binding.releaseBinding);
    }
    return current;
  }
  return Object.freeze({
    async resolve(nativeWoId, actor) {
      return checked(() => source.resolve(nativeWoId, actor), nativeWoId, actor);
    },
    async confirmUnchanged(previous, actor) {
      return checked(() => source.confirmUnchanged(previous, actor),
        previous.nativeWoId, actor);
    },
  });
}

/**
 * Every underlying provider read is strict, including the after-Claim reread.
 * Customer actions remain held even if a caller bypasses the UI allowlist.
 */
export class ProviderOnlyActions extends LeanGanttActions {
  constructor(options) {
    super(options);
    this.cohortPolicy = options.cohortPolicy ?? null;
    this.expectedPreview = options.expectedPreview ?? null;
  }

  async _context(action = 'provider') {
    if (action !== 'provider') held('CUSTOMER_ACTIONS_NOT_RELEASED');
    const context = await super._context('provider');
    return {...context, source: strictProviderSource(context.source, {
      binding: this.expectedPreview, cohortPolicy: this.cohortPolicy,
      graph: context.graph,
    })};
  }

  async _cohort(nativeWoId, graph, expectedReleaseBinding = null) {
    if (typeof this.cohortPolicy?.assertAllowed !== 'function') {
      held('PROVIDER_COHORT_NOT_CONFIGURED');
    }
    return this.cohortPolicy.assertAllowed(nativeWoId, graph,
      expectedReleaseBinding);
  }

  async preview(kind, nativeWoId) {
    if (kind !== 'provider') held('CUSTOMER_ACTIONS_NOT_RELEASED');
    await this._cohort(nativeWoId, this.graph.bindAccount());
    return super.preview(kind, nativeWoId);
  }

  /** A second protected read supplies the visible, current WO review fields. */
  async providerPreviewDetails(nativeWoId) {
    const context = await this._context('provider');
    const cohort = await this._cohort(nativeWoId, context.graph);
    const source = await context.source.resolve(nativeWoId, context.actor);
    await this._cohort(nativeWoId, context.graph, cohort.releaseBinding);
    const binding = makeProviderPreviewBinding(source, cohort, this.now());
    return Object.freeze({
      nativeWoId: source.nativeWoId,
      woNumber: source.woNumber,
      storeNumber: source.storeNumber,
      agentCode: source.agentCode,
      workOrderStatus: source.workOrderStatus,
      observedAtUtc: source.observedAtUtc,
      to: Object.freeze([...source.to]),
      validUntilMs: binding.validUntilMs,
      binding,
    });
  }

  async providerDraft() { held('PROVIDER_PREVIEW_BINDING_REQUIRED'); }

  /**
   * Reread the protected preview before entering the inherited Claim path.
   * The bound instance enforces the same values on the pre/post-Claim reads.
   * Existing draft reopen still uses the inherited occupied-Claim path.
   */
  async providerDraftWithPreview(command) {
    if (!object(command) || Object.keys(command).length !== 2 ||
        typeof command.id !== 'string') {
      held('PROVIDER_PREVIEW_BINDING_REQUIRED');
    }
    const binding = assertProviderPreviewBinding(command.binding,
      command.id, this.now());
    const before = await this._context('provider');
    await this._cohort(command.id, before.graph, binding.releaseBinding);
    assertSourceMatchesPreview(await before.source.resolve(command.id,
      before.actor), binding);
    await this._cohort(command.id, before.graph, binding.releaseBinding);

    const bound = new ProviderOnlyActions({config: this.config,
      graph: this.graph, now: this.now, randomUUID: this.randomUUID,
      domParserClass: this.domParserClass,
      loadLegacyFenceProof: this.loadLegacyFenceProof,
      legacyOwnerRecovery: this.legacyOwnerRecovery,
      cohortPolicy: this.cohortPolicy, expectedPreview: binding});
    const result = await LeanGanttActions.prototype.providerDraft.call(
      bound, command.id);
    // In the occupied path the inherited reader reports source changes as
    // review advice. A click whose displayed source changed must instead
    // hold before revealing that old draft link.
    const after = await this._context('provider');
    await this._cohort(command.id, after.graph, binding.releaseBinding);
    assertSourceMatchesPreview(await after.source.resolve(command.id,
      after.actor), binding);
    await this._cohort(command.id, after.graph, binding.releaseBinding);
    return result;
  }
}
