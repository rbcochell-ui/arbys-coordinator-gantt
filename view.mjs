import {decryptGantt} from './crypto.mjs';
import {parseSelectionConfig} from './selection_config.mjs';
import {createFrameSelectionBridge} from './actions/frame_bridge.mjs';
import {parseComposeSources} from './actions/selection_source.mjs';
import {requestLocalHandoff} from './actions/local_helper_uri.mjs';
import {actionUiState} from './actions/action_ui_policy.mjs';
import {buildExternalBrowserHref, parseExternalBrowserHref,
  restoreAllowlistedSelection} from './actions/external_browser_handoff.mjs';
import {COMPOSE_RELEASE, digestSelection,
  releaseForSelection} from './actions/action_release.mjs';

const status = document.getElementById('status');
const workspace = document.getElementById('workspace');
const frame = document.getElementById('chart');
const selectionText = document.getElementById('selection');
const openExternal = document.getElementById('openExternal');
const selectedIdentity = document.getElementById('selectedIdentity');
const selectedStore = document.getElementById('selectedStore');
const selectedRecipients = document.getElementById('selectedRecipients');
const sourceStamp = document.getElementById('sourceStamp');
const providerCompose = document.getElementById('providerCompose');
const customerCompose = document.getElementById('customerCompose');
const sentCheck = document.getElementById('sentCheck');
const heldReason = document.getElementById('heldReason');
const sentReason = document.getElementById('sentReason');
let bridge;
let sources;
let allowedSelections;
let handoffBaseHref;
let rejectedExternalSelection = false;
let frameLoadHandler;
let openGeneration = 0;
let selectionGeneration = 0;
let selectedDigest = null;
let digestedSelection = null;
let selectionMacKeyBytes = null;
const embedded = window.top !== window.self;
const attemptedHandoffs = new Set();

function attemptKey(action, selection) {
  return selection && (selection.kind === 'provider' || selection.kind === 'customer')
    ? `${action}|${selection.kind}|${selection.id}` : null;
}

function wasAttempted(action, selection) {
  const key = attemptKey(action, selection);
  return key !== null && attemptedHandoffs.has(key);
}

function markAttempted(action, selection, button) {
  const key = attemptKey(action, selection);
  if (key !== null) attemptedHandoffs.add(key);
  button.disabled = true;
}

function updateExternalLink(selected) {
  openExternal.textContent = 'Open complete link in browser ↗';
  openExternal.classList.toggle('prominent', embedded);
  if (!embedded || !handoffBaseHref || !allowedSelections) {
    openExternal.hidden = true;
    return;
  }
  try {
    openExternal.href = buildExternalBrowserHref(
      handoffBaseHref, selected, allowedSelections);
    openExternal.hidden = false;
  } catch {
    openExternal.hidden = true;
  }
}

function chartSource(selected) {
  if (!selected || !sources) return null;
  return selected.kind === 'provider'
    ? sources.providerById[selected.id] ?? null
    : selected.kind === 'customer'
      ? sources.customerByKey[selected.id] ?? null : null;
}

function releaseFor(action, selected) {
  return releaseForSelection(action, selected, digestFor(selected), COMPOSE_RELEASE);
}

function digestFor(selected) {
  return selected && digestedSelection?.kind === selected.kind &&
    digestedSelection.id === selected.id ? selectedDigest : null;
}

function uiState(action, selected) {
  return actionUiState({action, selection: selected, allowed: allowedSelections,
    release: releaseFor(action, selected), selectionDigest: digestFor(selected),
    releaseConfig: COMPOSE_RELEASE, embedded,
    attempted: wasAttempted(action, selected)});
}

function actionExplanation(state, action, source) {
  switch (state.code) {
    case 'no_selection': return 'Select a project or work order in the chart.';
    case 'identity_unverified': return 'Checking this exact chart selection. Outlook actions stay held until that check completes.';
    case 'provider_first_draft_held': return 'Provider drafting is held for this work order until its exact source ID is released.';
    case 'provider_sent_held': return 'Provider Check Sent is held for this work order until its exact receipt route is released.';
    case 'adoption_required': return action === 'sent'
      ? 'Held: the existing pilot draft needs verified adoption before a Sent check.'
      : 'Held: this pilot has an unsent draft. Verified adoption is required before reopening; an existing Claim alone does not clear the hold.';
    case 'unlisted': return 'This item is outside the chart’s reviewed action list. No helper action can launch.';
    case 'release_held': return action === 'sent'
      ? 'Check Sent is held in this release. No candidate lookup can launch.'
      : 'Drafting is held in this release. No draft request can launch.';
    case 'embedded': return 'Open this selection with the complete private Gantt link in your browser. The Teams tab cannot launch the local helper.';
    case 'inspect_only': return 'A helper launch was already requested on this page. Inspect the shared Claim and Outlook before another attempt; there is no automatic retry.';
    case 'sent_candidate_only': return 'This read-only check may find a Sent candidate in your own mailbox. It cannot save a verified receipt or mark a milestone complete.';
    case 'draft_request_only': return source
      ? 'The helper checks your signed-in Outlook identity, positive admission, shared Claim, and current source before it opens an editable draft.'
      : 'Chart details are missing. The helper must verify its direct source before it can open a new draft.';
    default: return 'Action held.';
  }
}

function updateActionStates(selected, source) {
  const draft = uiState('draft', selected);
  const sent = uiState('sent', selected);
  const providerReady = selected?.kind === 'provider' && draft.enabled;
  const customerReady = selected?.kind === 'customer' && draft.enabled;
  providerCompose.disabled = !providerReady;
  customerCompose.disabled = !customerReady;
  sentCheck.disabled = !sent.enabled;
  providerCompose.textContent = providerReady
    ? 'Request provider parts draft ↗' : 'Provider parts draft — held';
  customerCompose.textContent = customerReady
    ? 'Request customer draft ↗' : draft.code === 'adoption_required'
      ? 'Customer draft — adoption needed' : 'Customer milestone draft — held';
  sentCheck.textContent = sent.enabled
    ? 'Inspect Sent candidate ↗' : sent.code === 'adoption_required'
      ? 'Check Sent — adoption needed' : 'Check Sent — held';
  heldReason.textContent = `Draft: ${actionExplanation(draft, 'draft', source)}`;
  sentReason.textContent = `Check Sent: ${actionExplanation(sent, 'sent', source)}`;
}

function showSelection(selected) {
  const generation = ++selectionGeneration;
  selectedDigest = null;
  digestedSelection = null;
  providerCompose.disabled = true;
  customerCompose.disabled = true;
  sentCheck.disabled = true;
  updateExternalLink(selected);
  selectedIdentity.textContent = 'Exact source ID: none selected';
  selectedStore.textContent = 'Store: unverified';
  selectedRecipients.textContent = 'Intended recipients: verify in Outlook';
  sourceStamp.textContent = 'Source: unverified';
  selectionText.textContent = 'Select a project or work order in the chart.';
  updateActionStates(null, null);
  if (!selected) {
    if (rejectedExternalSelection) {
      heldReason.textContent = 'The selection in that link is not in this chart. Select a project or work order here.';
    } else if (embedded) {
      heldReason.textContent = 'This chart is inside Teams. Select an item, then open the complete private link in your browser for available Outlook actions.';
    }
    return;
  }
  rejectedExternalSelection = false;

  const source = chartSource(selected);
  if (selected.kind === 'provider') {
    const dated = sources?.providerDisplayById?.[selected.id] ?? null;
    selectedIdentity.textContent = `Native work order ID: ${selected.id}`;
    selectionText.textContent = source
      ? `Dated Installation WO ${source.displayWoNumber} selected for a parts review.`
      : dated
        ? `Charted Installation WO ${dated.displayWoNumber} selected; verify current details in Thirsty before drafting.`
        : 'Work order selected. Current installation details require a fresh Thirsty check.';
    selectedStore.textContent = source
      ? `Chart store: ${source.storeNumber}; agent: ${source.agentCode}`
      : dated
        ? `Dated chart store: ${dated.storeNumber}; agent: ${dated.agentCode} (snapshot ${dated.snapshotAsOfDate})`
        : 'Store and agent: check the current Thirsty record.';
    selectedRecipients.textContent = 'Install manager and planner: resolved by the helper; verify both in Outlook.';
    sourceStamp.textContent = source
      ? `Thirsty overlay observed ${source.sourceObservedAtUtc}; status: ${source.status}; SP date: ${source.spActivityDate ?? 'not recorded'}. The helper rechecks the current work order.`
      : dated
        ? `Chart snapshot ${dated.snapshotAsOfDate}. The helper requires direct Thirsty verification of store, ACN, provider assignment, and visit status.`
        : 'Current WO source is unavailable in this chart. The helper requires a fresh Thirsty check before drafting.';
  } else if (selected.kind === 'customer') {
    selectedIdentity.textContent = `FORM source key: ${selected.id}`;
    selectionText.textContent = source
      ? `Store ${source.storeNumber} selected for a customer progress note.`
      : 'FORM project selected. Current project details require a fresh source check.';
    selectedStore.textContent = source
      ? `Chart store: ${source.storeNumber}`
      : 'Store: check the current FORM project.';
    selectedRecipients.textContent = 'FORM Primary Contact: suggested by the helper; verify before sending.';
    sourceStamp.textContent = sources?.snapshotAsOfDate
      ? `Chart snapshot as of ${sources.snapshotAsOfDate}. The helper checks the current FORM contact and the private tracker’s last verified time.`
      : 'Chart source time unavailable here. The helper checks the current FORM contact and private tracker before drafting.';
  }
  updateActionStates(selected, source);
  void digestSelection(selected, selectionMacKeyBytes).then(digest => {
    if (generation !== selectionGeneration) return;
    selectedDigest = digest;
    digestedSelection = {kind: selected.kind, id: selected.id};
    updateActionStates(selected, source);
  }).catch(() => {
    // Missing browser crypto or an invalid selection must leave actions held.
  });
}

function requestHandoff(event, kind, action = 'draft') {
  if (kind !== 'provider' && kind !== 'customer') return;
  const button = action === 'sent' ? sentCheck :
    kind === 'provider' ? providerCompose : customerCompose;
  const selection = bridge?.getSelection();
  const state = uiState(action, selection);
  let navigationAttempted = false;
  try {
    const outcome = requestLocalHandoff({
      event, kind, action,
      release: releaseFor(action, selection),
      disabled: button.disabled || !state.enabled,
      selection, selectionDigest: digestFor(selection),
      releaseConfig: COMPOSE_RELEASE, allowed: allowedSelections,
      topLevel: window.top === window.self,
      navigate: uri => {
        navigationAttempted = true;
        window.location.assign(uri);
      },
    });
    if (outcome === 'framed') {
      heldReason.textContent = 'Open this selection with the complete private Gantt link in your browser. The Teams tab cannot launch the local helper.';
    } else if (outcome === 'requested') {
      markAttempted(action, selection, button);
      const target = action === 'sent' ? sentReason : heldReason;
      target.textContent = action === 'sent'
        ? 'Read-only Sent candidate check requested. This page cannot confirm a sent receipt or completion; inspect Outlook and the shared Claim before another attempt.'
        : 'Draft helper launch requested. This page cannot confirm a draft; inspect Outlook and the shared Claim before another attempt. No email was sent by this page.';
    }
  } catch {
    if (navigationAttempted) markAttempted(action, selection, button);
    const target = action === 'sent' ? sentReason : heldReason;
    target.textContent = 'Helper launch is uncertain. Inspect the shared Claim and Outlook before another attempt; this page cannot confirm a draft or Sent receipt.';
  }
}

providerCompose.addEventListener('click', event => requestHandoff(event, 'provider'));
customerCompose.addEventListener('click', event => requestHandoff(event, 'customer'));
sentCheck.addEventListener('click', event => {
  const kind = bridge?.getSelection()?.kind;
  if (kind === 'provider' || kind === 'customer')
    requestHandoff(event, kind, 'sent');
});

function unavailable() {
  if (frameLoadHandler) frame.removeEventListener('load', frameLoadHandler);
  frameLoadHandler = undefined;
  bridge?.dispose();
  bridge = undefined;
  selectionMacKeyBytes = null;
  sources = null;
  allowedSelections = null;
  handoffBaseHref = null;
  rejectedExternalSelection = false;
  showSelection(null);
  frame.hidden = true;
  frame.removeAttribute('srcdoc');
  workspace.hidden = true;
  status.hidden = false;
  status.querySelector('h1').textContent = 'Timeline unavailable';
  status.querySelector('p').textContent = 'Check that you opened the complete link. Ask your coordinator for a new link if this continues.';
}

async function open() {
  const generation = ++openGeneration;
  if (frameLoadHandler) frame.removeEventListener('load', frameLoadHandler);
  frameLoadHandler = undefined;
  bridge?.dispose();
  bridge = undefined;
  providerCompose.disabled = true;
  customerCompose.disabled = true;
  sentCheck.disabled = true;
  frame.hidden = true;
  workspace.hidden = true;
  status.hidden = false;
  status.querySelector('h1').textContent = 'Opening coordinator timeline';
  status.querySelector('p').textContent = 'Checking the complete private link.';
  try {
    const handoff = parseExternalBrowserHref(window.location.href);
    const key = handoff.key;
    const dataUrl = new URL('./data/gantt.enc.json', window.location.href);
    dataUrl.searchParams.set('fresh', String(Date.now()));
    const response = await fetch(dataUrl, {cache: 'no-store', credentials: 'omit', redirect: 'error'});
    if (!response.ok) throw new Error('Encrypted chart unavailable');
    const body = await response.text();
    if (body.length > 1_700_000) throw new Error('Encrypted chart too large');
    const html = await decryptGantt(JSON.parse(body), key);
    if (generation !== openGeneration) return;
    selectionMacKeyBytes = key;
    const allowed = parseSelectionConfig(html);
    // Chart context is optional for claim recovery. The helper independently
    // checks fresh source before it can create a new draft.
    try { sources = parseComposeSources(html, allowed); }
    catch { sources = null; }
    allowedSelections = allowed;
    handoffBaseHref = handoff.capabilityHref;
    const restoredSelection = restoreAllowlistedSelection(
      handoff.selection, allowed);
    rejectedExternalSelection = handoff.selection !== null &&
      restoredSelection === null;
    // The sandboxed chart sends allowlisted IDs only; it never receives the
    // private tracker link, a recipient, or a helper result.
    const heldActions = Object.freeze({
      createOrOpenProviderDraft: async () => { throw new Error('Only the parent buttons can open compose'); },
      createOrOpenCustomerDraft: async () => { throw new Error('Only the parent buttons can open compose'); },
    });
    function armBridge() {
      bridge?.dispose();
      bridge = createFrameSelectionBridge({
        hostWindow: window, frame, actions: heldActions,
        allowedProviderIds: allowed.providerIds,
        allowedCustomerKeys: allowed.customerKeys,
        initialSelection: restoredSelection,
        onSelection: showSelection,
      });
      showSelection(bridge.getSelection());
    }
    frameLoadHandler = armBridge;
    frame.addEventListener('load', frameLoadHandler);
    frame.srcdoc = html;
    armBridge();
    frame.hidden = false;
    workspace.hidden = false;
    status.hidden = true;
  } catch {
    if (generation === openGeneration) unavailable();
  }
}

window.addEventListener('hashchange', () => { void open(); });
void open();
