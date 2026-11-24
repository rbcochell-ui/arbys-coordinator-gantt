import {parseCapabilityHref} from './crypto.mjs';
import {parseSelectionConfig} from './selection_config.mjs';
import {createFrameSelectionBridge} from './actions/frame_bridge.mjs';
import {createCoordinatorActionUi} from './actions/ui_controller.mjs';
import {INTEGRATION_CONFIG} from './actions/integration_config.mjs';
import {createAuthenticatedChartLoader} from '../src/chart_loader.mjs';
import {prepareIntegratedSite} from '../src/compose_site.mjs';

const status = document.getElementById('status');
const workspace = document.getElementById('workspace');
const frame = document.getElementById('chart');
const openExternal = document.getElementById('openExternal');
let bridge;
let actionUi;
let providerPanel;
let frameLoadHandler;

function panelElements() {
  return {
    panel: document.getElementById('providerSourcePanel'),
    sourceAsOf: document.getElementById('sourceAsOf'),
    chartDate: document.getElementById('chartDate'),
    datedPhase: document.getElementById('datedPhase'),
    agentCode: document.getElementById('agentCode'),
    storeNumber: document.getElementById('storeNumber'),
    thirstyLink: document.getElementById('thirstyLink'),
    recipientWarning: document.getElementById('recipientWarning'),
    reviewWarning: document.getElementById('reviewWarning'),
    status: document.getElementById('providerSourceStatus'),
  };
}

function unavailable() {
  if (frameLoadHandler) frame.removeEventListener('load', frameLoadHandler);
  bridge?.dispose();
  bridge = undefined;
  actionUi?.dispose();
  actionUi = undefined;
  providerPanel?.dispose();
  providerPanel = undefined;
  frame.hidden = true;
  frame.removeAttribute('srcdoc');
  workspace.hidden = true;
  status.hidden = false;
  status.querySelector('h1').textContent = 'Timeline unavailable';
  status.querySelector('p').textContent =
    'Check that you opened the complete link. Ask your coordinator for a new link if this continues.';
}

async function open() {
  try {
    const key = parseCapabilityHref(window.location.href);
    const payloadUrl = new URL('./data/gantt.enc.json', window.location.href).href;
    if (INTEGRATION_CONFIG.enabled === true &&
        payloadUrl !== INTEGRATION_CONFIG.encryptedPayloadUrl) {
      throw new Error('CHART_ORIGIN_BINDING_MISMATCH');
    }
    const loadAuthenticatedChart = createAuthenticatedChartLoader({
      capabilityKey: key, payloadUrl});
    const {html} = await loadAuthenticatedChart();
    const allowed = parseSelectionConfig(html);
    const prepared = await prepareIntegratedSite({
      config: INTEGRATION_CONFIG, loadAuthenticatedChart,
      panelElements: panelElements(),
    });
    providerPanel = prepared.panel;
    actionUi = createCoordinatorActionUi({
      runtime: prepared.adapter, hostWindow: window,
      getBridge: () => bridge,
      elements: {
        selectionText: document.getElementById('selection'),
        selectedIdentity: document.getElementById('selectedIdentity'),
        selectedStore: document.getElementById('selectedStore'),
        toReview: document.getElementById('toReview'),
        ccReview: document.getElementById('ccReview'),
        heldReason: document.getElementById('heldReason'),
        actionStatus: document.getElementById('actionStatus'),
        signInAction: document.getElementById('signInAction'),
        verifyAction: document.getElementById('verifyAction'),
        providerDraftAction: document.getElementById('providerDraftAction'),
        customerDraftAction: document.getElementById('customerDraftAction'),
        checkSentAction: document.getElementById('checkSentAction'),
        openDraftLink: document.getElementById('openDraftLink'),
      },
    });
    function onSelection(value) {
      providerPanel?.onSelection(value);
      actionUi.onSelection(value);
    }
    frameLoadHandler = function armBridge() {
      bridge?.dispose();
      onSelection(null);
      bridge = createFrameSelectionBridge({
        hostWindow: window, frame,
        allowedProviderIds: allowed.providerIds,
        allowedCustomerKeys: allowed.customerKeys,
        onSelection,
      });
    };
    frame.addEventListener('load', frameLoadHandler);
    frame.srcdoc = html;
    frameLoadHandler();
    frame.hidden = false;
    openExternal.href = window.location.href;
    workspace.hidden = false;
    status.hidden = true;
  } catch {
    unavailable();
  }
}

void open();
