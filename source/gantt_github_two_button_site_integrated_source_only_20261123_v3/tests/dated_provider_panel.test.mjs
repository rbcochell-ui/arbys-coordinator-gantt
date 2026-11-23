import assert from 'node:assert/strict';
import test from 'node:test';
import {createDatedProviderReviewPanel} from
  '../site/actions/dated_provider_review_panel.mjs';

const WO = '0WOaaaaaaaaaaaaAAA';
function elements() {
  return Object.fromEntries(['panel', 'sourceAsOf', 'chartDate',
    'datedPhase', 'agentCode', 'storeNumber', 'thirstyLink',
    'recipientWarning', 'reviewWarning', 'status']
    .map(name => [name, {textContent: '', hidden: false,
      removeAttribute() {}}]));
}
function preview(eligibility) {
  return {kind: 'provider', id: WO, canDraft: false,
    eligibility, reasonCode: eligibility === 'linkage_held'
      ? 'LINKAGE_EVIDENCE_UNCONFIGURED' : 'VISIT_SCOPE_EXCLUDED',
    scopeClass: eligibility === 'scope_excluded' ? 'known_other' : 'fountain',
    sourceAsOfUtc: '2026-01-01T00:00:00Z',
    chartSnapshotAsOfDate: '2026-01-01',
    datedPhase: 'Pending Readiness', agentCode: 'K1', storeNumber: '201',
    thirstyUrl: `https://hubit.my.salesforce.com/lightning/r/WorkOrder/${WO}/view`,
    recipientSuggestion: 'none', to: []};
}

for (const [eligibility, expected] of [
  ['linkage_held', 'protected work order and verified contact pair match'],
  ['scope_excluded', 'outside the six-part fountain installation request'],
]) {
  test(`${eligibility} explains withheld contacts without claiming no pair`, async () => {
    const ui = elements();
    const panel = createDatedProviderReviewPanel({elements: ui,
      loadSnapshotPreview: async () => preview(eligibility)});
    panel.onSignedIn();
    panel.onSelection({kind: 'provider', id: WO});
    await panel.refresh();
    assert.match(ui.recipientWarning.textContent, new RegExp(expected, 'u'));
    assert.doesNotMatch(ui.recipientWarning.textContent,
      /No exact contact pair|To will be blank/iu);
    assert.match(ui.status.textContent, /Draft held:/u);
    if (eligibility === 'scope_excluded') {
      assert.match(ui.reviewWarning.textContent,
        /No six-part provider request is available for this visit/u);
      assert.doesNotMatch(ui.reviewWarning.textContent,
        /Do not send this draft/u);
    }
    panel.dispose();
  });
}

for (const to of [
  ['manager@example.invalid'],
  ['manager@example.invalid', 'planner@example.invalid'],
]) {
  test(`verified dated suggestion for ${to.length} role mailbox(es) uses future draft copy`, async () => {
    const ui = elements();
    const panel = createDatedProviderReviewPanel({elements: ui,
      loadSnapshotPreview: async () => ({
        ...preview('preinstall_snapshot_candidate'), reasonCode: null,
        recipientSuggestion: 'exact_saved_file_pair', to,
      })});
    panel.onSignedIn();
    panel.onSelection({kind: 'provider', id: WO});
    await panel.refresh();
    assert.match(ui.recipientWarning.textContent,
      /If you create an Outlook draft/u);
    assert.doesNotMatch(ui.recipientWarning.textContent,
      /are shown in the draft/u);
    assert.match(ui.status.textContent, /Dated pre-install candidate/u);
    panel.dispose();
  });
}

test('shared unverified Sent is occupied and cannot be described as confirmed', async () => {
  const ui = elements();
  const panel = createDatedProviderReviewPanel({elements: ui,
    loadSnapshotPreview: async () => ({kind: 'provider', id: WO,
      canDraft: false, sourceAvailable: false,
      existingStatus: 'sent_recorded_unverified',
      thirstyUrl: `https://hubit.my.salesforce.com/lightning/r/WorkOrder/${WO}/view`})});
  panel.onSignedIn();
  panel.onSelection({kind: 'provider', id: WO});
  await panel.refresh();
  assert.match(ui.status.textContent,
    /shared Sent record exists.*verify it/u);
  assert.doesNotMatch(ui.status.textContent, /receipt is recorded/u);
  assert.match(ui.recipientWarning.textContent, /No second draft/u);
  panel.dispose();
});
