import {decryptGantt, parseCapabilityHref} from './crypto.mjs';
import {parseSelectionConfig} from './selection_config.mjs';
import {createFrameSelectionBridge} from './actions/frame_bridge.mjs';

const status = document.getElementById('status');
const workspace = document.getElementById('workspace');
const frame = document.getElementById('chart');
const selectionText = document.getElementById('selection');
const openExternal = document.getElementById('openExternal');
const selectedIdentity = document.getElementById('selectedIdentity');
const selectedStore = document.getElementById('selectedStore');
const selectedRecipients = document.getElementById('selectedRecipients');
const draftAction = document.getElementById('draftAction');
let bridge;

function showSelection(value) {
  selectionText.textContent = value
    ? `${value.kind === 'provider' ? 'Work order' : 'FORM project'} selected for review.`
    : 'Select a project or work order draft button in the chart.';
  selectedIdentity.textContent = value
    ? `Exact source ID: ${value.id}` : 'Exact source ID: none selected';
  selectedStore.textContent = 'Store: unverified';
  selectedRecipients.textContent = 'Intended recipients: unverified';
  draftAction.disabled = true;
}

function unavailable() {
  bridge?.dispose();
  bridge = undefined;
  showSelection(null);
  frame.hidden = true;
  frame.removeAttribute('srcdoc');
  workspace.hidden = true;
  status.hidden = false;
  status.querySelector('h1').textContent = 'Timeline unavailable';
  status.querySelector('p').textContent = 'Check that you opened the complete link. Ask your coordinator for a new link if this continues.';
}

async function open() {
  try {
    const key = parseCapabilityHref(window.location.href);
    const dataUrl = new URL('./data/gantt.enc.json', window.location.href);
    dataUrl.searchParams.set('fresh', String(Date.now()));
    const response = await fetch(dataUrl, {
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) throw new Error('Encrypted chart unavailable');
    const body = await response.text();
    if (body.length > 1_700_000) throw new Error('Encrypted chart too large');
    const html = await decryptGantt(JSON.parse(body), key);
    const allowed = parseSelectionConfig(html);
    // This candidate deliberately has no Graph client, token request, List ID,
    // or enabled action. The bridge only receives selection IDs from the iframe.
    const heldActions = Object.freeze({
      createOrOpenProviderDraft: async () => { throw new Error('Provider draft is held'); },
      createOrOpenCustomerDraft: async () => { throw new Error('Customer draft is held'); },
    });
    function armBridge() {
      bridge?.dispose();
      showSelection(null);
      bridge = createFrameSelectionBridge({
        hostWindow: window, frame, actions: heldActions,
        allowedProviderIds: allowed.providerIds,
        allowedCustomerKeys: allowed.customerKeys,
        onSelection: showSelection,
      });
    }
    // A reload invalidates the previous selection. The iframe message carries
    // only an ID; store and recipients require a separate protected resolver.
    frame.addEventListener('load', armBridge);
    frame.srcdoc = html;
    armBridge();
    frame.hidden = false;
    openExternal.href = window.location.href;
    workspace.hidden = false;
    status.hidden = true;
  } catch {
    unavailable();
  }
}

void open();
