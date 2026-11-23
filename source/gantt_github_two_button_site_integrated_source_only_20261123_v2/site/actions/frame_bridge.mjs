export const FRAME_SELECTION_CHANNEL = 'arbys.gantt.selection.v1';

/** The opaque-origin chart can select an allowlisted ID. It has no action API. */
export function createFrameSelectionBridge({hostWindow, frame,
    allowedProviderIds, allowedCustomerKeys, onSelection = () => {}}) {
  if (!hostWindow?.addEventListener || !hostWindow?.removeEventListener ||
      !frame?.contentWindow || typeof onSelection !== 'function') {
    throw new TypeError('Parent window, sandboxed frame, and selection callback are required');
  }
  const providers = new Set(allowedProviderIds ?? []);
  const customers = new Set(allowedCustomerKeys ?? []);
  let selection = null;
  let disposed = false;

  function onMessage(event) {
    if (disposed || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (data?.channel !== FRAME_SELECTION_CHANNEL || data.type !== 'select' ||
        typeof data.id !== 'string') return;
    if (data.kind === 'provider' && providers.has(data.id)) {
      selection = Object.freeze({kind: 'provider', id: data.id});
    } else if (data.kind === 'customer' && customers.has(data.id)) {
      selection = Object.freeze({kind: 'customer', id: data.id});
    } else {
      selection = null;
    }
    onSelection(selection ? {...selection} : null);
  }

  hostWindow.addEventListener('message', onMessage);
  return Object.freeze({
    getSelection: () => selection ? {...selection} : null,
    dispose() {
      if (disposed) return;
      disposed = true;
      hostWindow.removeEventListener('message', onMessage);
      selection = null;
    },
  });
}
