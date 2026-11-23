import assert from 'node:assert/strict';
import test from 'node:test';
import {CLAIM_COLUMNS, ClaimReceiptStore, RECEIPT_COLUMNS} from
  '../claim_receipt_store.mjs';
import {SITE_URL} from '../contract.mjs';

const SITE_ID = 'invented-site';
const CLAIMS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIPTS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(changeReceiptColumn = () => {}) {
  const claims = CLAIM_COLUMNS.map(name => ({name}));
  const receipts = RECEIPT_COLUMNS.map(name => ({name}));
  claims.find(column => column.name === 'DispatchKey').required = true;
  claims.find(column => column.name === 'DispatchKey').indexed = true;
  claims.find(column => column.name === 'DispatchKey').enforceUniqueValues = true;
  claims.find(column => column.name === 'DispatchKey').text = {maxLength: 255};
  const receiptKey = receipts.find(column => column.name === 'ReceiptKey');
  Object.assign(receiptKey, {required: true, indexed: true,
    enforceUniqueValues: true, text: {maxLength: 255}});
  Object.assign(receipts.find(column => column.name === 'Kind'), {
    required: true, choice: {allowTextEntry: false,
      choices: ['Draft', 'SentAttempt', 'Sent']},
  });
  Object.assign(receipts.find(column =>
    column.name === 'PlannedSentSha256'), {
    required: false, text: {maxLength: 64, allowMultipleLines: false},
  });
  changeReceiptColumn(receipts);
  let posts = 0;
  const base = `/v1.0/sites/${SITE_ID}/lists/`;
  const graph = {async request(path, options) {
    if (options?.method === 'POST') {
      posts++;
      throw new Error('schema preflight must stop before a marker POST');
    }
    const isClaims = path.startsWith(base + CLAIMS_ID);
    const isReceipts = path.startsWith(base + RECEIPTS_ID);
    if (!isClaims && !isReceipts) throw new Error('unexpected List');
    const id = isClaims ? CLAIMS_ID : RECEIPTS_ID;
    const title = isClaims ? 'Arbys Coordinator Action Claims' :
      'Arbys Coordinator Action Receipts';
    if (path.includes('/columns?')) {
      assert.ok(path.includes(
        '$select=name,required,indexed,enforceUniqueValues,text,choice'));
      return {status: 200,
        data: {value: isClaims ? claims : receipts}};
    }
    if (path.endsWith('?$select=id,displayName,webUrl')) {
      return {status: 200, data: {id, displayName: title,
        webUrl: `${SITE_URL}/Lists/Invented/AllItems.aspx`}};
    }
    throw new Error('unexpected request');
  }};
  const store = new ClaimReceiptStore({graph, config: {siteId: SITE_ID,
    lists: {claims: CLAIMS_ID, receipts: RECEIPTS_ID}}});
  return {store, get posts() { return posts; }};
}

test('receipt schema requires exact SentAttempt choice and text digest field',
  async () => {
    await fixture().store.assertSchema();
    for (const change of [
      columns => { columns.find(c => c.name === 'Kind')
        .choice.choices = ['Draft', 'Sent']; },
      columns => { columns.find(c => c.name === 'Kind')
        .choice.allowTextEntry = true; },
      columns => { columns.find(c => c.name === 'PlannedSentSha256')
        .text.allowMultipleLines = true; },
      columns => { columns.find(c => c.name === 'PlannedSentSha256')
        .text.maxLength = 255; },
      columns => { columns.find(c => c.name === 'PlannedSentSha256')
        .text = undefined; },
    ]) {
      const altered = fixture(change);
      await assert.rejects(altered.store.assertSchema(),
        {code: 'ACTION_SCHEMA_UNVERIFIED'});
      assert.equal(altered.posts, 0);
    }
  });
