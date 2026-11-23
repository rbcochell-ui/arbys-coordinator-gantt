import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const proposed = JSON.parse(readFileSync(new URL(
  './STORAGE_CONTRACT_PROPOSAL.json', import.meta.url), 'utf8'));
const releaseV3 = JSON.parse(readFileSync(new URL(
  '../gantt_sharepoint_ui_three_list_setup_source_only_20261123_v2/' +
  'ARBYS_GANTT_RELEASE_LIST_SCHEMA_UI_20261123_v3.json', import.meta.url),
  'utf8'));
const actionV4 = JSON.parse(readFileSync(new URL(
  '../ARBYS_GITHUB_ACTION_LIST_SCHEMA_LEAN_20261123_v4.json',
  import.meta.url), 'utf8'));

test('linkage storage is a new protected source and a Release schema delta', () => {
  assert.equal(proposed.status.startsWith('source-only'), true);
  assert.equal(proposed.evidenceList.oneCurrentRowTotal, true);
  assert.equal(proposed.evidenceList.columns.find(c =>
    c.name === 'EvidenceKey').enforceUniqueValues, true);
  const json = proposed.evidenceList.columns.find(c => c.name === 'EvidenceJson');
  assert.equal(json.type, 'Note');
  assert.equal(json.richText, false);
  assert.equal(json.appendChanges, false);
  assert(proposed.evidenceList.runtimeMaxEvidenceUtf8Bytes < 63_999);
  assert.equal(proposed.releaseListDelta.title, releaseV3.list.title);
  assert.equal(proposed.releaseListDelta.addColumn.name, 'LinkageApprovalJson');
  assert.equal(proposed.releaseListDelta.addColumn.richText, false);
  assert.equal(releaseV3.list.columns.some(c =>
    c.name === 'LinkageApprovalJson'), false,
  'existing reviewed Release schema does not yet hold linkage approval');
  assert.deepEqual(proposed.releaseListDelta.legacyFenceColumnsRemainReserved,
    ['LegacyFenceProofJson', 'LegacyFenceApprovalJson']);
  assert(releaseV3.list.columns.some(c => c.name === 'LegacyFenceProofJson'));
  assert(releaseV3.list.columns.some(c => c.name === 'LegacyFenceApprovalJson'));
  assert.deepEqual(actionV4.lists.map(list => list.title),
    ['Arbys Coordinator Action Claims', 'Arbys Coordinator Action Receipts']);
});
