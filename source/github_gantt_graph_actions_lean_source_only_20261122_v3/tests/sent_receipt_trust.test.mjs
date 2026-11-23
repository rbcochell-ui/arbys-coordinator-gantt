import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {LeanGanttActions} from '../actions.mjs';
import {canonicalCustomerBody, customerDispatchKey} from '../contract.mjs';
import {GraphHttpError} from '../graph.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const FORM = 'F:123:456';
const KEY = customerDispatchKey(FORM);
const OWNER = {id: '11111111-1111-4111-8111-111111111111',
  address: 'owner@example.invalid'};
const OTHER = {id: '22222222-2222-4222-8222-222222222222',
  address: 'other@example.invalid'};
const TRACKER = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  '?p=p_' + 'a'.repeat(32) + '#k=' + 'A'.repeat(43);
const BODY = canonicalCustomerBody(TRACKER);
const SUBJECT = 'Invented customer update';
const MESSAGE_ID = 'immutable-invented-customer';
const CORRELATION = '33333333-3333-4333-8333-333333333333';
const SENT_AT = '2026-11-23T10:00:00.000Z';
const INTERNET_ID = '<invented@example.invalid>';

class BrowserParser {
  parseFromString(html) {
    return {querySelectorAll: () => [...html.matchAll(/<a\s+href="([^"]+)"/gu)]
      .map(match => ({getAttribute: () => match[1]}))};
  }
}

function fixture() {
  const claim = {fields: {ActionKind: 'customer-tracker', DispatchKey: KEY,
    EntityId: FORM, ActorOid: OWNER.id, ActorEmail: OWNER.address,
    CorrelationId: CORRELATION, ClaimedAtUtc: '2026-11-23T09:00:00.000Z'}};
  const draft = {fields: {DraftImmutableId: MESSAGE_ID,
    IntendedSubject: SUBJECT,
    IntendedToJson: JSON.stringify(['customer@example.invalid']),
    RequiredLinksJson: JSON.stringify([`sha256:${sha(TRACKER)}`]),
    IntendedBodySha256: sha(BODY)}};
  const sent = {fields: {SentImmutableId: MESSAGE_ID,
    SentAtUtc: SENT_AT, SentInternetMessageId: INTERNET_ID,
    ActualSubject: `sha256:${sha(SUBJECT)}`,
    ActualBodySha256: sha(BODY),
    ActualLinksSha256: sha(JSON.stringify([TRACKER])),
    ActualToJson: JSON.stringify(['customer@example.invalid']),
    ActualCcJson: '[]', ActualBccJson: '[]', ReviewReason: ''}};
  const state = {claim, draft, sent};
  const message = {id: MESSAGE_ID, isDraft: false,
    parentFolderId: 'folder-sentitems', sentDateTime: SENT_AT,
    internetMessageId: INTERNET_ID, subject: SUBJECT,
    body: {contentType: 'HTML', content: BODY},
    webLink: `https://outlook.office.com/mail/id/${MESSAGE_ID}`,
    toRecipients: [{emailAddress: {address: 'customer@example.invalid'}}],
    ccRecipients: [], bccRecipients: [],
    internetMessageHeaders: [{name: 'x-arbys-correlation-id',
      value: CORRELATION}]};
  let mailboxReads = 0;
  let scanReads = 0;
  let receiptWrites = 0;
  let actor = OTHER;
  let missingMessage = false;
  let recoveredId = null;
  let scanError = null;
  const graph = {
    bindAccount() { return this; },
    async getMe() { return actor; },
    async getMessage(id) {
      mailboxReads++;
      if (missingMessage && id === MESSAGE_ID) throw new GraphHttpError(404);
      return structuredClone(message);
    },
    async findSentByCorrelation(correlationId, claimedAtUtc) {
      scanReads++;
      assert.equal(correlationId, CORRELATION);
      assert.equal(claimedAtUtc, claim.fields.ClaimedAtUtc);
      if (scanError) throw scanError;
      return recoveredId;
    },
    async getFolderId(kind) { return `folder-${kind}`; },
    async createDraft() { throw new Error('second draft forbidden'); },
  };
  const context = {graph, actor,
    source: {async resolve() { throw new Error('source unavailable'); }},
    store: {async getState() { return state; },
      async appendSent() { receiptWrites++; }}};
  class Actions extends LeanGanttActions {
    async _context() { return context; }
  }
  const actions = new Actions({config: {}, graph,
    domParserClass: BrowserParser});
  return {actions, state, message, context,
    setActor(value) { actor = value; context.actor = value; },
    setMissingMessage(value) { missingMessage = value; },
    setRecoveredId(value) { recoveredId = value; },
    setScanError(value) { scanError = value; },
    mailboxReads: () => mailboxReads,
    scanReads: () => scanReads,
    receiptWrites: () => receiptWrites};
}

test('nonowner sees a recorded row, never mailbox proof or a second draft', async () => {
  const h = fixture();
  assert.equal((await h.actions.preview('customer', FORM)).status,
    'sent_recorded_unverified');
  assert.equal((await h.actions.checkCustomerSent(FORM)).status,
    'sent_recorded_unverified');
  assert.equal((await h.actions.customerDraft(FORM)).status,
    'sent_recorded_unverified');
  assert.equal(h.mailboxReads(), 0);
  assert.equal(h.receiptWrites(), 0);
});

test('owner confirms Sent only from matching live mailbox and stored receipt', async () => {
  const h = fixture();
  h.setActor(OWNER);
  assert.equal((await h.actions.preview('customer', FORM)).status,
    'sent_recorded_unverified');
  assert.equal(h.mailboxReads(), 0);
  assert.equal((await h.actions.checkCustomerSent(FORM)).status, 'sent');
  assert.equal(h.mailboxReads(), 1);
  assert.equal(h.receiptWrites(), 0);
  h.state.sent.fields.ActualBodySha256 = 'f'.repeat(64);
  await assert.rejects(h.actions.checkCustomerSent(FORM),
    {code: 'SENT_RECEIPT_CONFLICT'});
});

test('forged Sent row with an unsent Draft stays held', async () => {
  const h = fixture();
  h.setActor(OWNER);
  h.message.isDraft = true;
  h.message.parentFolderId = 'folder-drafts';
  h.message.sentDateTime = null;
  h.message.internetMessageId = null;
  await assert.rejects(h.actions.checkCustomerSent(FORM),
    {code: 'DRAFT_AND_SENT_CONFLICT'});
  assert.equal(h.receiptWrites(), 0);
});

test('lost original immutable ID stays unresolved without inferring Sent', async () => {
  const h = fixture();
  h.setActor(OWNER);
  h.setMissingMessage(true);
  assert.equal((await h.actions.checkCustomerSent(FORM)).status,
    'unresolved');
  assert.equal(h.receiptWrites(), 0);
});

test('owner can verify a uniquely correlated Sent copy with a changed immutable ID', async () => {
  const h = fixture();
  h.setActor(OWNER);
  h.setMissingMessage(true);
  const alternateId = 'immutable-sent-copy-invented';
  h.setRecoveredId(alternateId);
  h.message.id = alternateId;
  h.state.sent.fields.SentImmutableId = alternateId;
  assert.equal((await h.actions.checkCustomerSent(FORM)).status, 'sent');
  assert.equal(h.mailboxReads(), 2);
  assert.equal(h.scanReads(), 0);
  assert.equal(h.receiptWrites(), 0);
});

test('new Sent receipt is appended only after alternate ID mailbox proof', async () => {
  const h = fixture();
  h.setActor(OWNER);
  h.setMissingMessage(true);
  const alternateId = 'immutable-sent-copy-invented';
  h.setRecoveredId(alternateId);
  h.message.id = alternateId;
  h.state.sent = null;
  assert.equal((await h.actions.checkCustomerSent(FORM)).status, 'sent');
  assert.equal(h.receiptWrites(), 1);
  assert.equal(h.scanReads(), 1);
});

test('ambiguous fallback never logs Sent or frees the occupied key', async () => {
  const h = fixture();
  h.setActor(OWNER);
  h.setMissingMessage(true);
  h.setScanError(new Error('ambiguous'));
  assert.equal((await h.actions.checkCustomerSent(FORM)).status, 'unresolved');
  assert.equal(h.receiptWrites(), 0);
});

test('fallback candidate must still be a correlated Sent Items message', async () => {
  const h = fixture();
  h.setActor(OWNER);
  h.setMissingMessage(true);
  h.setRecoveredId('immutable-sent-copy-invented');
  h.message.id = 'immutable-sent-copy-invented';
  h.message.isDraft = true;
  await assert.rejects(h.actions.checkCustomerSent(FORM),
    {code: 'SENT_SCAN_NOT_SENT'});
  assert.equal(h.receiptWrites(), 0);
});
