/**
 * Keep the V2 draft/receipt normalization, but require a visible current WO
 * read before either creating or reopening a provider draft from the chart.
 */
import {AdapterHeldError, createV2ParentAdapter} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/snapshot_parent_adapter.mjs';

function held(code) { throw new AdapterHeldError(code); }
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u;

export function createProviderOnlyParentAdapter({enabled = false, actions = null,
    signIn = null, now = () => Date.now()} = {}) {
  const providerFlow = enabled === true ? Object.freeze({
    preview: id => actions.preview('provider', id),
    draft: command => actions.providerDraftWithPreview(command),
    checkSent: id => actions.checkSent(id),
  }) : null;
  const base = createV2ParentAdapter({enabled, actions, signIn, providerFlow});
  if (!base.enabled) return base;
  if (typeof actions?.providerPreviewDetails !== 'function' ||
      typeof actions?.providerDraftWithPreview !== 'function' ||
      typeof now !== 'function') {
    throw new TypeError('Current protected provider preview is required');
  }
  let lastPreview = null;
  return Object.freeze({...base,
    async preview(kind, id) {
      if (kind !== 'provider') held('CUSTOMER_ACTIONS_NOT_RELEASED');
      lastPreview = null;
      const first = await base.preview(kind, id);
      if (!['eligible', 'draft_occupied'].includes(first.status)) return first;
      const detail = await actions.providerPreviewDetails(id);
      if (!detail || detail.nativeWoId !== id ||
          !/^[0-9]{5,12}$/u.test(detail.woNumber ?? '') ||
          !/^[A-Z][A-Z0-9]{0,9}$/u.test(detail.agentCode ?? '') ||
          !/^[0-9]+$/u.test(detail.storeNumber ?? '') ||
          typeof detail.workOrderStatus !== 'string' ||
          !detail.workOrderStatus.trim() ||
          typeof detail.observedAtUtc !== 'string' ||
          !UTC.test(detail.observedAtUtc) ||
          !Number.isFinite(Date.parse(detail.observedAtUtc)) ||
          !Array.isArray(detail.to) || detail.to.length !== 2 ||
          detail.to[0] === detail.to[1] ||
          !Number.isFinite(detail.validUntilMs) ||
          !detail.binding ||
          detail.binding.nativeWoId !== id ||
          detail.binding.woNumber !== detail.woNumber ||
          detail.binding.storeNumber !== detail.storeNumber ||
          detail.binding.agentCode !== detail.agentCode ||
          detail.binding.workOrderStatus !== detail.workOrderStatus ||
          detail.binding.observedAtUtc !== detail.observedAtUtc ||
          detail.binding.validUntilMs !== detail.validUntilMs ||
          !Array.isArray(detail.binding.to) ||
          detail.binding.to.length !== 2 ||
          detail.binding.to.some((address, index) =>
            address !== detail.to[index])) {
        held('PROVIDER_PREVIEW_INCOMPLETE');
      }
      if (first.status === 'eligible' &&
          (first.storeNumber !== detail.storeNumber ||
            first.to.length !== 2 ||
            first.to.some((address, index) =>
              address !== detail.to[index]))) {
        held('PROVIDER_PREVIEW_CHANGED_DURING_READ');
      }
      const firstExpiry = first.status === 'eligible'
        ? Date.parse(first.validUntilUtc) : detail.validUntilMs;
      const validUntilMs = Math.min(firstExpiry, detail.validUntilMs);
      if (!(validUntilMs > now())) held('PROVIDER_PREVIEW_WINDOW_EXPIRED');
      const binding = Object.freeze({...detail.binding, validUntilMs});
      const result = Object.freeze({...first, storeNumber: detail.storeNumber,
        woNumber: detail.woNumber, agentCode: detail.agentCode,
        workOrderStatus: detail.workOrderStatus,
        observedAtUtc: detail.observedAtUtc,
        to: Object.freeze([...detail.to]), cc: Object.freeze([]),
        recipientReviewRequired: false,
        validUntilUtc: new Date(validUntilMs).toISOString(),
        binding});
      lastPreview = {id, binding};
      return result;
    },
    async createOrOpenProviderDraft(id, binding) {
      if (lastPreview?.id !== id || binding !== lastPreview.binding ||
          !Number.isFinite(binding?.validUntilMs) ||
          now() >= binding.validUntilMs) {
        held('PROVIDER_PREVIEW_BINDING_REQUIRED');
      }
      lastPreview = null;
      return base.createOrOpenProviderDraft({id, binding});
    },
    async createOrOpenCustomerDraft() {
      held('CUSTOMER_ACTIONS_NOT_RELEASED');
    },
    async verifySentBySelection(kind, id) {
      if (kind !== 'provider') held('CUSTOMER_ACTIONS_NOT_RELEASED');
      return base.verifySentBySelection(kind, id);
    },
  });
}
