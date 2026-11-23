const HELD_COPY = 'Draft actions are currently held while coordinator setup is verified.';
const DRAFT_LINK_HOSTS = new Set(['outlook.office.com', 'outlook.office365.com']);
const HELD_MESSAGES = Object.freeze({
  NOT_STARTED: 'No tracked draft or Sent receipt exists yet.',
  DRAFT_OWNED_ELSEWHERE: 'Another coordinator owns an unresolved draft for this ID.',
  LEGACY_OCCUPIED: 'An earlier pilot draft needs owner reconciliation.',
  CLAIM_OUTCOME_UNVERIFIED: 'The claim outcome needs owner reconciliation.',
  SHARED_SENT_RECORD_UNVERIFIED: 'A shared Sent record exists. The draft owner can use Check Sent to verify it in their mailbox; no new draft will be made.',
  SENT_STATE_UNRESOLVED: 'The mailbox state could not be confirmed. Try Check Sent later.',
});

function held(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function sameSelection(a, b) {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}
function safeCode(error) {
  return /^[A-Z0-9_]{3,80}$/u.test(error?.code ?? '')
    ? error.code : 'ACTION_UNVERIFIED';
}
function trustedParentClick(event, button) {
  if (event?.type !== 'click' || event.isTrusted !== true ||
      event.currentTarget !== button) throw held('PARENT_CLICK_REQUIRED');
}
function outlookLink(href) {
  if (typeof href !== 'string' || href.length > 4096) throw held('OUTLOOK_LINK_INVALID');
  let url;
  try { url = new URL(href); }
  catch { throw held('OUTLOOK_LINK_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      !DRAFT_LINK_HOSTS.has(url.hostname)) throw held('OUTLOOK_LINK_INVALID');
  return url.href;
}
function previewMessage(preview) {
  switch (preview.status) {
    case 'eligible':
      return preview.recipientReviewRequired || !preview.to.length
        ? 'Source preview passed. To is blank; add and verify recipients in Outlook before Send.'
        : 'Source preview passed. Verify suggested recipients in Outlook before Send.';
    case 'draft_occupied':
      return 'Your existing draft can be reopened. Review it in Outlook before Send.';
    case 'sent': return 'A Sent Items receipt already confirms this message.';
    case 'sent_with_changes':
      return 'A Sent Items receipt confirms this message with changes; review the receipt.';
    case 'sent_recorded_unverified':
      return HELD_MESSAGES.SHARED_SENT_RECORD_UNVERIFIED;
    case 'draft_status_unverified':
      return HELD_MESSAGES.DRAFT_OWNED_ELSEWHERE;
    case 'legacy_occupied': return HELD_MESSAGES.LEGACY_OCCUPIED;
    case 'claim_outcome_unverified':
      return HELD_MESSAGES.CLAIM_OUTCOME_UNVERIFIED;
    default: return 'This draft state needs coordinator review.';
  }
}
function draftMessage(result) {
  switch (result.reviewState) {
    case 'recipient_review_required':
      return 'Outlook draft is ready. To needs review or entry before Send.';
    case 'draft_review_required':
      return 'Existing Outlook draft has edits. Review its content before Send.';
    case 'source_changed_review_required':
      return 'Existing draft is open, but the WO or Release changed. Check the current source before Send.';
    default:
      if (result.recipientReviewRequired) {
        return 'Outlook draft is ready. Review recipients before Send.';
      }
      if (result.contentReviewRequired) {
        return 'Outlook draft is ready. Review its content before Send.';
      }
      return 'Unsent Outlook draft is ready. Review and send it in Outlook.';
  }
}

/**
 * Selection is read-only. An exact selected ID automatically starts V2
 * preview after sign-in. The two draft buttons are the only draft writes.
 * Check Sent remains available when source preview is held or occupied.
 */
export function createCoordinatorActionUi({runtime, elements, getBridge,
    hostWindow = globalThis.window, now = () => Date.now()}) {
  const {selectionText, selectedIdentity, selectedStore, toReview, ccReview,
    heldReason, actionStatus, signInAction, verifyAction,
    providerDraftAction, customerDraftAction, checkSentAction, openDraftLink} = elements ?? {};
  if ([selectionText, selectedIdentity, selectedStore, toReview, ccReview,
      heldReason, actionStatus, signInAction, verifyAction,
      providerDraftAction, customerDraftAction, checkSentAction,
      openDraftLink].some(element => !element) || typeof getBridge !== 'function' ||
      typeof now !== 'function' || !runtime ||
      ['signInFromClick', 'preview', 'createOrOpenProviderDraft',
        'createOrOpenCustomerDraft', 'verifySentBySelection']
        .some(method => typeof runtime[method] !== 'function')) {
    throw new TypeError('Complete parent controls and V2 adapter are required');
  }
  const enabled = runtime.enabled === true;
  let selected = null;
  let selectionEpoch = 0;
  let previewSequence = 0;
  let previewState = null;
  let previewLoading = false;
  let signedIn = false;
  let busyAction = false;
  let disposed = false;
  let draftSelection = null;
  let awayArmed = false;
  let returnCheckPending = false;
  let occupiedCheckEpoch = -1;
  const hostDocument = hostWindow?.document ?? null;

  toReview.readOnly = true;
  ccReview.readOnly = true;
  function setStatus(value) { actionStatus.textContent = value; }
  function clearDraftLink() {
    openDraftLink.hidden = true;
    openDraftLink.removeAttribute('href');
  }
  function clearPreview() {
    previewState = null;
    selectedStore.textContent = 'Store: unverified';
    toReview.value = '';
    ccReview.value = '';
    clearDraftLink();
  }
  function stillCurrent(target, epoch) {
    return !disposed && epoch === selectionEpoch &&
      sameSelection(target, selected) &&
      sameSelection(target, getBridge()?.getSelection());
  }
  function previewCanDraft() {
    const p = previewState?.preview;
    if (!p || previewState.epoch !== selectionEpoch ||
        !sameSelection(previewState.selection, selected) ||
        !sameSelection(selected, getBridge()?.getSelection()) ||
        p.canDraft !== true) return false;
    if (p.status === 'draft_occupied') return true;
    const expiry = Date.parse(p.validUntilUtc ?? '');
    return p.status === 'eligible' && Number.isFinite(expiry) && now() < expiry;
  }
  function render() {
    const bridgeMatches = sameSelection(selected, getBridge()?.getSelection());
    const canDraft = enabled && signedIn && !disposed && !busyAction &&
      !previewLoading && previewCanDraft();
    signInAction.disabled = !enabled || disposed || busyAction;
    verifyAction.disabled = !enabled || disposed || busyAction ||
      !signedIn || !bridgeMatches || previewLoading;
    providerDraftAction.disabled = !canDraft || selected?.kind !== 'provider';
    customerDraftAction.disabled = !canDraft || selected?.kind !== 'customer';
    // This attended receipt check can recover an occupied or changed source.
    checkSentAction.disabled = !enabled || disposed || busyAction ||
      !signedIn || !bridgeMatches;
    const showRecipients = enabled && !disposed &&
      previewState?.epoch === selectionEpoch &&
      previewState.preview.status === 'eligible' && bridgeMatches;
    toReview.disabled = !showRecipients;
    ccReview.disabled = !showRecipients;
  }
  async function loadPreview() {
    if (!enabled || !signedIn || disposed || busyAction || !selected ||
        !sameSelection(selected, getBridge()?.getSelection())) return;
    const target = {...selected};
    const epoch = selectionEpoch;
    const sequence = ++previewSequence;
    previewLoading = true;
    clearPreview();
    setStatus('Reading the protected source for this exact selection…');
    render();
    try {
      const preview = await runtime.preview(target.kind, target.id);
      if (!stillCurrent(target, epoch) || sequence !== previewSequence) return;
      if (!sameSelection(target, preview) || typeof preview.status !== 'string' ||
          !Array.isArray(preview.to) || !Array.isArray(preview.cc)) {
        throw held('SOURCE_PREVIEW_UNVERIFIED');
      }
      previewState = {selection: target, epoch, preview};
      selectedStore.textContent = target.kind === 'customer'
        ? 'Store: not part of this tracker release'
        : preview.storeNumber ? `Store: ${preview.storeNumber}`
          : 'Store: not shown for this draft state';
      toReview.value = preview.to.join('; ');
      ccReview.value = preview.cc.join('; ');
      setStatus(previewMessage(preview));
      if (preview.status === 'draft_occupied' &&
          occupiedCheckEpoch !== epoch) {
        occupiedCheckEpoch = epoch;
        returnCheckPending = true;
      }
    } catch (error) {
      if (stillCurrent(target, epoch) && sequence === previewSequence) {
        clearPreview();
        setStatus(`Source preview held: ${safeCode(error)}. Check Sent remains available.`);
      }
    } finally {
      if (stillCurrent(target, epoch) && sequence === previewSequence) {
        previewLoading = false;
        render();
        maybeAutoCheckSent();
      }
    }
  }
  function onSelection(value) {
    if (disposed) return;
    selectionEpoch += 1;
    previewSequence += 1;
    previewLoading = false;
    draftSelection = null;
    returnCheckPending = false;
    awayArmed = false;
    selected = value ? {kind: value.kind, id: value.id} : null;
    clearPreview();
    selectedIdentity.textContent = selected
      ? `Exact source ID: ${selected.id}` : 'Exact source ID: none selected';
    selectionText.textContent = selected
      ? `${selected.kind === 'provider' ? 'Work order' : 'FORM project'} selected for review.`
      : 'Select an exact work order or FORM project in the chart.';
    setStatus(enabled
      ? selected ? signedIn ? 'Checking selected source…'
        : 'Sign in to preview this selection.'
        : 'Select a work order or FORM project.' : '');
    render();
    if (enabled && signedIn && selected && !busyAction) void loadPreview();
  }
  async function runAction(button, event, job) {
    if (!enabled || disposed || busyAction || button.disabled) return;
    const startedAtEpoch = selectionEpoch;
    busyAction = true;
    render();
    try {
      trustedParentClick(event, button);
      await job();
    } catch (error) {
      if (!disposed && startedAtEpoch === selectionEpoch) {
        if (button === providerDraftAction || button === customerDraftAction) {
          clearPreview();
        }
        setStatus(`Action held: ${safeCode(error)}.`);
      }
    } finally {
      busyAction = false;
      if (!disposed) {
        render();
        if (startedAtEpoch !== selectionEpoch && signedIn && selected) {
          void loadPreview();
        }
        maybeAutoCheckSent();
      }
    }
  }
  async function onSignIn(event) {
    await runAction(signInAction, event, async () => {
      await runtime.signInFromClick();
      signedIn = true;
      setStatus('Signed in. Select a project or work order for a source preview.');
    });
    if (signedIn && selected && !previewLoading) void loadPreview();
  }
  async function onRefresh(event) {
    if (verifyAction.disabled || disposed) return;
    try { trustedParentClick(event, verifyAction); }
    catch (error) { setStatus(`Action held: ${safeCode(error)}.`); return; }
    await loadPreview();
  }
  function showResult(result, popup = null, fromDraft = false) {
    clearDraftLink();
    if (result?.state === 'draft') {
      const href = outlookLink(result.webLink);
      openDraftLink.href = href;
      openDraftLink.hidden = false;
      if (popup) {
        try { popup.location.replace(href); }
        catch { popup.close(); }
      }
      setStatus(draftMessage(result));
    } else if (result?.state === 'sent' ||
        result?.state === 'sent_with_changes') {
      popup?.close();
      clearPreview();
      setStatus(result.state === 'sent'
        ? 'Sent Items confirms this message. No new draft was made.'
        : 'Sent Items confirms this message with changes; review the receipt.');
    } else if (result?.state === 'held') {
      popup?.close();
      if (fromDraft) clearPreview();
      setStatus(HELD_MESSAGES[result.reason] ??
        `Action held: ${/^[A-Z0-9_]{3,80}$/u.test(result.reason ?? '')
          ? result.reason : 'ACTION_UNVERIFIED'}.`);
    } else {
      popup?.close();
      throw held('ACTION_RESULT_UNVERIFIED');
    }
  }
  function rememberDraftResult(result, target) {
    if (result?.state === 'draft') draftSelection = {...target};
    if (result?.state === 'sent' || result?.state === 'sent_with_changes') {
      draftSelection = null;
    }
  }
  async function autoCheckSent(target, epoch) {
    busyAction = true;
    clearDraftLink();
    setStatus('Checking Outlook Sent Items for this exact selection…');
    render();
    try {
      const result = await runtime.verifySentBySelection(target.kind, target.id);
      if (!stillCurrent(target, epoch)) return;
      showResult(result);
      rememberDraftResult(result, target);
    } catch (error) {
      if (stillCurrent(target, epoch)) {
        setStatus(`Sent check held: ${safeCode(error)}. Use Check Sent to retry.`);
      }
    } finally {
      busyAction = false;
      if (!disposed) {
        render();
        if (epoch !== selectionEpoch && signedIn && selected) {
          void loadPreview();
        }
        maybeAutoCheckSent();
      }
    }
  }
  function maybeAutoCheckSent() {
    if (!returnCheckPending || !enabled || !signedIn || disposed ||
        busyAction || previewLoading || !selected ||
        hostDocument?.visibilityState === 'hidden' ||
        !sameSelection(selected, getBridge()?.getSelection())) return;
    returnCheckPending = false;
    if (!sameSelection(draftSelection, selected) &&
        !(previewState?.epoch === selectionEpoch &&
          previewState.preview.status === 'draft_occupied')) return;
    void autoCheckSent({...selected}, selectionEpoch);
  }
  function onAway() {
    if (enabled && signedIn && !disposed && selected) awayArmed = true;
  }
  function onReturn() {
    if (!awayArmed || !enabled || !signedIn || disposed || !selected ||
        hostDocument?.visibilityState === 'hidden') return;
    awayArmed = false;
    returnCheckPending = true;
    maybeAutoCheckSent();
  }
  function onVisibilityChange() {
    if (hostDocument?.visibilityState === 'hidden') onAway();
    else onReturn();
  }
  async function onDraft(kind, event, button) {
    let popup = null;
    if (enabled && !button.disabled && event?.isTrusted === true) {
      try {
        popup = hostWindow?.open?.('about:blank', '_blank') ?? null;
        if (popup) popup.opener = null;
      } catch { popup = null; }
    }
    await runAction(button, event, async () => {
      const target = selected ? {...selected} : null;
      const epoch = selectionEpoch;
      if (target?.kind !== kind || !stillCurrent(target, epoch) ||
          !previewCanDraft()) throw held('SOURCE_PREVIEW_REQUIRED');
      clearDraftLink();
      const result = kind === 'provider'
        ? await runtime.createOrOpenProviderDraft(target.id)
        : await runtime.createOrOpenCustomerDraft(target.id);
      if (!stillCurrent(target, epoch)) { popup?.close(); return; }
      showResult(result, popup, true);
      rememberDraftResult(result, target);
    });
    // A failed or programmatic click must not leave an empty reserved tab.
    if (popup && !openDraftLink.href) popup.close();
  }
  async function onCheckSent(event) {
    await runAction(checkSentAction, event, async () => {
      const target = selected ? {...selected} : null;
      const epoch = selectionEpoch;
      if (!stillCurrent(target, epoch)) throw held('SOURCE_SELECTION_REQUIRED');
      previewSequence += 1;
      previewLoading = false;
      clearDraftLink();
      const result = await runtime.verifySentBySelection(target.kind, target.id);
      if (!stillCurrent(target, epoch)) return;
      showResult(result);
      rememberDraftResult(result, target);
    });
  }

  const onProviderDraft = event => onDraft('provider', event, providerDraftAction);
  const onCustomerDraft = event => onDraft('customer', event, customerDraftAction);
  signInAction.addEventListener('click', onSignIn);
  verifyAction.addEventListener('click', onRefresh);
  providerDraftAction.addEventListener('click', onProviderDraft);
  customerDraftAction.addEventListener('click', onCustomerDraft);
  checkSentAction.addEventListener('click', onCheckSent);
  hostWindow?.addEventListener?.('blur', onAway);
  hostWindow?.addEventListener?.('focus', onReturn);
  hostDocument?.addEventListener?.('visibilitychange', onVisibilityChange);
  heldReason.textContent = enabled
    ? 'This page makes editable Outlook drafts. Send and recipient edits stay in Outlook.'
    : HELD_COPY;
  clearPreview();
  onSelection(null);
  return Object.freeze({
    onSelection,
    dispose() {
      if (disposed) return;
      disposed = true;
      selectionEpoch += 1;
      previewSequence += 1;
      signInAction.removeEventListener('click', onSignIn);
      verifyAction.removeEventListener('click', onRefresh);
      providerDraftAction.removeEventListener('click', onProviderDraft);
      customerDraftAction.removeEventListener('click', onCustomerDraft);
      checkSentAction.removeEventListener('click', onCheckSent);
      hostWindow?.removeEventListener?.('blur', onAway);
      hostWindow?.removeEventListener?.('focus', onReturn);
      hostDocument?.removeEventListener?.('visibilitychange', onVisibilityChange);
      clearPreview();
      render();
    },
  });
}
