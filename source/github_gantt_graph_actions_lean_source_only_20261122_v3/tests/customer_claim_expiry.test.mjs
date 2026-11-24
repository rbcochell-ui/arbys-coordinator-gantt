import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {LeanGanttActions} from '../actions.mjs';
import {ClaimReceiptStore} from '../claim_receipt_store.mjs';
import {canonicalCustomerBody} from '../contract.mjs';
import {GraphClient} from '../graph.mjs';

const FORM = 'F:12345678:9999999999';
const NOW = Date.parse('2026-11-23T12:00:00Z');
const DEADLINE = NOW + 60_000;
const ACTOR = Object.freeze({id: '11111111-1111-4111-8111-111111111111',
  address: 'coordinator@example.invalid'});
const TRACKER = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  '?p=p_' + 'a'.repeat(32) + '#k=' + 'A'.repeat(43);
const CLAIMS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIPTS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = value => createHash('sha256').update(value).digest('hex');

test('customer preview expiry during Claim token wait makes no physical POST',
  async () => {
    let clock = NOW;
    const posts = [];
    const source = {formSourceKey: FORM,
      recipientEmail: 'customer@example.invalid', trackerUrl: TRACKER,
      subject: 'Invented tracker update',
      htmlBody: canonicalCustomerBody(TRACKER),
      digest: sha('invented customer Release'),
      etagsJson: JSON.stringify({release: {itemId: '1', etag: '"1"'}}),
      validUntilMs: DEADLINE};
    const graph = new GraphClient({
      tokenProvider: {
        async acquireToken() {
          clock = DEADLINE;
          return 'invented-token-12345';
        },
      },
      async fetchImpl(url, init) {
        posts.push([url, init.method]);
        throw Error('physical Graph POST must not happen');
      },
    });
    const store = new ClaimReceiptStore({graph, now: () => clock,
      config: {siteId: 'invented-site',
        lists: {claims: CLAIMS_ID, receipts: RECEIPTS_ID}}});
    store.getState = async () => null;
    const actions = new LeanGanttActions({config: {}, graph,
      now: () => clock,
      randomUUID: () => '22222222-2222-4222-8222-222222222222'});
    actions._context = async () => ({graph, actor: ACTOR, store,
      source: {
        async resolve() { return structuredClone(source); },
        async confirmUnchanged() {
          throw Error('a Claim must not have been created');
        },
      }});
    actions._legacyFence = async () => null;
    actions._inspectLegacy = async () => ({occupied: null,
      proofDigest: 'invented-proof', validUntilMs: DEADLINE});
    const preview = await actions.preview('customer', FORM);
    assert.equal(preview.status, 'eligible');
    assert.equal(clock, NOW);
    await assert.rejects(actions.customerDraft(FORM, preview.binding),
      {code: 'CUSTOMER_PREVIEW_BINDING_REQUIRED'});
    assert.equal(clock, DEADLINE);
    assert.deepEqual(posts, []);
  });
