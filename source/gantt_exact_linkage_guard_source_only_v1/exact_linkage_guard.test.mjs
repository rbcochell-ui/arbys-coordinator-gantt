import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateSelectedLinkage, exactAddressKey, LinkageGuardError} from
  './exact_linkage_guard.mjs';

function sf18(base) {
  assert.equal(base.length, 15);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(base[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return base + suffix;
}

function base(prefix, n) {
  return `${prefix}${'a'.repeat(10)}${String(n).padStart(2, '0')}`;
}

function source(n) {
  const formSourceKey = `F:1:${n}`;
  const nativeCaseId = sf18(base('500', n));
  const nativeWorkOrderId = sf18(base('0WO', n));
  const address = {
    street: `${100 + n} EXAMPLE ST`, street2: '',
    city: 'SAMPLE CITY', state: 'OH', zip: '43001-1234',
  };
  const storeNumber = String(200 + n);
  const outletAcn = String(300 + n);
  const pair = {
    installManagerEmail: 'manager@example.invalid',
    plannerEmail: 'planner@example.invalid',
  };
  const wo = {
    nativeWorkOrderId, nativeCaseId,
    workOrderNumber: String(400 + n), storeNumber, outletAcn,
    serviceAddress: {...address}, assignedSpName: 'K79 - Example Provider',
    assignedSpAgentCode: 'K79',
  };
  return {
    project: {
      formSourceKey, formStoreNumber: storeNumber,
      formAddress: {...address},
      cases: [{nativeCaseId, linkedFormSourceKey: formSourceKey,
        customerAcn: outletAcn, workOrders: [wo]}],
    },
    linkage: {
      storeNumber, outletAcn, serviceAddress: {...address},
      agentCode: 'K79', ...pair,
    },
    directory: {agentCode: 'K79', ...pair},
    nativeWorkOrderId,
  };
}

function fixture(n = 1) {
  const one = source(n);
  return {
    projects: [one.project], linkageRows: [one.linkage],
    directoryRows: [one.directory],
    selectedNativeWorkOrderId: one.nativeWorkOrderId,
  };
}

function reason(input) { return evaluateSelectedLinkage(input).reasonCode; }

test('29 invented Store+ACN+agent matches remain separate native WO selections', () => {
  const rows = Array.from({length: 29}, (_, i) => source(i + 1));
  const cohort = {
    projects: rows.map(row => row.project),
    linkageRows: rows.map(row => row.linkage),
    directoryRows: [rows[0].directory],
  };
  const decisions = rows.map(row => evaluateSelectedLinkage({
    ...cohort, selectedNativeWorkOrderId: row.nativeWorkOrderId,
  }));
  assert.equal(decisions.length, 29);
  assert.equal(new Set(decisions.map(row => row.nativeWorkOrderId)).size, 29);
  assert.ok(decisions.every(row => row.state === 'candidate' &&
    row.matchMethod === 'exact_store_acn_agent' &&
    row.reviewFlags.length === 0 && row.sendAllowed === false));
});

test('multiple work orders remain children of one native Case and FORM project', () => {
  const input = fixture();
  const second = structuredClone(input.projects[0].cases[0].workOrders[0]);
  second.nativeWorkOrderId = sf18(base('0WO', 98));
  second.workOrderNumber = '498';
  input.projects[0].cases[0].workOrders.push(second);
  input.selectedNativeWorkOrderId = second.nativeWorkOrderId;
  const decision = evaluateSelectedLinkage(input);
  assert.equal(decision.state, 'candidate');
  assert.equal(decision.nativeCaseId, input.projects[0].cases[0].nativeCaseId);
  assert.equal(decision.formSourceKey, input.projects[0].formSourceKey);
});

test('two native Cases may carry the same reviewed FORM link without merging their WO IDs', () => {
  const input = fixture();
  const secondCase = structuredClone(input.projects[0].cases[0]);
  secondCase.nativeCaseId = sf18(base('500', 99));
  secondCase.workOrders[0].nativeCaseId = secondCase.nativeCaseId;
  secondCase.workOrders[0].nativeWorkOrderId = sf18(base('0WO', 99));
  secondCase.workOrders[0].workOrderNumber = '499';
  input.projects[0].cases.push(secondCase);
  input.selectedNativeWorkOrderId = secondCase.workOrders[0].nativeWorkOrderId;
  const decision = evaluateSelectedLinkage(input);
  assert.equal(decision.state, 'candidate');
  assert.equal(decision.nativeCaseId, secondCase.nativeCaseId);
  assert.equal(decision.formSourceKey, input.projects[0].formSourceKey);
});

test('missing customer store uses only complete like-for-like address + ACN + agent', () => {
  const input = fixture();
  input.projects[0].formStoreNumber = 'A'; // Unknown marker, never a store key.
  input.projects[0].formAddress.street = '  101 Example St. ';
  input.projects[0].formAddress.zip = '43001';
  const decision = evaluateSelectedLinkage(input);
  assert.equal(decision.state, 'candidate');
  assert.equal(decision.matchMethod, 'exact_address_acn_agent');
  assert.deepEqual(decision.reviewFlags, ['FORM_STORE_UNKNOWN']);
  assert.equal(decision.sendAllowed, false);
  assert.equal(exactAddressKey(input.projects[0].formAddress),
    exactAddressKey(input.projects[0].cases[0].workOrders[0].serviceAddress));
});

test('missing WO store holds separately, even with a customer store and matching address', () => {
  const input = fixture();
  input.projects[0].cases[0].workOrders[0].storeNumber = null;
  input.linkageRows[0].storeNumber = null;
  assert.equal(reason(input), 'WO_STORE_MISSING');
  input.projects[0].formStoreNumber = null;
  assert.equal(reason(input), 'WO_STORE_MISSING');
});

test('store or ACN conflict cannot be rescued by a matching address', () => {
  const input = fixture();
  input.projects[0].cases[0].workOrders[0].storeNumber = '9999';
  assert.equal(reason(input), 'STORE_CONFLICT');
  input.projects[0].cases[0].workOrders[0].storeNumber = '201';
  input.projects[0].cases[0].customerAcn = '9999';
  assert.equal(reason(input), 'ACN_CONFLICT');
  input.projects[0].cases[0].customerAcn = '000';
  assert.equal(reason(input), 'ACN_MISSING');
});

test('numeric source values must remain strings rather than silently becoming unknown', () => {
  const input = fixture();
  input.projects[0].formStoreNumber = 201;
  assert.throws(() => evaluateSelectedLinkage(input), error =>
    error instanceof LinkageGuardError && error.code === 'STORE_VALUE_INVALID');
});

test('fallback rejects address difference, suite difference, shared location, and duplicate contacts', () => {
  const input = fixture();
  input.projects[0].formStoreNumber = null;
  input.projects[0].formAddress.street = 'different street';
  assert.equal(reason(input), 'ADDRESS_CONFLICT');
  input.projects[0].formAddress.street = '101 EXAMPLE ST';
  input.projects[0].formAddress.street2 = 'STE 2';
  assert.equal(reason(input), 'ADDRESS_CONFLICT');
  input.projects[0].formAddress.street2 = '';
  input.projects[0].formAddress.line2 = 'STE 2';
  assert.equal(reason(input), 'ADDRESS_INCOMPLETE');
  delete input.projects[0].formAddress.line2;

  const second = source(2);
  second.project.formAddress = structuredClone(input.projects[0].formAddress);
  second.project.cases[0].customerAcn = input.projects[0].cases[0].customerAcn;
  input.projects.push(second.project);
  assert.equal(reason(input), 'AMBIGUOUS_FORM_ADDRESS');
  input.projects.pop();

  input.linkageRows.push(structuredClone(input.linkageRows[0]));
  assert.equal(reason(input), 'AMBIGUOUS_CONTACT_JOIN');
});

test('contact conflicts and agent parsing hold; underscore form is accepted', () => {
  const input = fixture();
  input.directoryRows[0].plannerEmail = 'other@example.invalid';
  assert.equal(reason(input), 'CONTACT_DIRECTORY_CONFLICT');
  input.directoryRows[0].plannerEmail = 'planner@example.invalid';
  input.directoryRows.push({agentCode: 'K79',
    installManagerEmail: '', plannerEmail: ''});
  assert.equal(reason(input), 'CONTACT_DIRECTORY_INVALID');
  input.directoryRows.pop();
  input.projects[0].cases[0].workOrders[0].assignedSpName =
    'K80 - Example Provider';
  assert.equal(reason(input), 'AGENT_UNVERIFIED');
  input.projects[0].cases[0].workOrders[0].assignedSpName =
    'K79_Example Provider';
  assert.equal(evaluateSelectedLinkage(input).state, 'candidate');
});

test('WO number, 15-character ID, and bad checksum cannot select an action', () => {
  const input = fixture();
  for (const bad of ['401', input.selectedNativeWorkOrderId.slice(0, 15),
      input.selectedNativeWorkOrderId.slice(0, 15) + 'AAA']) {
    assert.throws(() => evaluateSelectedLinkage({
      ...input, selectedNativeWorkOrderId: bad,
    }), error => error instanceof LinkageGuardError &&
      error.code === 'NATIVE_WO_ID_REQUIRED');
  }
});

test('Case signed-link conflict and WO parent conflict fail the whole cohort', () => {
  const input = fixture();
  input.projects[0].cases[0].linkedFormSourceKey = 'F:1:99';
  assert.throws(() => evaluateSelectedLinkage(input), error =>
    error instanceof LinkageGuardError &&
    error.code === 'FORM_CASE_ANCHOR_INVALID');
  input.projects[0].cases[0].linkedFormSourceKey =
    input.projects[0].formSourceKey;
  input.projects[0].cases[0].workOrders[0].nativeCaseId =
    sf18(base('500', 98));
  assert.throws(() => evaluateSelectedLinkage(input), error =>
    error instanceof LinkageGuardError &&
    error.code === 'NATIVE_WO_CASE_ANCHOR_INVALID');
});
