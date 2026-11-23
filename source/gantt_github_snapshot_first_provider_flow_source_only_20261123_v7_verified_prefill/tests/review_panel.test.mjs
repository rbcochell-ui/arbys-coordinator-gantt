import assert from 'node:assert/strict';
import test from 'node:test';
import {createDatedProviderReviewPanel} from '../dated_provider_review_panel.mjs';

const WO = '0WO123456789012345';
const OTHER = '0WO123456789012346';
const THIRSTY = `https://hubit.my.salesforce.com/lightning/r/WorkOrder/${WO}/view`;

class FakeElement {
  constructor() {
    this.textContent = '';
    this.hidden = false;
    this.href = undefined;
  }
  removeAttribute(name) { delete this[name]; }
}
function elements() {
  return Object.fromEntries(['panel', 'sourceAsOf', 'chartDate',
    'datedPhase', 'agentCode', 'storeNumber', 'thirstyLink',
    'recipientWarning', 'reviewWarning', 'status']
    .map(name => [name, new FakeElement()]));
}
function preview(id = WO, overrides = {}) {
  return {kind: 'provider', id, canDraft: false,
    eligibility: 'preinstall_snapshot_candidate',
    reasonCode: 'DATED_PREINSTALL_CANDIDATE',
    sourceAsOfUtc: '2026-11-22T18:43:09Z',
    chartSnapshotAsOfDate: '2026-11-18',
    datedPhase: 'Pending Readiness', agentCode: 'A1',
    storeNumber: '1001', thirstyUrl: THIRSTY,
    recipientSuggestion: 'exact_saved_file_pair',
    to: ['manager@example.invalid', 'planner@example.invalid'],
    ...overrides};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('panel shows dated source and Outlook review copy after sign-in with no extra click', async () => {
  const e = elements();
  const calls = [];
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => { calls.push(id); return preview(id); }});
  panel.onSelection({kind: 'provider', id: WO});
  assert.deepEqual(calls, []);
  assert.match(e.status.textContent, /Sign in/);
  assert.throws(() => panel.selectionPort.capture(WO),
    {code: 'DATED_PREVIEW_SELECTION_REQUIRED'});
  panel.onSignedIn();
  await flush();
  assert.deepEqual(calls, [WO]);
  assert.equal(e.thirstyLink.href, THIRSTY);
  assert.equal(e.thirstyLink.hidden, false);
  assert.match(e.sourceAsOf.textContent, /2026-11-22/);
  assert.match(e.reviewWarning.textContent, /Check the current WO phase/);
  assert.match(e.reviewWarning.textContent, /Outlook before Send/);
  const token = panel.selectionPort.capture(WO);
  assert.equal(panel.selectionPort.isCurrent(token), true);
  await panel.selectionPort.ensureReady(WO);
});

test('parent preview waits until the dated panel is visibly ready', async () => {
  const e = elements();
  const pending = [];
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: id => new Promise(resolve => pending.push({id, resolve}))});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  const ready = panel.selectionPort.ensureReady(WO);
  assert.equal(pending.length, 2);
  // Exact selection is capturable for an existing-draft resume, but a first
  // draft still waits on ensureReady before its Claim.
  assert.equal(panel.selectionPort.capture(WO).id, WO);
  pending[1].resolve(preview(WO));
  await ready;
  assert.equal(e.thirstyLink.hidden, false);
  assert.equal(panel.selectionPort.capture(WO).id, WO);
  pending[0].resolve(preview(WO));
  await flush();
  assert.equal(e.thirstyLink.href, THIRSTY);
});

test('missing contact suggestion says Outlook To will be blank and selection clears readiness', async () => {
  const e = elements();
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => preview(id,
      {recipientSuggestion: 'none', to: []})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await flush();
  assert.match(e.recipientWarning.textContent, /Outlook draft To will be blank/);
  const token = panel.selectionPort.capture(WO);
  panel.onSelection(null);
  assert.equal(e.panel.hidden, true);
  assert.equal(e.thirstyLink.hidden, true);
  assert.equal(panel.selectionPort.isCurrent(token), false);
  assert.throws(() => panel.selectionPort.capture(WO),
    {code: 'DATED_PREVIEW_SELECTION_REQUIRED'});
});

test('dated chart addresses appear only as copyable suggestions when protected pair is unavailable', async () => {
  const e = elements();
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => preview(id, {
      recipientEvidence: 'manual_entry', to: [],
      datedManagerEmail: 'manager@example.invalid',
      datedPlannerEmail: 'planner@example.invalid'})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await flush();
  assert.match(e.recipientWarning.textContent, /Dated Gantt suggestion only/);
  assert.match(e.recipientWarning.textContent, /manager@example\.invalid/);
  assert.match(e.recipientWarning.textContent, /planner@example\.invalid/);
  assert.match(e.recipientWarning.textContent, /Outlook draft To will be blank/);
  assert.match(e.recipientWarning.textContent, /copy or enter/);
  assert.equal(panel.selectionPort.capture(WO).id, WO);
});

test('verified protected recipients are described as Outlook prefill even without chart suggestions', async () => {
  const e = elements();
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => preview(id, {
      recipientSuggestion: 'none', recipientEvidence: 'verified_pair',
      to: ['manager@example.invalid', 'planner@example.invalid'],
      datedManagerEmail: null, datedPlannerEmail: null})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await flush();
  assert.match(e.recipientWarning.textContent, /current verified protected/);
  assert.match(e.recipientWarning.textContent, /prefilled in Outlook/);
  assert.doesNotMatch(e.recipientWarning.textContent, /Dated Gantt suggestion/);
});

test('A-B-A pending preview cannot revive an old selection or its Thirsty link', async () => {
  const e = elements();
  const pending = [];
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: id => new Promise(resolve => pending.push({id, resolve}))});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  const firstToken = panel.selectionPort.capture(WO);
  panel.onSelection({kind: 'provider', id: OTHER});
  panel.onSelection({kind: 'provider', id: WO});
  assert.equal(pending.length, 3);
  pending[0].resolve(preview(WO));
  pending[1].resolve(preview(OTHER, {thirstyUrl:
    `https://hubit.my.salesforce.com/lightning/r/WorkOrder/${OTHER}/view`}));
  await flush();
  assert.equal(panel.selectionPort.isCurrent(firstToken), false);
  assert.equal(e.thirstyLink.href, undefined);
  pending[2].resolve(preview(WO));
  await flush();
  assert.equal(panel.selectionPort.capture(WO).epoch, 3);
  assert.equal(e.thirstyLink.href, THIRSTY);
});

test('wrong Thirsty link fails closed and never marks selection ready', async () => {
  const e = elements();
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => preview(id,
      {thirstyUrl: 'https://example.invalid/wrong'})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await flush();
  assert.match(e.status.textContent, /THIRSTY_LINK_INVALID/);
  assert.equal(e.thirstyLink.href, undefined);
  assert.equal(panel.selectionPort.capture(WO).id, WO);
  await assert.rejects(() => panel.selectionPort.ensureReady(WO),
    {code: 'DATED_PREVIEW_SELECTION_REQUIRED'});
});

test('expired-source occupied state shows reopen without arming a first draft', async () => {
  const e = elements();
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => ({kind: 'provider', id,
      canDraft: false, sourceAvailable: false,
      existingStatus: 'draft_occupied',
      thirstyUrl: THIRSTY})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await flush();
  assert.match(e.status.textContent, /can be reopened/);
  assert.match(e.sourceAsOf.textContent, /not rechecked for this existing draft/);
  assert.match(e.reviewWarning.textContent, /current Thirsty phase/);
  assert.equal(e.thirstyLink.href, THIRSTY);
  const token = panel.selectionPort.capture(WO);
  assert.equal(panel.selectionPort.isCurrent(token), true);
  await assert.rejects(() => panel.selectionPort.ensureReady(WO),
    {code: 'DATED_PREVIEW_SELECTION_REQUIRED'});
});

test('unknown fountain scope shows a strong do-not-send-if-other warning', async () => {
  const e = elements();
  const panel = createDatedProviderReviewPanel({elements: e,
    loadSnapshotPreview: async id => preview(id, {scopeClass: 'unknown'})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await flush();
  assert.match(e.reviewWarning.textContent, /does not confirm fountain dispenser/);
  assert.match(e.reviewWarning.textContent, /filter-only, survey, line-run, or fire-up/);
  assert.match(e.reviewWarning.textContent, /do not send/);
});
