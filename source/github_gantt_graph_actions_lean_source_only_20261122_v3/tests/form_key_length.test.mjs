import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalFormSourceKey, customerDispatchKey, receiptKey} from
  '../contract.mjs';

test('customer FORM key leaves room for the longest unique receipt key', () => {
  const prefix = 'F:41607755:';
  const atLimit = prefix + '1'.repeat(226 - prefix.length);
  const overLimit = `${atLimit}1`;

  assert.equal(canonicalFormSourceKey(atLimit), atLimit);
  const dispatchKey = customerDispatchKey(atLimit);
  assert.equal(receiptKey(dispatchKey, 'SentAttempt').length, 255);
  assert.throws(() => canonicalFormSourceKey(overLimit),
    {code: 'FORM_SOURCE_KEY_INVALID'});
  assert.throws(() => customerDispatchKey(overLimit),
    {code: 'FORM_SOURCE_KEY_INVALID'});
});
