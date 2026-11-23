/**
 * Nonblocking dated-source panel for the held parent shell. This does not
 * ask for a second confirmation click or create a draft. The sole draft
 * gesture stays the parent button; review and Send stay in Outlook.
 */
const CODE = /^[A-Z0-9_]{3,80}$/u;
const THIRSTY_BASE = 'https://hubit.my.salesforce.com/lightning/r/WorkOrder/';
const OCCUPIED = new Set(['draft_occupied', 'draft_status_unverified',
  'legacy_occupied', 'claim_outcome_unverified', 'sent',
  'sent_with_changes', 'sent_recorded_unverified']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function selectionOf(value) {
  return value?.kind === 'provider' && typeof value.id === 'string'
    ? {kind: 'provider', id: value.id} : null;
}
function safeCode(error) {
  return CODE.test(error?.code ?? '') ? error.code : 'DATED_PREVIEW_UNVERIFIED';
}
function exactThirstyUrl(value, id) {
  const expected = `${THIRSTY_BASE}${encodeURIComponent(id)}/view`;
  if (typeof value !== 'string' || value !== expected) fail('THIRSTY_LINK_INVALID');
  return expected;
}
function recipientCopy(preview) {
  if (preview.eligibility === 'linkage_held') {
    return 'Provider contacts are withheld until the protected Case, FORM, location, agent, and owner approval evidence is verified. No provider draft is available.';
  }
  if (preview.eligibility === 'scope_excluded') {
    return 'Provider contacts are withheld because this visit is outside the six-part fountain installation request. No provider draft is available.';
  }
  if (preview.recipientSuggestion !== 'exact_saved_file_pair' ||
      !Array.isArray(preview.to) || preview.to.length === 0) {
    return 'No exact contact pair in this dated snapshot. The Outlook draft To will be blank. Enter and verify the installation manager and planner before Send.';
  }
  if (preview.to.length === 1) {
    return 'Dated suggestion: one mailbox covers both contact roles. If you create an Outlook draft, verify it there before Send.';
  }
  return 'If you create an Outlook draft, the dated installation manager and planner suggestions will be prefilled. Verify both there before Send.';
}

/**
 * Call onSelection for every parent bridge event and onSignedIn after normal
 * delegated sign-in. `selectionPort` is passed to the snapshot providerFlow.
 */
export function createDatedProviderReviewPanel({elements,
    loadSnapshotPreview} = {}) {
  const {panel, sourceAsOf, chartDate, datedPhase, agentCode,
    storeNumber, thirstyLink, recipientWarning, reviewWarning,
    status} = elements ?? {};
  if ([panel, sourceAsOf, chartDate, datedPhase, agentCode,
      storeNumber, thirstyLink, recipientWarning, reviewWarning,
      status].some(value => !value) ||
      typeof loadSnapshotPreview !== 'function') {
    throw new TypeError('Complete dated-source panel and preview loader required');
  }
  let signedIn = false;
  let selected = null;
  let epoch = 0;
  let sequence = 0;
  let loaded = null;
  let disposed = false;

  function clear() {
    loaded = null;
    sourceAsOf.textContent = '';
    chartDate.textContent = '';
    datedPhase.textContent = '';
    agentCode.textContent = '';
    storeNumber.textContent = '';
    thirstyLink.removeAttribute('href');
    thirstyLink.hidden = true;
    recipientWarning.textContent = '';
    reviewWarning.textContent = '';
    status.textContent = '';
  }
  function current(target, startedEpoch, startedSequence) {
    return !disposed && selected?.kind === 'provider' &&
      selected.id === target.id && epoch === startedEpoch &&
      sequence === startedSequence;
  }
  async function refresh() {
    if (disposed || !signedIn || !selected) return;
    const target = {...selected};
    const startedEpoch = epoch;
    const startedSequence = ++sequence;
    clear();
    status.textContent = 'Reading the approved dated Gantt snapshot…';
    panel.hidden = false;
    try {
      const preview = await loadSnapshotPreview(target.id);
      if (!current(target, startedEpoch, startedSequence)) return;
      if (preview?.kind === 'provider' && preview.id === target.id &&
          preview.canDraft === false && preview.sourceAvailable === false &&
          OCCUPIED.has(preview.existingStatus)) {
        // An occupied key can reopen its own existing Outlook draft even
        // after the dated Release expires. This panel cannot arm a first draft.
        const href = exactThirstyUrl(preview.thirstyUrl, target.id);
        sourceAsOf.textContent = 'Dated source not rechecked for this existing draft.';
        thirstyLink.href = href;
        thirstyLink.hidden = false;
        recipientWarning.textContent = preview.existingStatus === 'draft_occupied'
          ? 'Open the existing Outlook draft and verify To/Cc before Send.'
          : 'The shared key is occupied. No second draft will be created.';
        reviewWarning.textContent = 'Check current Thirsty phase, parts need, assigned agent, service date and fountain scope before sending any existing draft. Review all six myCoke links in Outlook.';
        status.textContent = preview.existingStatus === 'draft_occupied'
          ? 'Existing Outlook draft can be reopened for review.'
          : preview.existingStatus === 'sent_recorded_unverified'
            ? 'A shared Sent record exists. Check Sent in the draft owner’s mailbox to verify it.'
          : preview.existingStatus === 'sent' ||
              preview.existingStatus === 'sent_with_changes'
            ? 'A Sent Items receipt is recorded for this WO.'
            : 'This WO is already claimed; no new draft is available here.';
        return;
      }
      if (preview?.kind !== 'provider' || preview.id !== target.id ||
          preview.canDraft !== false ||
          typeof preview.sourceAsOfUtc !== 'string' ||
          typeof preview.chartSnapshotAsOfDate !== 'string' ||
          typeof preview.datedPhase !== 'string' ||
          typeof preview.agentCode !== 'string') {
        fail('DATED_PREVIEW_UNVERIFIED');
      }
      const href = exactThirstyUrl(preview.thirstyUrl, target.id);
      loaded = {id: target.id, epoch: startedEpoch};
      sourceAsOf.textContent = `Source observed: ${preview.sourceAsOfUtc}`;
      chartDate.textContent = `Chart snapshot: ${preview.chartSnapshotAsOfDate}`;
      datedPhase.textContent = `Dated phase: ${preview.datedPhase}`;
      agentCode.textContent = `Dated SP agent: ${preview.agentCode}`;
      storeNumber.textContent = preview.storeNumber
        ? `Store: ${preview.storeNumber}` : 'Store: not recorded in this source';
      thirstyLink.href = href;
      thirstyLink.hidden = false;
      recipientWarning.textContent = recipientCopy(preview);
      reviewWarning.textContent = preview.scopeClass === 'unknown'
        ? 'Scope review required: this dated service label does not confirm fountain dispenser work. In Thirsty, confirm the current WO is a fountain installation or relocation before Send. If it is filter-only, survey, line-run, or fire-up, do not send the six-part request. Also verify phase, parts need, agent, date, To/Cc, and all six links in Outlook.'
        : preview.scopeClass === 'known_other'
          ? 'This service label identifies work outside the six-part fountain installation request. No six-part provider request is available for this visit.'
          : 'This source is dated. Check the current WO phase, need for parts, assigned agent, service date and scope in Thirsty. Review To/Cc and all six myCoke links in Outlook before Send.';
      status.textContent = preview.eligibility === 'preinstall_snapshot_candidate'
        ? 'Dated pre-install candidate. Outlook review is required before Send.'
        : `Draft held: ${CODE.test(preview.reasonCode ?? '')
          ? preview.reasonCode : 'VISIT_NEEDS_REVIEW'}.`;
    } catch (error) {
      if (current(target, startedEpoch, startedSequence)) {
        clear();
        status.textContent = `Dated preview held: ${safeCode(error)}.`;
      }
    }
  }

  clear();
  panel.hidden = true;
  return Object.freeze({
    selectionPort: Object.freeze({
      async ensureReady(id) {
        if (!signedIn || selected?.id !== id || disposed) {
          fail('DATED_PREVIEW_SELECTION_REQUIRED');
        }
        if (!loaded || loaded.epoch !== epoch || loaded.id !== id) {
          await refresh();
        }
        if (!loaded || loaded.epoch !== epoch || loaded.id !== id) {
          fail('DATED_PREVIEW_SELECTION_REQUIRED');
        }
      },
      capture(id) {
        if (!signedIn || disposed || selected?.id !== id) {
          fail('DATED_PREVIEW_SELECTION_REQUIRED');
        }
        return Object.freeze({kind: 'provider', id, epoch});
      },
      isCurrent(token) {
        return !disposed && signedIn && selected?.id === token?.id &&
          token?.kind === 'provider' && token?.epoch === epoch;
      },
    }),
    onSelection(value) {
      if (disposed) return;
      epoch += 1;
      sequence += 1;
      selected = selectionOf(value);
      clear();
      panel.hidden = !selected;
      if (selected) {
        status.textContent = signedIn
          ? 'Reading the approved dated Gantt snapshot…'
          : 'Sign in to view the dated provider source.';
        if (signedIn) void refresh();
      }
    },
    onSignedIn() {
      if (disposed) return;
      signedIn = true;
      if (selected) void refresh();
    },
    refresh,
    dispose() {
      disposed = true;
      epoch += 1;
      sequence += 1;
      clear();
      panel.hidden = true;
    },
  });
}
