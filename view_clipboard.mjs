// HELD deploy candidate based on public Gantt commit ea4860cf. It renders the
// same chart, but its two draft actions use only pinned editable templates.
// This tenant's Outlook web route preserves To and subject but ignores body.
// The user must copy the exact body first, then open Outlook and paste it.
// This module cannot send email or check Sent.
import {decryptGantt} from './crypto.mjs';
import {renderReviewedChartFooter} from './actions/chart_footer.mjs';
import {parseSelectionConfig} from './selection_config.mjs';
import {createFrameSelectionBridge} from './actions/frame_bridge.mjs';
import {parseComposeSources} from './actions/selection_source.mjs';
import {buildExternalBrowserHref, parseExternalBrowserHref,
  restoreAllowlistedSelection} from './actions/external_browser_handoff.mjs';
import {digestSelection} from './actions/action_release.mjs';
import {prepareOneClickCustomerTemplate, prepareOneClickProviderTemplate,
  selectedChartStore} from
  './actions/one_click_client.mjs';
import {PROVIDER_COMMITMENTS} from './actions/provider_pins.mjs';
import {F32_PROVIDER_SOURCE_RELEASE} from
  './actions/provider_source_release.mjs';
import {PINNED_FORM_ONLY_COMMITMENTS} from
  './actions/release_commitments.mjs';
import {OUTER_RELEASE} from './actions/outer_release.mjs';
import {canonicalOutlookHeader} from
  './actions/canonical_outlook_header.mjs';
import {clipboardPayload} from './actions/clipboard_payload.mjs';
import {writeClipboardPayload} from './actions/clipboard_writer.mjs';

const $ = id => document.getElementById(id);
const status = $('status');
const workspace = $('workspace');
const frame = $('chart');
const selectionText = $('selection');
const openExternal = $('openExternal');
const selectedIdentity = $('selectedIdentity');
const selectedStore = $('selectedStore');
const selectedRecipients = $('selectedRecipients');
const sourceStamp = $('sourceStamp');
const providerCompose = $('providerCompose');
const customerCompose = $('customerCompose');
const sentCheck = $('sentCheck');
const copyPanel = $('copyPanel');
const copyStatus = $('copyStatus');
const openOutlook = $('openOutlook');
const manualCopy = $('manualCopy');
const manualBody = $('manualBody');
const selectMessage = $('selectMessage');
const manualCopied = $('manualCopied');
const heldReason = $('heldReason');
const sentReason = $('sentReason');
const embedded = window.top !== window.self;
const PILOT_CUSTOMER_DIGEST =
  '16998cb9608e15cfcd7ee63cd73184719cc3838806d28f914adff7de799b858d';
const PILOT_PROVIDER_DIGEST =
  '3b2fd28277a82e83372fcede80b61b7b2f8882acff652b54b03a10a95b8c6d5b';
// Teams Website-tab pop-up behavior needs an attended host readback. The
// browser handoff remains visible and preserves the exact chart selection.
const EMBEDDED_COMPOSE_ALLOWED = false;
const attempted = new Set();
let bridge;
let sources;
let allowed;
let chartHtml;
let chartKey;
let handoffBaseHref;
let rejectedExternalSelection = false;
let frameLoadHandler;
let openGeneration = 0;
let selectionGeneration = 0;
let selectedDigest = null;
let digestedSelection = null;
let handoffMessage = null;
let prepared = null;
let preparingKey = null;
let failedKey = null;
let copied = null;
let copying = false;
const COPY_WINDOW_MS = 5 * 60 * 1000;

function selectionKey(selected) {
  return selected?.kind === 'customer' || selected?.kind === 'provider'
    ? `${selected.kind}|${selected.id}` : null;
}
function sameSelection(a, b) {
  return a?.kind === b?.kind && a?.id === b?.id;
}
function hasDigest(selected) {
  return sameSelection(selected, digestedSelection) ? selectedDigest : null;
}
function updateExternalLink(selected) {
  openExternal.textContent = 'Open complete link in browser ↗';
  openExternal.classList.toggle('prominent', embedded);
  if (!embedded || !handoffBaseHref || !allowed) {
    openExternal.hidden = true;
    return;
  }
  try {
    openExternal.href = buildExternalBrowserHref(handoffBaseHref, selected,
      allowed);
    openExternal.hidden = false;
  } catch { openExternal.hidden = true; }
}

function customerGateState(selected) {
  if (selected?.kind !== 'customer') return 'not_selected';
  const digest = hasDigest(selected);
  if (!digest) return 'checking_selection';
  if (digest === PILOT_CUSTOMER_DIGEST) return 'existing_pilot_draft';
  if (!Object.hasOwn(PINNED_FORM_ONLY_COMMITMENTS, digest)) {
    return 'unreleased_project';
  }
  if (OUTER_RELEASE.state !== 'RELEASED') return 'release_held';
  if (Date.now() >= Date.parse(OUTER_RELEASE.validUntilUtc)) {
    return 'source_expired';
  }
  if (embedded && !EMBEDDED_COMPOSE_ALLOWED) return 'open_in_browser';
  if (attempted.has(selectionKey(selected))) return 'already_attempted';
  return 'ready';
}

function providerGateState(selected) {
  if (selected?.kind !== 'provider') return 'not_selected';
  const digest = hasDigest(selected);
  if (!digest) return 'checking_selection';
  if (digest === PILOT_PROVIDER_DIGEST) return 'existing_pilot_draft';
  if (PROVIDER_COMMITMENTS[digest] !==
      F32_PROVIDER_SOURCE_RELEASE.providerCommitmentSha256 ||
      digest !== F32_PROVIDER_SOURCE_RELEASE.selectionDigestSha256) {
    return 'provider_source_held';
  }
  if (F32_PROVIDER_SOURCE_RELEASE.state !== 'RELEASED' ||
      F32_PROVIDER_SOURCE_RELEASE.sourceOwnerReviewed !== true) {
    return 'release_held';
  }
  if (Date.now() >= Date.parse(F32_PROVIDER_SOURCE_RELEASE.sourceValidUntilUtc)) {
    return 'source_expired';
  }
  if (embedded && !EMBEDDED_COMPOSE_ALLOWED) return 'open_in_browser';
  if (attempted.has(selectionKey(selected))) return 'already_attempted';
  return 'ready';
}

function preparedFor(selected, digest) {
  return prepared?.kind === selected?.kind &&
    prepared?.id === selected?.id &&
    prepared?.digest === digest &&
    Date.now() < prepared.expiresAtMs;
}

function copiedFor(selected, digest) {
  return copied?.key === selectionKey(selected) &&
    copied?.digest === digest && preparedFor(selected, digest) &&
    Date.now() - copied.atMs < COPY_WINDOW_MS;
}

function customerState(selected) {
  const gate = customerGateState(selected);
  if (gate !== 'ready') return gate;
  const key = selectionKey(selected);
  if (preparedFor(selected, hasDigest(selected))) return 'ready';
  if (failedKey === key) return 'prepare_failed';
  return preparingKey === key ? 'preparing' : 'checking_selection';
}

function providerState(selected) {
  const gate = providerGateState(selected);
  if (gate !== 'ready') return gate;
  const key = selectionKey(selected);
  if (preparedFor(selected, hasDigest(selected))) return 'ready';
  if (failedKey === key) return 'prepare_failed';
  return preparingKey === key ? 'preparing' : 'checking_selection';
}

function explanation(code) {
  switch (code) {
    case 'ready': return 'Template ready. Copy the full message, then open Outlook and paste it.';
    case 'not_selected': return 'Select a project or work order in the chart.';
    case 'checking_selection': return 'Checking the exact chart selection.';
    case 'preparing': return 'Preparing the exact reviewed email message.';
    case 'prepare_failed': return 'The reviewed template could not be prepared. No email app was opened. Reopen this Gantt to retry after checking the source.';
    case 'existing_pilot_draft': return 'An unsent pilot draft already exists. Open Outlook Drafts and search for this project or work order before making another.';
    case 'unreleased_project': return 'This project has no released customer tracker binding.';
    case 'release_held': return 'This template is staged but not published.';
    case 'source_expired': return 'The dated contact/link source expired. Refresh its reviewed binding before opening a template.';
    case 'open_in_browser': return 'Open the complete Gantt link in a browser to draft from this Teams selection.';
    case 'already_attempted': return 'Outlook navigation was already attempted for this selection on this page. Check Outlook Drafts before trying again.';
    case 'provider_source_held': return 'A reviewed current WO/contact source is not released for this selection.';
    default: return 'Template unavailable.';
  }
}

function updateButtons(selected) {
  const customer = customerState(selected);
  const provider = providerState(selected);
  customerCompose.disabled = copying || customer !== 'ready';
  providerCompose.disabled = copying || provider !== 'ready';
  sentCheck.disabled = true;
  customerCompose.textContent = customer === 'ready'
    ? 'Customer milestone draft — copy full message'
    : 'Customer milestone draft — held';
  providerCompose.textContent = provider === 'ready'
    ? 'Provider parts draft — copy full message'
    : 'Provider parts draft — held';
  const canOpen = (customer === 'ready' || provider === 'ready') &&
    copiedFor(selected, hasDigest(selected));
  if (canOpen) {
    openOutlook.setAttribute('href', prepared.url);
    openOutlook.setAttribute('aria-disabled', 'false');
    openOutlook.tabIndex = 0;
  } else {
    openOutlook.removeAttribute('href');
    openOutlook.setAttribute('aria-disabled', 'true');
    openOutlook.tabIndex = -1;
  }
  sentCheck.textContent = 'Check Sent — unavailable';
  heldReason.textContent = handoffMessage ??
    `Customer: ${explanation(customer)} Provider: ${explanation(provider)}`;
  sentReason.textContent =
    'Check Sent is unavailable. This page cannot confirm delivery, a shared Claim, or a milestone completion.';
}

function chartSource(selected) {
  if (!selected || !sources) return null;
  return selected.kind === 'customer'
    ? sources.customerByKey[selected.id] ?? null
    : selected.kind === 'provider'
      ? sources.providerById[selected.id] ?? null : null;
}

function showSelection(selected) {
  const generation = ++selectionGeneration;
  handoffMessage = null;
  prepared = null;
  preparingKey = null;
  failedKey = null;
  copied = null;
  copying = false;
  copyPanel.hidden = true;
  manualCopy.hidden = true;
  manualBody.value = '';
  manualCopied.checked = false;
  openOutlook.removeAttribute('href');
  openOutlook.setAttribute('aria-disabled', 'true');
  openOutlook.tabIndex = -1;
  copyStatus.textContent = 'The message has not been copied.';
  selectedDigest = null;
  digestedSelection = null;
  selectedIdentity.textContent = 'Exact source ID: none selected';
  selectedStore.textContent = 'Store: unverified';
  selectedRecipients.textContent = 'Recipients: verify in Outlook';
  sourceStamp.textContent = 'Source: unverified';
  selectionText.textContent = 'Select a project or work order in the chart.';
  updateExternalLink(selected);
  updateButtons(null);
  if (!selected) {
    if (rejectedExternalSelection) {
      heldReason.textContent = 'The selected ID is not in this chart. Select an item here.';
    } else if (embedded) {
      heldReason.textContent = 'Select an item, then use Open complete link in browser for Outlook templates.';
    }
    return;
  }
  rejectedExternalSelection = false;
  const source = chartSource(selected);
  if (selected.kind === 'customer') {
    selectedIdentity.textContent = `FORM source key: ${selected.id}`;
    let store;
    try { store = selectedChartStore(chartHtml, allowed, selected.id); }
    catch { store = undefined; }
    selectedStore.textContent = store === null
      ? 'Store: Unknown — team identity review needed'
      : store ? `Store: ${store}` : 'Store: unverified';
    selectionText.textContent = store
      ? `Store ${store} selected for an editable customer note.`
      : 'FORM project selected for an editable customer note.';
    selectedRecipients.textContent =
      'FORM Primary Contact is a suggestion; verify the requester before Send.';
    sourceStamp.textContent =
      `Template source ${OUTER_RELEASE.sourceAsOfUtc}. It may be dated: verify the Primary Contact and project status before Send. FORM-only trackers currently confirm receipt; no work-order progress is claimed.`;
  } else {
    selectedIdentity.textContent = `Native work order ID: ${selected.id}`;
    selectedStore.textContent = source
      ? `Chart store: ${source.storeNumber}; agent: ${source.agentCode}`
      : 'Store and agent: verify in Thirsty';
    selectionText.textContent = source
      ? `Installation WO ${source.displayWoNumber} selected.`
      : 'Work order selected. Review current Thirsty details.';
    selectedRecipients.textContent =
      'Install manager and planner are suggestions; verify both before Send.';
    sourceStamp.textContent = source
      ? `Thirsty overlay observed ${source.sourceObservedAtUtc}; status ${source.status}; SP date is not a confirmed install date.`
      : `Verified source candidate observed ${F32_PROVIDER_SOURCE_RELEASE.sourceObservedAtUtc}; recheck current Thirsty status and date before Send.`;
  }
  updateButtons(selected);
  void digestSelection(selected, chartKey).then(digest => {
    if (generation !== selectionGeneration) return;
    selectedDigest = digest;
    digestedSelection = {kind: selected.kind, id: selected.id};
    updateButtons(selected);
    void prepareSelectedMessage(selected, generation, digest);
  }).catch(() => { /* Keep both templates held. */ });
}

async function prepareSelectedMessage(selected, generation, digest) {
  const gate = selected.kind === 'customer'
    ? customerGateState(selected) : providerGateState(selected);
  if (gate !== 'ready') return;
  const key = selectionKey(selected);
  preparingKey = key;
  updateButtons(selected);
  try {
    const template = selected.kind === 'customer'
      ? await prepareOneClickCustomerTemplate(selected.id, chartHtml, chartKey)
      : await prepareOneClickProviderTemplate(selected.id, chartHtml, chartKey);
    if (generation !== selectionGeneration ||
        !sameSelection(selected, bridge?.getSelection()) ||
        hasDigest(selected) !== digest) return;
    const stillReady = selected.kind === 'customer'
      ? customerGateState(selected) : providerGateState(selected);
    if (stillReady !== 'ready') return;
    const header = canonicalOutlookHeader(template);
    const payload = clipboardPayload(template);
    const expiry = selected.kind === 'customer'
      ? OUTER_RELEASE.validUntilUtc
      : F32_PROVIDER_SOURCE_RELEASE.sourceValidUntilUtc;
    const expiresAtMs = Date.parse(expiry);
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return;
    prepared = Object.freeze({kind: selected.kind, id: selected.id, digest,
      url: header.url, body: header.body, clipboard: payload,
      expiresAtMs});
  } catch {
    if (generation === selectionGeneration &&
        sameSelection(selected, bridge?.getSelection())) failedKey = key;
  } finally {
    if (generation === selectionGeneration) {
      preparingKey = null;
      updateButtons(bridge?.getSelection());
    }
  }
}

function showManualCopy(body) {
  copyPanel.hidden = false;
  manualCopy.hidden = false;
  manualBody.value = body;
  manualCopied.checked = false;
  copied = null;
  copyStatus.textContent =
    'Clipboard access was unavailable. Outlook was not opened. Select and copy the complete message below, then confirm before opening Outlook.';
  updateButtons(bridge?.getSelection());
}

async function onCopyClick(event, kind) {
  const selected = bridge?.getSelection();
  const state = kind === 'customer'
    ? customerState(selected) : providerState(selected);
  const digest = hasDigest(selected);
  if (!event.isTrusted || event.button !== 0 || copying ||
      state !== 'ready' ||
      !preparedFor(selected, digest) || prepared.kind !== kind) return;
  const generation = selectionGeneration;
  const body = prepared.body;
  copying = true;
  copyPanel.hidden = false;
  copyStatus.textContent = 'Copying the complete message. Outlook has not opened.';
  manualCopy.hidden = true;
  manualBody.value = '';
  manualCopied.checked = false;
  copied = null;
  updateButtons(selected);
  // Invoke the first Clipboard API write inside the trusted click stack.
  const request = writeClipboardPayload(prepared.clipboard,
    navigator.clipboard);
  try {
    const format = await request;
    if (generation !== selectionGeneration ||
        !sameSelection(selected, bridge?.getSelection()) ||
        !preparedFor(selected, digest)) return;
    copied = Object.freeze({key: selectionKey(selected), digest,
      atMs: Date.now(), method: format});
    copyStatus.textContent =
      format === 'html+plain'
        ? 'Full message and link format copied. Open Outlook, paste with Ctrl+V, and verify all recipients and clickable links before Send. Copying did not put the body in Outlook.'
        : 'Full message copied as plain text. Open Outlook, paste with Ctrl+V, and verify all recipients and that each link is clickable before Send. Copying did not put the body in Outlook.';
    manualCopy.hidden = true;
    manualBody.value = '';
    updateButtons(selected);
    setTimeout(() => updateButtons(bridge?.getSelection()), COPY_WINDOW_MS);
  } catch {
    if (generation === selectionGeneration &&
        sameSelection(selected, bridge?.getSelection()) &&
        preparedFor(selected, digest) &&
        (kind === 'customer' ? customerGateState(selected)
          : providerGateState(selected)) === 'ready') showManualCopy(body);
  } finally {
    if (generation === selectionGeneration) {
      copying = false;
      updateButtons(bridge?.getSelection());
    }
  }
}

function onOutlookClick(event) {
  const selected = bridge?.getSelection();
  const state = selected?.kind === 'customer'
    ? customerState(selected) : providerState(selected);
  const current = preparedFor(selected, hasDigest(selected)) &&
    copiedFor(selected, hasDigest(selected)) &&
    openOutlook.getAttribute('href') === prepared.url;
  if (!event.isTrusted || event.button !== 0 || state !== 'ready' ||
      !current || attempted.has(selectionKey(selected))) {
    event.preventDefault();
    updateButtons(selected);
    return;
  }
  // A native HTTPS anchor is activated only after a completed clipboard copy
  // or explicit manual-copy confirmation. No body is placed in Outlook here.
  attempted.add(selectionKey(selected));
  handoffMessage =
    'Outlook opening requested with To and subject only. Paste the copied message into its body and verify recipients, links, current status and date before Send. Check Drafts before any retry. This page sent nothing.';
  copyStatus.textContent = handoffMessage;
  setTimeout(() => updateButtons(bridge?.getSelection()), 0);
}

function onSelectMessage(event) {
  if (!event.isTrusted || manualCopy.hidden || !manualBody.value) return;
  manualBody.focus();
  manualBody.select();
  copyStatus.textContent =
    'Full message selected. Press Ctrl+C, then check “I copied the complete message.” Outlook is still closed.';
}

function onManualConfirmation(event) {
  const selected = bridge?.getSelection();
  const digest = hasDigest(selected);
  if (!event.isTrusted || manualCopy.hidden ||
      !preparedFor(selected, digest) ||
      manualBody.value !== prepared.body) {
    manualCopied.checked = false;
    return;
  }
  copied = manualCopied.checked
    ? Object.freeze({key: selectionKey(selected), digest,
      atMs: Date.now(), method: 'manual'}) : null;
  copyStatus.textContent = manualCopied.checked
    ? 'You confirmed copying the complete message. Open Outlook, paste it into the body, and verify it before Send.'
    : 'Copy the complete message before opening Outlook.';
  updateButtons(selected);
  if (copied) setTimeout(() => updateButtons(bridge?.getSelection()),
    COPY_WINDOW_MS);
}

function unavailable() {
  if (frameLoadHandler) frame.removeEventListener('load', frameLoadHandler);
  frameLoadHandler = undefined;
  bridge?.dispose();
  bridge = undefined;
  prepared = null;
  preparingKey = null;
  failedKey = null;
  copied = null;
  copying = false;
  copyPanel.hidden = true;
  manualCopy.hidden = true;
  manualBody.value = '';
  manualCopied.checked = false;
  openOutlook.removeAttribute('href');
  openOutlook.setAttribute('aria-disabled', 'true');
  openOutlook.tabIndex = -1;
  sources = null;
  allowed = null;
  chartHtml = null;
  chartKey = null;
  handoffBaseHref = null;
  rejectedExternalSelection = false;
  frame.hidden = true;
  frame.removeAttribute('srcdoc');
  workspace.hidden = true;
  status.hidden = false;
  status.querySelector('h1').textContent = 'Timeline unavailable';
  status.querySelector('p').textContent =
    'Check the complete private Gantt link or ask the coordinator for a new one.';
}

async function open() {
  const generation = ++openGeneration;
  if (frameLoadHandler) frame.removeEventListener('load', frameLoadHandler);
  frameLoadHandler = undefined;
  bridge?.dispose();
  bridge = undefined;
  prepared = null;
  preparingKey = null;
  failedKey = null;
  copied = null;
  copying = false;
  copyPanel.hidden = true;
  manualCopy.hidden = true;
  manualBody.value = '';
  manualCopied.checked = false;
  customerCompose.disabled = true;
  providerCompose.disabled = true;
  openOutlook.removeAttribute('href');
  openOutlook.setAttribute('aria-disabled', 'true');
  openOutlook.tabIndex = -1;
  sentCheck.disabled = true;
  frame.hidden = true;
  workspace.hidden = true;
  status.hidden = false;
  status.querySelector('h1').textContent = 'Opening coordinator timeline';
  status.querySelector('p').textContent = 'Checking the complete private link.';
  try {
    const handoff = parseExternalBrowserHref(window.location.href);
    const dataUrl = new URL('./data/gantt.enc.json', window.location.href);
    dataUrl.searchParams.set('fresh', String(Date.now()));
    const response = await fetch(dataUrl, {
      cache: 'no-store', credentials: 'omit', redirect: 'error'});
    if (!response.ok) throw new Error('Encrypted chart unavailable');
    const body = await response.text();
    if (body.length > 1_700_000) throw new Error('Encrypted chart too large');
    const html = await decryptGantt(JSON.parse(body), handoff.key);
    const displayedHtml = await renderReviewedChartFooter(html);
    if (generation !== openGeneration) return;
    chartKey = handoff.key;
    chartHtml = html;
    allowed = parseSelectionConfig(html);
    try { sources = parseComposeSources(html, allowed); }
    catch { sources = null; }
    handoffBaseHref = handoff.capabilityHref;
    const restored = restoreAllowlistedSelection(handoff.selection, allowed);
    rejectedExternalSelection = handoff.selection !== null && restored === null;
    const heldActions = Object.freeze({
      createOrOpenProviderDraft: async () => { throw new Error('Use parent button'); },
      createOrOpenCustomerDraft: async () => { throw new Error('Use parent button'); },
    });
    const armBridge = () => {
      bridge?.dispose();
      bridge = createFrameSelectionBridge({hostWindow: window, frame,
        actions: heldActions, allowedProviderIds: allowed.providerIds,
        allowedCustomerKeys: allowed.customerKeys,
        initialSelection: restored, onSelection: showSelection});
      showSelection(bridge.getSelection());
    };
    frameLoadHandler = armBridge;
    frame.addEventListener('load', frameLoadHandler);
    frame.srcdoc = displayedHtml;
    armBridge();
    frame.hidden = false;
    workspace.hidden = false;
    status.hidden = true;
  } catch {
    if (generation === openGeneration) unavailable();
  }
}

customerCompose.addEventListener('click', event => {
  void onCopyClick(event, 'customer');
});
providerCompose.addEventListener('click', event => {
  void onCopyClick(event, 'provider');
});
openOutlook.addEventListener('click', onOutlookClick);
openOutlook.addEventListener('auxclick', event => event.preventDefault());
selectMessage.addEventListener('click', onSelectMessage);
manualCopied.addEventListener('change', onManualConfirmation);
window.addEventListener('pageshow', event => {
  if (event.persisted) showSelection(bridge?.getSelection());
});
// Check Sent stays disabled: a static page cannot observe an Outlook send.
window.addEventListener('hashchange', () => { void open(); });
void open();
