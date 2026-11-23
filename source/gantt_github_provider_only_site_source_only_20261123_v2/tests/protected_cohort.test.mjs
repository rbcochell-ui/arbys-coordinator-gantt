import test from 'node:test';
import assert from 'node:assert/strict';
import {createProtectedCohortPolicy} from '../src/protected_cohort.mjs';
import {GANTT_RELEASE_KEY} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs';

const WO = '0WO000000000000GAA';
const OTHER_WO = '0WO000000000001GAA';
const SITE = 'groups.coca-cola.com,11111111-0000-4000-8000-000000000001,11111111-0000-4000-8000-000000000002';
const LIST = '11111111-0000-4000-8000-000000000003';
const OWNER = '11111111-0000-4000-8000-000000000004';
const URL = 'https://rbcochell-ui.github.io/arbys-coordinator-gantt/data/gantt.enc.json';
const NOW = Date.parse('2026-11-23T15:10:00Z');
const graph = {request() { throw new Error('The injected reader handles Graph'); }};

async function hash(bytes) {
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function htmlWithIds(ids = [WO]) {
  const routes = {schema: 'ArbysGanttSelection/v1', actionsEnabled: false,
    providerAllowedNativeWorkOrderIds: ids,
    customerAllowedFormSourceKeys: []};
  return `<html><script type="application/json" id="actionRoutes">${JSON.stringify(routes)}</script></html>`;
}
async function fixture() {
  const html = htmlWithIds();
  const bytes = new TextEncoder().encode('{"synthetic":"ciphertext"}');
  const row = {siteId: SITE, listId: LIST, payloadUrl: URL, id: '7',
    etag: '"1"', modifiedBy: OWNER,
    modifiedAt: '2026-11-23T15:01:00Z', fields: {
      ReleaseKey: GANTT_RELEASE_KEY, ReleaseState: 'Approved',
      DecryptedHtmlSha256: await hash(new TextEncoder().encode(html)),
      EncryptedPayloadSha256: await hash(bytes),
      SnapshotAsOfDate: '2026-11-23',
      OverlayObservedAtUtc: '2026-11-23T14:55:00Z',
      SourceReportSha256: 'c'.repeat(64),
      ApprovedAtUtc: '2026-11-23T15:00:00Z',
      ValidUntilUtc: '2026-11-23T15:30:00Z',
      ApprovedByOid: OWNER, EncryptedPayloadUrl: URL,
    }};
  let reads = 0;
  const policy = await createProtectedCohortPolicy({
    chart: {html, encryptedPayloadBytes: bytes,
      encryptedPayloadUrl: URL}, siteId: SITE, releaseListId: LIST,
    ownerOids: [OWNER], payloadUrl: URL, now: () => NOW,
    readRelease: async () => { reads++; return structuredClone(row); },
  });
  return {row, policy, reads: () => reads};
}

test('an owner-approved exact chart selection is the protected pilot cohort',
    async () => {
  const f = await fixture();
  const current = await f.policy.assertAllowed(WO, graph);
  assert.match(current.releaseBinding, /^[0-9a-f]{64}$/u);
  assert.equal(current.validUntilMs, NOW + 15 * 60_000);
  await assert.rejects(() => f.policy.assertAllowed(OTHER_WO, graph),
    /PROVIDER_NOT_IN_APPROVED_COHORT/);
  assert.equal(f.reads(), 1, 'an unlisted ID never reads the protected row');
});

test('the release ETag and approval must still match at draft click',
    async () => {
  const f = await fixture();
  const preview = await f.policy.assertAllowed(WO, graph);
  f.row.etag = '"2"';
  await assert.rejects(() => f.policy.assertAllowed(WO, graph,
    preview.releaseBinding), /PROVIDER_COHORT_CHANGED_SINCE_PREVIEW/);
  f.row.etag = '"1"';
  f.row.fields.ReleaseState = 'Revoked';
  await assert.rejects(() => f.policy.assertAllowed(WO, graph,
    preview.releaseBinding), /PROVIDER_COHORT_NOT_OWNER_APPROVED/);
});

test('public chart edits, wrong owner, or expired approval cannot arm a draft',
    async () => {
  for (const change of [
    row => { row.fields.DecryptedHtmlSha256 = 'd'.repeat(64); },
    row => { row.fields.EncryptedPayloadSha256 = 'd'.repeat(64); },
    row => { row.modifiedBy = '11111111-0000-4000-8000-000000000005'; },
    row => { row.fields.ValidUntilUtc = '2026-11-23T15:00:30Z'; },
  ]) {
    const f = await fixture();
    change(f.row);
    await assert.rejects(() => f.policy.assertAllowed(WO, graph));
  }
});

test('disabled or empty chart cohort fails before any protected read',
    async () => {
  const html = htmlWithIds([]);
  const bytes = new Uint8Array([1]);
  let reads = 0;
  await assert.rejects(() => createProtectedCohortPolicy({
    chart: {html, encryptedPayloadBytes: bytes,
      encryptedPayloadUrl: URL}, siteId: SITE, releaseListId: LIST,
    ownerOids: [OWNER], payloadUrl: URL, now: () => NOW,
    readRelease: async () => { reads++; return {}; },
  }), /PROVIDER_COHORT_EMPTY/);
  assert.equal(reads, 0);
});
