import assert from 'node:assert/strict';
import test from 'node:test';
import {createCoordinatorActionUi} from '../site/actions/ui_controller.mjs';

const WO = '0WO123456789012345';
const FORM = 'F:12345:67890';
const DRAFT_LINK = 'https://outlook.office.com/mail/deeplink/compose/invented';

class FakeEvents {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  async emit(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({type, currentTarget: this});
    }
  }
}
class FakeElement extends FakeEvents {
  disabled = false;
  hidden = false;
  readOnly = false;
  textContent = '';
  value = '';
  href = '';
  removeAttribute(name) { if (name === 'href') this.href = ''; }
  async click() {
    for (const listener of this.listeners.get('click') ?? []) {
      await listener({type: 'click', isTrusted: true, currentTarget: this});
    }
  }
}
function elements() {
  return Object.fromEntries(['selectionText', 'selectedIdentity',
    'selectedStore', 'toReview', 'ccReview', 'heldReason', 'actionStatus',
    'signInAction', 'verifyAction', 'providerDraftAction',
    'customerDraftAction', 'checkSentAction', 'openDraftLink']
    .map(name => [name, new FakeElement()]));
}
async function until(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('UI did not reach the expected state');
}
function harness({enabled = true, previewStatus = 'eligible',
    previewTo = undefined, previewRecipientReviewRequired = false,
    previewRecipientEvidence = undefined,
    previewBinding = undefined,
    checkResult = {state: 'sent'},
    draftResult = {state: 'draft', webLink: DRAFT_LINK}} = {}) {
  const calls = [];
  const hostWindow = new FakeEvents();
  hostWindow.document = new FakeEvents();
  hostWindow.document.visibilityState = 'visible';
  hostWindow.open = () => null;
  const controls = elements();
  let bridgeSelection = null;
  const runtime = {
    enabled,
    async signInFromClick() { calls.push(['signIn']); },
    async preview(kind, id) {
      calls.push(['preview', kind, id]);
      const to = previewTo ?? (kind === 'provider' ?
        ['manager@example.invalid', 'planner@example.invalid'] : []);
      const binding = typeof previewBinding === 'function'
        ? previewBinding(kind, id) : previewBinding ??
          (kind === 'provider' && previewStatus === 'eligible' ?
            Object.freeze({nativeWoId: id,
              releaseSourceSha256: 'a'.repeat(64),
              protectedJoinSha256: 'b'.repeat(64),
              to: [...to], cc: [],
              validUntilMs: Date.parse('2099-01-01T00:00:00Z')}) : undefined);
      return {kind, id, status: previewStatus,
        canDraft: previewStatus === 'eligible' ||
          previewStatus === 'draft_occupied',
        validUntilUtc: '2099-01-01T00:00:00Z',
        storeNumber: kind === 'provider' ? '1001' : null,
        to, cc: [],
        recipientReviewRequired: previewRecipientReviewRequired,
        recipientEvidence: previewRecipientEvidence === undefined
          ? kind === 'provider' && to.length > 0
            ? 'verified_pair' : null
          : previewRecipientEvidence,
        binding};
    },
    async createOrOpenProviderDraft(id, binding) {
      calls.push(['providerDraft', id, binding]);
      return typeof draftResult === 'function' ? draftResult('provider', id)
        : draftResult;
    },
    async createOrOpenCustomerDraft(id, binding) {
      calls.push(['customerDraft', id, binding]);
      return typeof draftResult === 'function' ? draftResult('customer', id)
        : draftResult;
    },
    async verifySentBySelection(kind, id) {
      calls.push(['checkSent', kind, id]);
      return typeof checkResult === 'function'
        ? checkResult(kind, id) : checkResult;
    },
  };
  const ui = createCoordinatorActionUi({runtime, elements: controls,
    hostWindow, getBridge: () => ({getSelection: () => bridgeSelection})});
  return {calls, controls, hostWindow, ui,
    select(kind, id) {
      bridgeSelection = kind ? {kind, id} : null;
      ui.onSelection(bridgeSelection);
    },
    async signIn() {
      await controls.signInAction.click();
      await until(() => calls.some(call => call[0] === 'preview'));
      await until(() => controls.verifyAction.disabled === false);
    }};
}

test('checked-in disabled site does not read a mailbox on return', async () => {
  const h = harness({enabled: false});
  h.select('provider', WO);
  await h.hostWindow.emit('blur');
  await h.hostWindow.emit('focus');
  h.hostWindow.document.visibilityState = 'hidden';
  await h.hostWindow.document.emit('visibilitychange');
  h.hostWindow.document.visibilityState = 'visible';
  await h.hostWindow.document.emit('visibilitychange');
  assert.deepEqual(h.calls, []);
  assert.equal(h.controls.providerDraftAction.disabled, true);
  h.ui.dispose();
});

test('eligible populated provider To shows review copy, never blank-To copy', async () => {
  const h = harness({previewTo: ['manager@example.invalid',
    'planner@example.invalid'], previewRecipientReviewRequired: true});
  h.select('provider', WO);
  await h.signIn();
  await until(() => /Suggested recipients need verification/u.test(
    h.controls.actionStatus.textContent));
  assert.equal(h.controls.toReview.value,
    'manager@example.invalid; planner@example.invalid');
  assert.doesNotMatch(h.controls.actionStatus.textContent, /To is blank/u);
  h.ui.dispose();
});

test('manual-entry provider preview keeps To blank and arms one editable draft', async () => {
  const h = harness({previewTo: [],
    previewRecipientReviewRequired: true,
    previewRecipientEvidence: 'manual_entry'});
  h.select('provider', WO);
  await h.signIn();
  await until(() => /To is blank/u.test(
    h.controls.actionStatus.textContent));
  assert.equal(h.controls.toReview.value, '');
  assert.equal(h.controls.providerDraftAction.disabled, false);
  await h.controls.providerDraftAction.click();
  const call = h.calls.find(item => item[0] === 'providerDraft');
  assert.equal(call?.[1], WO);
  assert.deepEqual(call?.[2]?.to, []);
  h.ui.dispose();
});

test('blank provider To without manual-entry evidence stays held', async () => {
  const h = harness({previewTo: [],
    previewRecipientReviewRequired: true});
  h.select('provider', WO);
  await h.signIn();
  await until(() => /PROVIDER_PREVIEW_BINDING_INVALID/u.test(
    h.controls.actionStatus.textContent));
  assert.equal(h.controls.providerDraftAction.disabled, true);
  h.ui.dispose();
});

test('populated provider To without verified-pair evidence stays held', async () => {
  const h = harness({previewRecipientEvidence: null});
  h.select('provider', WO);
  await h.signIn();
  await until(() => /PROVIDER_PREVIEW_BINDING_INVALID/u.test(
    h.controls.actionStatus.textContent));
  assert.equal(h.controls.providerDraftAction.disabled, true);
  h.ui.dispose();
});

test('provider click carries the binding for the displayed verified pair', async () => {
  const to = ['manager@example.invalid', 'planner@example.invalid'];
  const binding = Object.freeze({nativeWoId: WO,
    releaseSourceSha256: 'a'.repeat(64),
    protectedJoinSha256: 'b'.repeat(64),
    to: Object.freeze([...to]), cc: Object.freeze([]),
    validUntilMs: Date.parse('2099-01-01T00:00:00Z')});
  const h = harness({previewTo: to, previewBinding: binding});
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  assert.equal(h.controls.toReview.value, to.join('; '));
  await h.controls.providerDraftAction.click();
  assert.deepEqual(h.calls.find(call => call[0] === 'providerDraft'),
    ['providerDraft', WO, binding]);
  h.ui.dispose();
});

test('suggested provider pair is prefilled and visibly requires Outlook review', async () => {
  const h = harness({previewRecipientEvidence: 'suggested_pair',
    previewRecipientReviewRequired: true});
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  assert.equal(h.controls.toReview.value,
    'manager@example.invalid; planner@example.invalid');
  assert.match(h.controls.actionStatus.textContent,
    /Suggested recipients need verification in Outlook before Send/);
  await h.controls.providerDraftAction.click();
  assert.equal(h.calls.filter(call => call[0] === 'providerDraft').length, 1);
  h.ui.dispose();
});

test('suggested provider pair without the review flag remains held', async () => {
  const h = harness({previewRecipientEvidence: 'suggested_pair',
    previewRecipientReviewRequired: false});
  h.select('provider', WO);
  await h.signIn();
  await until(() => /PROVIDER_PREVIEW_BINDING_INVALID/u.test(
    h.controls.actionStatus.textContent));
  assert.equal(h.controls.providerDraftAction.disabled, true);
  h.ui.dispose();
});

test('provider click holds if the displayed To changed after preview', async () => {
  const h = harness();
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  h.controls.toReview.value = 'unseen@example.invalid';
  await h.controls.providerDraftAction.click();
  assert.equal(h.calls.some(call => call[0] === 'providerDraft'), false);
  assert.match(h.controls.actionStatus.textContent,
    /SOURCE_PREVIEW_REQUIRED/u);
  h.ui.dispose();
});

test('return from Outlook records actual Sent once for the exact draft', async () => {
  const h = harness();
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  await h.controls.providerDraftAction.click();
  assert.equal(h.calls.filter(call => call[0] === 'providerDraft').length, 1);
  assert.equal(h.controls.openDraftLink.href, DRAFT_LINK);
  await h.hostWindow.emit('blur');
  await h.hostWindow.emit('focus');
  await until(() => h.calls.filter(call => call[0] === 'checkSent').length === 1);
  await until(() => /Sent Items confirms/u.test(h.controls.actionStatus.textContent));
  await h.hostWindow.emit('focus');
  assert.equal(h.calls.filter(call => call[0] === 'checkSent').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'providerDraft').length, 1);
  assert.equal(h.controls.providerDraftAction.disabled, true);
  h.ui.dispose();
});

test('hidden tab waits for visibility before checking Sent', async () => {
  const h = harness();
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  await h.controls.providerDraftAction.click();
  h.hostWindow.document.visibilityState = 'hidden';
  await h.hostWindow.document.emit('visibilitychange');
  await h.hostWindow.emit('focus');
  assert.equal(h.calls.some(call => call[0] === 'checkSent'), false);
  h.hostWindow.document.visibilityState = 'visible';
  await h.hostWindow.document.emit('visibilitychange');
  await until(() => h.calls.filter(call => call[0] === 'checkSent').length === 1);
  await h.hostWindow.emit('focus');
  assert.equal(h.calls.filter(call => call[0] === 'checkSent').length, 1);
  h.ui.dispose();
});

test('a return during the draft write waits for that one draft result', async () => {
  let releaseDraft;
  const h = harness({draftResult: () => new Promise(resolve => {
    releaseDraft = resolve;
  })});
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  const draftClick = h.controls.providerDraftAction.click();
  await until(() => typeof releaseDraft === 'function');
  await h.hostWindow.emit('blur');
  await h.hostWindow.emit('focus');
  assert.equal(h.calls.some(call => call[0] === 'checkSent'), false);
  releaseDraft({state: 'draft', webLink: DRAFT_LINK});
  await draftClick;
  await until(() => h.calls.filter(call => call[0] === 'checkSent').length === 1);
  assert.equal(h.calls.filter(call => call[0] === 'providerDraft').length, 1);
  h.ui.dispose();
});

test('a newly reopened own occupied draft is checked without a second draft', async () => {
  const h = harness({previewStatus: 'draft_occupied',
    checkResult: {state: 'sent'}});
  h.select('customer', FORM);
  await h.signIn();
  await until(() => h.calls.filter(call => call[0] === 'checkSent').length === 1);
  assert.deepEqual(h.calls.find(call => call[0] === 'checkSent'),
    ['checkSent', 'customer', FORM]);
  assert.equal(h.calls.some(call => call[0] === 'customerDraft'), false);
  await until(() => /Sent Items confirms/u.test(h.controls.actionStatus.textContent));
  h.ui.dispose();
});

test('another coordinator’s occupied key stays held on focus', async () => {
  const h = harness({previewStatus: 'draft_status_unverified',
    checkResult: {state: 'held', reason: 'DRAFT_OWNED_ELSEWHERE'}});
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === true);
  await h.hostWindow.emit('blur');
  await h.hostWindow.emit('focus');
  assert.equal(h.calls.some(call => call[0] === 'checkSent'), false);
  assert.equal(h.calls.some(call => call[0] === 'providerDraft'), false);
  assert.match(h.controls.actionStatus.textContent,
    /Another coordinator owns an unresolved draft/u);
  h.ui.dispose();
});

test('a shared Sent row stays visibly unverified and cannot arm either draft', async () => {
  const h = harness({previewStatus: 'sent_recorded_unverified',
    checkResult: {state: 'held', reason: 'SHARED_SENT_RECORD_UNVERIFIED'}});
  h.select('customer', FORM);
  await h.signIn();
  await until(() => /shared Sent record exists/u.test(
    h.controls.actionStatus.textContent));
  assert.equal(h.controls.providerDraftAction.disabled, true);
  assert.equal(h.controls.customerDraftAction.disabled, true);
  assert.equal(h.calls.some(call => call[0] === 'customerDraft'), false);
  await h.controls.checkSentAction.click();
  assert.match(h.controls.actionStatus.textContent,
    /draft owner can use Check Sent to verify it in their mailbox/u);
  assert.equal(h.calls.some(call => call[0] === 'customerDraft'), false);
  h.ui.dispose();
});

test('a changed selection discards an in-flight Sent result', async () => {
  let releaseCheck;
  const h = harness({checkResult: () => new Promise(resolve => {
    releaseCheck = resolve;
  })});
  h.select('provider', WO);
  await h.signIn();
  await until(() => h.controls.providerDraftAction.disabled === false);
  await h.controls.providerDraftAction.click();
  await h.hostWindow.emit('blur');
  await h.hostWindow.emit('focus');
  await until(() => typeof releaseCheck === 'function');
  assert.equal(h.controls.openDraftLink.hidden, true);
  h.select('customer', FORM);
  releaseCheck({state: 'sent'});
  await until(() => h.calls.some(call => call[0] === 'preview' &&
    call[1] === 'customer'));
  await until(() => h.controls.customerDraftAction.disabled === false);
  assert.equal(h.controls.selectedIdentity.textContent,
    `Exact source ID: ${FORM}`);
  assert.doesNotMatch(h.controls.actionStatus.textContent,
    /Sent Items confirms/u);
  h.ui.dispose();
});


test('eligible customer click carries the exact displayed Release binding', async () => {
  const binding = Object.freeze({formSourceKey: FORM,
    recipientEmail: 'customer@example.invalid',
    trackerUrlSha256: 'a'.repeat(64), sourceDigest: 'b'.repeat(64),
    sourceETagsJson: '{"release":{"etag":"1"}}',
    validUntilMs: Date.parse('2099-01-01T00:00:00Z')});
  const h = harness({previewTo: [binding.recipientEmail],
    previewBinding: binding});
  h.select('customer', FORM);
  await h.signIn();
  await until(() => h.controls.customerDraftAction.disabled === false);
  assert.equal(h.controls.toReview.value, binding.recipientEmail);
  assert.match(h.controls.actionStatus.textContent,
    /FORM Primary Contact is a suggested recipient, not proof of who clicked Submit/u);
  await h.controls.customerDraftAction.click();
  assert.deepEqual(h.calls.find(call => call[0] === 'customerDraft'),
    ['customerDraft', FORM, binding]);
  assert.match(h.controls.actionStatus.textContent,
    /Verify the customer in Outlook before Send/u);
  h.ui.dispose();
});

test('customer selection change clears the old binding before a new draft', async () => {
  const secondForm = 'F:12345678:9999999999';
  const firstBinding = Object.freeze({formSourceKey: FORM,
    recipientEmail: 'first@example.invalid'});
  const secondBinding = Object.freeze({formSourceKey: secondForm,
    recipientEmail: 'second@example.invalid'});
  const h = harness({previewBinding: (_kind, id) =>
    id === FORM ? firstBinding : secondBinding});
  h.select('customer', FORM);
  await h.signIn();
  await until(() => h.controls.customerDraftAction.disabled === false);
  h.select('customer', secondForm);
  assert.equal(h.controls.customerDraftAction.disabled, true);
  await until(() => h.controls.customerDraftAction.disabled === false);
  await h.controls.customerDraftAction.click();
  assert.deepEqual(h.calls.filter(call => call[0] === 'customerDraft'),
    [['customerDraft', secondForm, secondBinding]]);
  h.ui.dispose();
});
