import assert from 'node:assert/strict';
import test from 'node:test';
import {PICOS_PARTS} from '../actions/parts.mjs';
import {parseProviderTemplateCatalog, buildProviderPartsTemplate,
  providerPartsClipboardPayload, providerOutlookHeader} from
  '../actions/provider_anytime_template.mjs';

const makeWo = (id, number, agentCode, candidate, changes = {}) => ({
  id, number, type: 'Installation', status: 'Pending Readiness',
  woStore: '12345', acn: '12345678', assignedSpAgentCode: agentCode,
  spActivityDate: '2026-12-21', providerContactCandidate: candidate,
  nativeFields: {'Work Order ID': id.slice(0, 15),
    'Store Number': '12345', ACN: '12345678',
    'Assigned SP - Name': `${agentCode} - Invented Provider`},
  ...changes,
});
const pair = {state: 'two_source_file_candidate',
  installManagerEmail: 'manager@example.test',
  plannerEmail: 'planner@example.test'};
const shared = {state: 'two_source_file_candidate',
  installManagerEmail: 'shared@example.test',
  plannerEmail: 'SHARED@example.test'};
const rows = [
  makeWo(`0WO${'A'.repeat(15)}`, '1234567', 'F32', pair),
  makeWo(`0WO${'B'.repeat(15)}`, '2345678', 'C38', shared),
  makeWo(`0WO${'C'.repeat(15)}`, '3456789', 'S30', null),
  makeWo(`0WO${'D'.repeat(15)}`, '4567890', 'K79', pair,
    {type: 'Survey'}),
];
const snapshot = workOrders => ({
  schema: 'arbys-local-exact-form-project-preview/v16',
  asOfDate: '2026-11-18', projects: [{formStore: '12345',
    cases: [{workOrders}]}],
});
const chart = value =>
  `<script type="application/json" id="snapshotData">${JSON.stringify(value)}</script>`;

test('all Installation rows remain selectable with dated, role-aware suggestions', () => {
  const catalog = parseProviderTemplateCatalog(chart(snapshot(rows)));
  assert.equal(catalog.asOfDate, '2026-11-18');
  assert.equal(catalog.installations.length, 3);
  assert.deepEqual(catalog.installations.map(item =>
    item.suggestedRecipients.length), [2, 1, 0]);
  assert.equal(catalog.installations[0].agentCode, 'F32');
  assert.equal(catalog.installations[0].spActivityDate, '2026-12-21');
  assert.equal(catalog.installations[0].spActivityDateConfirmed, false);
  assert.equal(catalog.installations.some(item =>
    item.workOrderNumber === '4567890'), false);
  assert.throws(() => parseProviderTemplateCatalog(chart(snapshot([
    rows[0], {...rows[0]},
  ]))), /Installation identity unavailable/u);
});

test('manual work orders get no recipient inference or confirmed date claim', () => {
  const manual = buildProviderPartsTemplate({workOrderNumber: '9876543',
    agentCode: 'f32', asOfDate: '2026-11-18', sourceMode: 'manual',
    suggestedRecipients: ['manager@example.test', 'planner@example.test']});
  assert.deepEqual(manual.to, []);
  assert.match(manual.body, /coordinator entered this Installation WO and SP agent code manually/u);
  assert.match(manual.body, /SP activity date shown in the Gantt is unconfirmed/u);
  assert.throws(() => buildProviderPartsTemplate({workOrderNumber: '12',
    agentCode: 'F32', asOfDate: '2026-11-18', sourceMode: 'manual'}),
  /valid Installation WO/u);
});

test('preview and rich clipboard make exactly six reviewed part names clickable', () => {
  // An older snapshot date still produces an editable template; no timer or
  // source-expiry gate is involved in preparing this human-reviewed message.
  const template = buildProviderPartsTemplate({workOrderNumber: '1234567',
    agentCode: 'F32', asOfDate: '2025-01-01', sourceMode: 'charted',
    suggestedRecipients: ['manager@example.test', 'planner@example.test']});
  const payload = providerPartsClipboardPayload(template);
  assert.equal(payload.linkCount, 6);
  assert.equal((payload.html.match(/<a href=/gu) ?? []).length, 6);
  assert.equal(payload.plainText, template.body);
  for (const part of PICOS_PARTS) {
    assert.ok(payload.html.includes(`href="${part.url}"`));
    assert.ok(payload.html.includes(`${part.code} ${part.name.replaceAll("'", '&#39;')}</a>`));
    assert.ok(payload.html.includes(`myCoke material ${part.material}`));
    assert.equal(payload.plainText.split(part.url).length - 1, 1);
    assert.ok(payload.plainText.includes(
      `${part.code} ${part.name} (myCoke material ${part.material})`));
  }
  assert.equal(payload.html.includes('arbys-customer-status-preview'), false);
  assert.throws(() => providerPartsClipboardPayload({...template,
    body: template.body.replace(PICOS_PARTS[0].url, 'https://example.test')}),
  /changed before copy/u);
});

test('Outlook handoff has To and subject only, and accepts blank To', () => {
  const subject = "Arby's WO 1234567 | Provider parts review";
  const filled = new URL(providerOutlookHeader(
    'manager@example.test; planner@example.test', subject).url);
  assert.deepEqual([...filled.searchParams.keys()], ['to', 'subject']);
  assert.equal(filled.searchParams.get('to'),
    'manager@example.test;planner@example.test');
  assert.equal(filled.searchParams.has('body'), false);
  const blank = new URL(providerOutlookHeader('', subject).url);
  assert.deepEqual([...blank.searchParams.keys()], ['subject']);
  assert.equal(blank.searchParams.has('to'), false);
  assert.throws(() => providerOutlookHeader('manager@example.test\nBCC:x',
    subject), /Check the suggested recipients/u);
});
