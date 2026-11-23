import assert from 'node:assert/strict';
import test from 'node:test';
import {ClaimReceiptStore} from '../claim_receipt_store.mjs';
import {customerDispatchKey, receiptKey} from '../contract.mjs';

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
