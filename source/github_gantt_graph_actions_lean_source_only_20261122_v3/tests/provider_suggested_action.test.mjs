import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {LeanGanttActions} from '../actions.mjs';
import {CORRELATION_HEADER, PICOS_PARTS, providerDispatchKey} from
  '../contract.mjs';

function nativeId(serial) {
  const first = `0WO${String(serial).padStart(12, '0')}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(first[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return first + suffix;
}
const WO = nativeId(1);
const ACTOR = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  address: 'coordinator@example.invalid'};
const NOW = Date.parse('2026-11-23T12:00:00Z');

class Parser {
  parseFromString(html) {
    return {querySelectorAll: () => [...html.matchAll(/<a href="([^"]+)"/gu)]
      .map(match => ({getAttribute: () => match[1]}))};
  }
}

test('lean suggested shared mailbox stays review-required in preview and unsent draft', async () => {
  const source = {nativeWoId: WO, woNumber: '900001', agentCode: 'A1',
    storeNumber: '1001', to: ['shared@example.invalid'],
    recipientEvidence: 'suggested_pair', recipientReviewRequired: true,
    sharedMailboxVerified: false, digest: 'a'.repeat(64),
    etagsJson: JSON.stringify({wo: {itemId: '1', etag: '"1"'},
      contact: {itemId: '2', etag: '"1"'},
      recipientEvidence: 'suggested_pair'}), validUntilMs: NOW + 10 * 60_000};
  let created = null;
  let claimSource = null;
  let state = null;
  const graph = {bindAccount() { return this; },
    async getMe() { return ACTOR; },
    async createDraft(content, correlationId, beforePost) {
      beforePost();
      created = {content, correlationId};
      return {id: 'invented-draft-id'};
    },
    async getFolderId(kind) { assert.equal(kind, 'drafts'); return 'drafts'; },
    async getMessage(id) {
      assert.equal(id, 'invented-draft-id');
      return {id, isDraft: true, parentFolderId: 'drafts',
        internetMessageHeaders: [{name: CORRELATION_HEADER,
          value: created.correlationId}],
        subject: created.content.subject,
        body: {contentType: 'html', content: created.content.htmlBody},
        webLink: 'https://outlook.office.com/mail/drafts/id/invented-draft-id',
        toRecipients: [{emailAddress: {address: 'shared@example.invalid'}}],
        ccRecipients: [], bccRecipients: []};
    }};
  const store = {async getState() { return state; },
    async createClaim(key, _actor, observed, _attempt, correlationId) {
      claimSource = observed;
      return {fields: {ActionKind: 'provider-parts', EntityId: WO,
        DispatchKey: key, ActorOid: ACTOR.id, ActorEmail: ACTOR.address,
        CorrelationId: correlationId, SourceDigest: observed.digest,
        SourceETagsJson: observed.etagsJson}};
    },
    async appendDraft(claim, _actor, content) {
      state = {claim, sent: null, draft: {fields: {
        DraftImmutableId: content.id, IntendedSubject: content.subject,
        IntendedToJson: JSON.stringify(content.to),
        RequiredLinksJson: JSON.stringify(content.requiredLinks),
        IntendedBodySha256: createHash('sha256')
          .update(content.htmlBody).digest('hex'),
      }}};
      return state;
    }};
  const resolver = {async resolve() { return source; },
    async confirmUnchanged() { return source; }};
  let uuid = 0;
  const actions = new LeanGanttActions({config: {}, graph, now: () => NOW,
    randomUUID: () => `77777777-7777-4777-8777-${String(++uuid).padStart(12, '0')}`,
    domParserClass: Parser});
  actions._context = async () => ({graph, actor: ACTOR, store,
    source: resolver});
  actions._legacyFence = async () => null;
  actions._inspectLegacy = async () => ({occupied: null,
    proofDigest: 'invented', validUntilMs: Date.now() + 60_000});

  const preview = await actions.preview('provider', WO);
  assert.deepEqual(preview.to, ['shared@example.invalid']);
  assert.equal(preview.recipientReviewRequired, true);
  const result = await actions.providerDraft(WO);
  assert.equal(result.status, 'recipient_review_required');
  assert.equal(result.recipientReviewRequired, true);
  assert.equal(created.content.to.length, 1);
  assert.equal(created.content.requiredLinks.length, PICOS_PARTS.length);
  assert.equal(JSON.parse(claimSource.etagsJson).recipientEvidence,
    'suggested_pair');
  assert.equal(state.claim.fields.DispatchKey, providerDispatchKey(WO));
  const reopened = await actions.checkSent(WO);
  assert.equal(reopened.status, 'recipient_review_required');
  assert.equal(reopened.recipientReviewRequired, true);
  assert.match(reopened.reviewReason, /Recipients are suggestions/);
  assert.equal((await actions.providerDraft(WO)).immutableId,
    'invented-draft-id');
  assert.equal(typeof graph.sendMail, 'undefined');
});
