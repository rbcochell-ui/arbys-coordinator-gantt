import {HeldActionError} from './contract.mjs';

const CHANNEL = 'arbys.gantt.selection.v1';

/**
 * The chart is a sandboxed opaque-origin iframe. Its message can SELECT an
 * already allowlisted ID, but can never itself create a draft or receive a
 * Graph token, private tracker URL, or Outlook draft link. A trusted button
 * in the Pages parent invokes runSelectedFromParentClick(event) explicitly.
 */
export function createFrameSelectionBridge({hostWindow, frame, actions,
    allowedProviderIds, allowedCustomerKeys, onSelection = () => {}}) {
  if (!hostWindow?.addEventListener || !hostWindow?.removeEventListener ||
      !frame?.contentWindow || !actions?.createOrOpenProviderDraft ||
      !actions?.createOrOpenCustomerDraft || typeof onSelection !== 'function') {
    throw new TypeError('Trusted parent window, frame, and actions are required');
  }
  const providers = new Set(allowedProviderIds ?? []);
  const customers = new Set(allowedCustomerKeys ?? []);
  let selection = null;
  let busy = false;

  function onMessage(event) {
    if (event.source !== frame.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (data?.channel !== CHANNEL || data.type !== 'select' || typeof data.id !== 'string') return;
    if (data.kind === 'provider' && providers.has(data.id)) {
      selection = {kind: 'provider', id: data.id};
    } else if (data.kind === 'customer' && customers.has(data.id)) {
      selection = {kind: 'customer', id: data.id};
    } else {
      selection = null;
    }
    onSelection(selection);
  }

  hostWindow.addEventListener('message', onMessage);
  return Object.freeze({
    getSelection() { return selection ? {...selection} : null; },
    async runSelectedFromParentClick(event) {
      if (event?.type !== 'click' || event.isTrusted !== true) {
        throw new HeldActionError('PARENT_CLICK_REQUIRED');
      }
      if (!selection) throw new HeldActionError('NO_ALLOWED_SELECTION');
      if (busy) throw new HeldActionError('ACTION_IN_PROGRESS');
      busy = true;
      try {
        return selection.kind === 'provider'
          ? await actions.createOrOpenProviderDraft(selection.id)
          : await actions.createOrOpenCustomerDraft(selection.id);
      } finally { busy = false; }
    },
    dispose() {
      hostWindow.removeEventListener('message', onMessage);
      selection = null;
    },
  });
}

export {CHANNEL as FRAME_SELECTION_CHANNEL};
