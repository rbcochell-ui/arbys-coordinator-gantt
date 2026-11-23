import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {LeanGanttActions} from '../../github_gantt_graph_actions_lean_source_only_20261122_v3/actions.mjs';
import {canonicalCustomerBody, HeldActionError} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {createV2ParentAdapter} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/snapshot_parent_adapter.mjs';

const FORM = 'F:123:456';
const NOW = Date.parse('2026-11-23T12:00:00Z');
const recipientA = 'a@example.invalid';
const recipientB = 'b@example.invalid';
const trackerA =
  'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  '?p=p_' + 'a'.repeat(32) + '#k=' + 'A'.repeat(43);
const trackerB =
  'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  '?p=p_' + 'b'.repeat(32) + '#k=' + 'B'.repeat(43);
const sha = value => createHash('sha256').update(value).digest('hex');

function release(recipient, tracker, etag) {
  return {formSourceKey: FORM, recipientEmail: recipient,
    trackerUrl: tracker, subject: 'Invented tracker update',
    htmlBody: canonicalCustomerBody(tracker),
    digest: sha(recipient + tracker + etag),
    etagsJson: JSON.stringify({release: {itemId: '1', etag}}),
    validUntilMs: NOW + 600_000};
}

function fixture() {
  let current = release(recipientA, trackerA, '"1"');
  let nextAfterClaim = null;
  let existingClaim = null;
  let claimWrites = 0;
  let outlookPosts = 0;
  const actor = {id: '11111111-1111-4111-8111-111111111111',
    address: 'coordinator@example.invalid'};
  const graph = {
    bindAccount() { return this; },
    async getMe() { return actor; },
    async createDraft() {
      outlookPosts++;
      throw new Error('synthetic draft boundary reached');
    },
  };
  const context = {graph, actor,
    store: {
      async getState() { return existingClaim; },
      async createClaim() {
        claimWrites++;
        if (nextAfterClaim) current = nextAfterClaim;
        return {id: '1'};
      },
    },
    source: {
      async resolve() { return structuredClone(current); },
      async confirmUnchanged(previous) {
        if (previous.digest !== current.digest ||
            previous.etagsJson !== current.etagsJson) {
          throw new HeldActionError('RELEASE_CHANGED_AFTER_CLAIM');
        }
        return structuredClone(current);
      },
    },
  };
  class Actions extends LeanGanttActions {
    async _context() { return context; }
    async _legacyFence() { return null; }
    async _inspectLegacy() {
      return {occupied: null, proofDigest: 'invented-proof',
        validUntilMs: NOW + 600_000};
    }
    async _sameActor() {}
  }
  const actions = new Actions({config: {}, graph, now: () => NOW,
    randomUUID: () => '22222222-2222-4222-8222-222222222222'});
  return {actions,
    setCurrent(value) { current = value; },
    setExisting(value) { existingClaim = value; },
    changeAfterClaim(value) { nextAfterClaim = value; },
    claimWrites: () => claimWrites,
    outlookPosts: () => outlookPosts};
}

test('customer preview freezes the displayed recipient and tracker marker', async () => {
  const f = fixture();
  const preview = await f.actions.preview('customer', FORM);
  assert.equal(preview.to[0], recipientA);
  assert.equal(preview.binding.formSourceKey, FORM);
  assert.equal(preview.binding.recipientEmail, recipientA);
  assert.equal(preview.binding.trackerUrlSha256, sha(trackerA));
  assert.equal(preview.binding.validUntilMs, NOW + 600_000);
  assert.equal(JSON.stringify(preview).includes(trackerA), false);
  assert.equal(f.claimWrites(), 0);
  assert.equal(f.outlookPosts(), 0);
});

test('a Claim appearing after eligible preview holds before reopening', async () => {
  const f = fixture();
  const preview = await f.actions.preview('customer', FORM);
  f.setExisting({id: '2', fields: {ActorOid:
    '11111111-1111-4111-8111-111111111111'}});
  await assert.rejects(f.actions.customerDraft(FORM, preview.binding),
    {code: 'CUSTOMER_CLAIM_CHANGED_SINCE_PREVIEW'});
  assert.equal(f.claimWrites(), 0);
  assert.equal(f.outlookPosts(), 0);
});

test('an occupied preview cannot become a new draft if its Claim disappears', async () => {
  const f = fixture();
  f.setExisting({claim: {fields: {MigratedFrom: null,
    ActorOid: '11111111-1111-4111-8111-111111111111'}},
  draft: {id: 'invented-existing-draft'}, sent: null});
  const preview = await f.actions.preview('customer', FORM);
  assert.equal(preview.status, 'draft_occupied');
  assert.equal(preview.binding, undefined);
  f.setExisting(null);
  await assert.rejects(f.actions.customerDraft(FORM, preview.binding),
    {code: 'CUSTOMER_PREVIEW_BINDING_REQUIRED'});
  assert.equal(f.claimWrites(), 0);
  assert.equal(f.outlookPosts(), 0);
});

test('changed recipient or tracker holds before Claim and Outlook', async () => {
  for (const changed of [
    release(recipientB, trackerA, '"2"'),
    release(recipientA, trackerB, '"2"'),
  ]) {
    const f = fixture();
    const preview = await f.actions.preview('customer', FORM);
    f.setCurrent(changed);
    await assert.rejects(f.actions.customerDraft(FORM, preview.binding),
      {code: 'CUSTOMER_RELEASE_CHANGED_SINCE_PREVIEW'});
    assert.equal(f.claimWrites(), 0);
    assert.equal(f.outlookPosts(), 0);
  }
});

test('missing binding holds before Claim; post-Claim drift holds before Outlook', async () => {
  const f = fixture();
  const preview = await f.actions.preview('customer', FORM);
  await assert.rejects(f.actions.customerDraft(FORM),
    {code: 'CUSTOMER_PREVIEW_BINDING_REQUIRED'});
  assert.equal(f.claimWrites(), 0);
  f.changeAfterClaim(release(recipientB, trackerB, '"3"'));
  await assert.rejects(f.actions.customerDraft(FORM, preview.binding),
    {code: 'RELEASE_CHANGED_AFTER_CLAIM'});
  assert.equal(f.claimWrites(), 1);
  assert.equal(f.outlookPosts(), 0);
});

test('unchanged binding reaches the one synthetic Outlook boundary', async () => {
  const f = fixture();
  const preview = await f.actions.preview('customer', FORM);
  await assert.rejects(f.actions.customerDraft(FORM, preview.binding),
    {code: 'DRAFT_OUTCOME_UNKNOWN'});
  assert.equal(f.claimWrites(), 1);
  assert.equal(f.outlookPosts(), 1);
});

test('V2 parent adapter carries the customer binding to click', async () => {
  const f = fixture();
  const raw = await f.actions.preview('customer', FORM);
  const seen = [];
  const runtime = createV2ParentAdapter({
    enabled: true, signIn: async () => {},
    actions: {
      async preview() { return raw; },
      async customerDraft(id, binding) {
        seen.push([id, binding]);
        return {status: 'draft',
          webLink: 'https://outlook.office.com/mail/drafts/invented'};
      },
      async checkCustomerSent() { return {status: 'not_started'}; },
    },
    providerFlow: {
      async preview() { throw new Error('provider held'); },
      async draft() { throw new Error('provider held'); },
      async checkSent() { throw new Error('provider held'); },
    },
  });
  await runtime.signInFromClick();
  const preview = await runtime.preview('customer', FORM);
  assert.deepEqual(preview.binding, raw.binding);
  const result = await runtime.createOrOpenCustomerDraft(
    FORM, preview.binding);
  assert.equal(result.state, 'draft');
  assert.deepEqual(seen, [[FORM, raw.binding]]);
});
