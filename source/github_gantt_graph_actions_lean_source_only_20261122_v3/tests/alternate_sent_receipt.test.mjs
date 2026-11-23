import assert from 'node:assert/strict';
import test from 'node:test';
import {ClaimReceiptStore} from '../claim_receipt_store.mjs';
import {customerDispatchKey, receiptKey} from '../contract.mjs';
import {LEGACY_SENT_FIELDS, sentPlanDigest} from
  '../legacy_sent_attempt_contract.mjs';

const ENTITY = 'F:123:456';
const KEY = customerDispatchKey(ENTITY);
const ACTOR = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(64);
const rows = {
  claim: {id: '1', fields: {
    DispatchKey: KEY, ActionKind: 'customer-tracker', EntityId: ENTITY,
    ActorOid: ACTOR, ActorEmail: 'owner@example.invalid',
    AttemptId: '22222222-2222-4222-8222-222222222222',
    CorrelationId: '33333333-3333-4333-8333-333333333333',
    SourceDigest: SHA, SourceETagsJson:
      JSON.stringify({release: {itemId: '1', etag: '"1"'}}),
    ClaimedAtUtc: '2026-11-23T09:00:00.000Z',
  }},
  draft: {id: '2', fields: {
    ReceiptKey: receiptKey(KEY, 'Draft'), DispatchKey: KEY, Kind: 'Draft',
    ClaimItemId: '1', ActorOid: ACTOR, DraftImmutableId: 'draft-original',
    IntendedSubject: 'Invented subject', IntendedBodySha256: SHA,
    RequiredLinksJson: JSON.stringify(['sha256:' + SHA]),
  }},
  sent: {id: '3', fields: {
    ReceiptKey: receiptKey(KEY, 'Sent'), DispatchKey: KEY, Kind: 'Sent',
    ClaimItemId: '1', ActorOid: ACTOR, DraftImmutableId: 'draft-original',
    SentImmutableId: 'sent-copy-alternate',
    ActualSubject: 'sha256:' + SHA, ActualBodySha256: SHA,
    ActualLinksSha256: SHA,
    ActualToJson: JSON.stringify(['customer@example.invalid']),
    ActualCcJson: '[]', ActualBccJson: '[]',
    SentAtUtc: '2026-11-23T10:00:00.000Z',
    SentInternetMessageId: '<invented@example.invalid>',
    ReviewReason: '', RecordedAtUtc: '2026-11-23T10:01:00.000Z',
  }},
};

function storeFor(syntheticRows) {
  const store = new ClaimReceiptStore({
    graph: {request() { throw new Error('network forbidden'); }},
    config: {siteId: 'invented-site', lists: {
      claims: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      receipts: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }},
  });
  store._unique = async (_base, _field, key) =>
    key === KEY ? syntheticRows.claim :
      key === receiptKey(KEY, 'Draft') ? syntheticRows.draft :
        key === receiptKey(KEY, 'SentAttempt') ? syntheticRows.attempt :
        key === receiptKey(KEY, 'Sent') ? syntheticRows.sent : null;
  return store;
}

test('shared state accepts a separately verified alternate Sent ID', async () => {
  const state = await storeFor(structuredClone(rows)).getState(KEY);
  assert.equal(state.sent.fields.SentImmutableId, 'sent-copy-alternate');
  assert.equal(state.draft.fields.DraftImmutableId, 'draft-original');
});

test('shared state rejects an empty alternate Sent ID', async () => {
  const altered = structuredClone(rows);
  altered.sent.fields.SentImmutableId = '';
  await assert.rejects(storeFor(altered).getState(KEY),
    {code: 'SENT_RECEIPT_INVALID'});
});

async function migratedRows() {
  const result = structuredClone(rows);
  const marker = 'legacy-customer-tracker:synthetic-review-packet';
  for (const item of [result.claim, result.draft, result.sent]) {
    item.fields.MigratedFrom = marker;
  }
  result.sent.fields.Title = receiptKey(KEY, 'Sent');
  const pinned = Object.fromEntries(LEGACY_SENT_FIELDS.map(name =>
    [name, result.sent.fields[name]]));
  result.attempt = {id: '4', etag: '"1"', createdByOid: ACTOR,
    fields: {
      Title: receiptKey(KEY, 'SentAttempt'),
      ReceiptKey: receiptKey(KEY, 'SentAttempt'), DispatchKey: KEY,
      Kind: 'SentAttempt', ClaimItemId: '1', ActorOid: ACTOR,
      DraftImmutableId: 'draft-original',
      PlannedSentSha256: await sentPlanDigest(pinned),
      RecordedAtUtc: '2026-11-23T09:59:00.000Z',
      MigratedFrom: marker,
    }};
  return result;
}

test('migrated Sent state requires an owner-created matching marker digest', async () => {
  const valid = await migratedRows();
  assert.equal((await storeFor(valid).getState(KEY)).attempt.id, '4');
  const wrongCreator = structuredClone(valid);
  wrongCreator.attempt.createdByOid =
    '44444444-4444-4444-8444-444444444444';
  await assert.rejects(storeFor(wrongCreator).getState(KEY),
    {code: 'SENT_ATTEMPT_INVALID'});
  const wrongDigest = structuredClone(valid);
  wrongDigest.attempt.fields.PlannedSentSha256 = '0'.repeat(64);
  await assert.rejects(storeFor(wrongDigest).getState(KEY),
    {code: 'SENT_ATTEMPT_INVALID'});
});
