import assert from 'node:assert/strict';
import test from 'node:test';
import {LegacyHold, LegacyReopenAdapter} from '../legacy_reopen.mjs';
import {recordLegacySentOnce} from '../legacy_sent_receipt.mjs';
import {createLegacySentGraphPort} from '../legacy_sent_graph_port.mjs';
import {sentPlanDigest} from '../legacy_sent_attempt_contract.mjs';

const KEY = 'provider-parts:0WOTN00000abcde4AA';
const OID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-23T12:00:00Z');
const SENT = {
  Title: `${KEY}|Sent`, ReceiptKey: `${KEY}|Sent`, DispatchKey: KEY,
  Kind: 'Sent', ClaimItemId: '41', ActorOid: OID,
  DraftImmutableId: 'synthetic-immutable-id',
  SentImmutableId: 'synthetic-immutable-id',
  ActualSubject: `sha256:${'a'.repeat(64)}`,
  ActualBodySha256: 'b'.repeat(64),
  ActualLinksSha256: 'c'.repeat(64),
  ActualToJson: '["manager@example.invalid","planner@example.invalid"]',
  ActualCcJson: '[]', ActualBccJson: '[]',
  SentAtUtc: '2026-11-23T11:59:00.000Z',
  SentInternetMessageId: '<synthetic@example.invalid>',
  ReviewReason: '', RecordedAtUtc: '2026-11-23T12:00:00.000Z',
  MigratedFrom: 'legacy-provider-parts:synthetic-review-packet',
};
const PLAN = {
  claimItemId: '41', claimEtag: '"1"',
  draftReceiptItemId: '42', draftReceiptEtag: '"1"',
  oldRowEtag: '"4"', inventoryProofDigest: 'd'.repeat(64),
  inventoryValidUntilMs: NOW + 60_000,
  fields: SENT,
};

function fixture() {
  // Unit-level adapter seam; the independent integration suite exercises the
  // real owner proof, mailbox, old-row and signed inventory traversals.
  const adapter = Object.create(LegacyReopenAdapter.prototype);
  let attempt = null;
  let sent = null;
  let posts = 0;
  adapter.prepareSentReceipt = async () => {
    if (attempt) throw new LegacyHold('LEGACY_SENT_ATTEMPT_EXISTS');
    return structuredClone(PLAN);
  };
  adapter.verifyRecordedAttempt = async (key, id, fields, frozenSentFields) => {
    assert.equal(key, KEY);
    assert.equal(id, '43');
    assert.deepEqual(attempt?.fields, fields);
    assert.deepEqual(frozenSentFields, SENT);
    return {sentPlan: structuredClone(PLAN), attemptEtag: '"1"'};
  };
  adapter.verifyRecordedSent = async (key, id, fields) => {
    assert.equal(key, KEY);
    assert.equal(id, '44');
    assert.deepEqual(sent?.fields, fields);
    return {status: 'sent', webLink: null, sendReady: false};
  };
  const post = async (fields, refs, beforeFetch) => {
    posts++;
    beforeFetch();
    if (fields.Kind === 'SentAttempt') {
      assert.equal(refs.plannedSentFields.DispatchKey, KEY);
      assert.equal(fields.PlannedSentSha256,
        await sentPlanDigest(refs.plannedSentFields));
      if (attempt) throw new Error('unique ReceiptKey conflict');
      attempt = {id: '43', fields: structuredClone(fields)};
      return {status: 201, data: {id: '43'}};
    }
    assert.equal(fields.Kind, 'Sent');
    assert.equal(refs.attemptItemId, '43');
    assert.equal(refs.attemptEtag, '"1"');
    assert.equal(refs.plannedSentSha256, attempt.fields.PlannedSentSha256);
    assert.deepEqual(fields, SENT);
    assert.equal(await sentPlanDigest(fields),
      attempt.fields.PlannedSentSha256);
    if (sent) throw new Error('unique ReceiptKey conflict');
    sent = {id: '44', fields: structuredClone(fields)};
    return {status: 201, data: {id: '44'}};
  };
  return {adapter, post, get attempt() { return attempt; },
    get sent() { return sent; }, get posts() { return posts; },
    set postOverride(value) { this.post = value; }};
}

test('one durable marker precedes the one exact Sent log', async () => {
  const f = fixture();
  const result = await recordLegacySentOnce(f.adapter, KEY, f.post,
    {now: () => NOW});
  assert.equal(result.status, 'sent');
  assert.equal(f.posts, 2);
  assert.equal(f.attempt.fields.ReceiptKey, `${KEY}|SentAttempt`);
  assert.equal(f.sent.fields.ReceiptKey, `${KEY}|Sent`);
  await assert.rejects(() => recordLegacySentOnce(f.adapter, KEY, f.post,
    {now: () => NOW}), error => error instanceof LegacyHold);
  assert.equal(f.posts, 2);
});

test('lost Sent response cannot cause a second POST after a reload', async () => {
  const f = fixture();
  const wrapped = async (...args) => {
    const response = await f.post(...args);
    if (args[0].Kind === 'Sent') throw new Error('response lost');
    return response;
  };
  await assert.rejects(() => recordLegacySentOnce(f.adapter, KEY, wrapped,
    {now: () => NOW}), error => error?.code ===
      'LEGACY_SENT_WRITE_OUTCOME_UNKNOWN');
  assert.equal(f.posts, 2);
  assert.ok(f.attempt && f.sent);
  // A new browser instance has no in-memory latch. The persisted marker is
  // still read before any write, so it holds without another network POST.
  await assert.rejects(() => recordLegacySentOnce(f.adapter, KEY, f.post,
    {now: () => NOW}), error => error instanceof LegacyHold);
  assert.equal(f.posts, 2);
});

test('uncertain marker or its readback never authorizes Sent', async () => {
  for (const mode of ['lost-marker-response', 'wrong-marker-readback',
    'changed-frozen-plan']) {
    const f = fixture();
    if (mode === 'wrong-marker-readback') {
      f.adapter.verifyRecordedAttempt = async () => ({
        sentPlan: structuredClone(PLAN), attemptEtag: null,
      });
    } else if (mode === 'changed-frozen-plan') {
      f.adapter.verifyRecordedAttempt = async () => ({
        sentPlan: {...structuredClone(PLAN),
          fields: {...SENT, RecordedAtUtc: '2026-11-23T12:00:01.000Z'}},
        attemptEtag: '"1"',
      });
    }
    const wrapped = async (...args) => {
      const response = await f.post(...args);
      if (mode === 'lost-marker-response') throw new Error('response lost');
      return response;
    };
    await assert.rejects(() => recordLegacySentOnce(f.adapter, KEY, wrapped,
      {now: () => NOW}), error => error instanceof LegacyHold);
    assert.ok(f.attempt);
    assert.equal(f.sent, null);
    assert.equal(f.posts, 1);
  }
});

test('marker digest binds the exact recorded time of the frozen POST', async () => {
  assert.notEqual(await sentPlanDigest(SENT),
    await sentPlanDigest({...SENT,
      RecordedAtUtc: '2026-11-23T12:00:01.000Z'}));
});

test('selected Graph port rejects final Sent before marker proof', async () => {
  let posts = 0;
  const graph = {bindAccount() { return this; },
    async getMe() { return {id: OID}; },
    async request(_path, options) {
      posts++;
      options.beforeFetch();
      return {status: 201, data: {id: '43'}};
    }};
  const port = createLegacySentGraphPort({graph,
    siteId: 'groups.example.invalid,aaaa,bbbb',
    receiptsListId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  await assert.rejects(() => port(SENT, PLAN, () => {}), TypeError);
  assert.equal(posts, 0);
  const digest = await sentPlanDigest(SENT);
  const finalRefs = {...PLAN, attemptItemId: '43',
    attemptEtag: '"1"', plannedSentSha256: digest};
  await assert.rejects(() => port(SENT, finalRefs, () => {}), TypeError);
  assert.equal(posts, 0);
  const marker = {Title: `${KEY}|SentAttempt`,
    ReceiptKey: `${KEY}|SentAttempt`, DispatchKey: KEY,
    Kind: 'SentAttempt', ClaimItemId: '41', ActorOid: OID,
    DraftImmutableId: SENT.DraftImmutableId,
    PlannedSentSha256: digest, RecordedAtUtc: SENT.RecordedAtUtc,
    MigratedFrom: SENT.MigratedFrom};
  const refs = {...PLAN, plannedSentFields: SENT};
  const result = await port(marker, refs, () => {});
  assert.equal(result.status, 201);
  assert.equal(posts, 1);
  await assert.rejects(() => port({...marker,
    PlannedSentSha256: '0'.repeat(64)}, refs, () => {}), TypeError);
  assert.equal(posts, 1);
  await assert.rejects(() => port(SENT, {...finalRefs,
    attemptItemId: '44'}, () => {}), TypeError);
  assert.equal(posts, 1);
  assert.equal((await port(SENT, finalRefs, () => {})).status, 201);
  assert.equal(posts, 2);
  await assert.rejects(() => port(SENT, finalRefs, () => {}), TypeError);
  assert.equal(posts, 2);
});

test('a lost final response consumes the selected port right', async () => {
  let posts = 0;
  const graph = {bindAccount() { return this; },
    async getMe() { return {id: OID}; },
    async request(_path, options) {
      posts++;
      options.beforeFetch();
      if (posts === 2) throw new Error('response lost');
      return {status: 201, data: {id: '43'}};
    }};
  const port = createLegacySentGraphPort({graph,
    siteId: 'groups.example.invalid,aaaa,bbbb',
    receiptsListId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  const digest = await sentPlanDigest(SENT);
  const marker = {Title: `${KEY}|SentAttempt`,
    ReceiptKey: `${KEY}|SentAttempt`, DispatchKey: KEY,
    Kind: 'SentAttempt', ClaimItemId: '41', ActorOid: OID,
    DraftImmutableId: SENT.DraftImmutableId,
    PlannedSentSha256: digest, RecordedAtUtc: SENT.RecordedAtUtc,
    MigratedFrom: SENT.MigratedFrom};
  await port(marker, {...PLAN, plannedSentFields: SENT}, () => {});
  const finalRefs = {...PLAN, attemptItemId: '43',
    attemptEtag: '"1"', plannedSentSha256: digest};
  await assert.rejects(() => port(SENT, finalRefs, () => {}),
    /response lost/);
  await assert.rejects(() => port(SENT, finalRefs, () => {}), TypeError);
  assert.equal(posts, 2);
});
