import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createGuardedLegacyMigration} from './migration_reopen_contract.mjs';

const TRACKER = 'https://tracker.example.invalid/project/track.html?' +
  'p=p_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#k=' + 'A'.repeat(43);
const LINK = 'https://outlook.office.com/custom-route/invented';
class TestParser {
  parseFromString(html) {
    return {querySelectorAll: () => [...html.matchAll(/<a href="([^"]+)"/g)]
      .map(match => ({getAttribute: name => name === 'href' ?
        match[1] : null}))};
  }
}
class MigrationHold extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fixture() {
  return {
    spec: {kind: 'customer-tracker'},
    observation: {
      old: {directItem: {fields: {DraftWebLink: LINK,
        DraftBodyHtml: `<p>Saved release text</p><a href="${TRACKER}">Track</a>`}}},
      mail: {draft: {webLink: LINK,
        bodyHtml: `<p>Observed Outlook edit</p><a href="${TRACKER}">Open</a>`,
        anchorTargets: [TRACKER]}},
      source: {requiredLinks: [TRACKER]},
    },
  };
}
function api(calls) {
  return {
    MigrationHold,
    prepareMigration(spec, observation) {
      calls.prepare++;
      return {spec, fingerprint: observation.mail.draft.bodyHtml};
    },
    prepareRestrictedProof(plan) {
      calls.proof++;
      return {fingerprint: plan.fingerprint};
    },
    async importOneShot(plan, io) {
      await io.observe(plan.spec);
      await io.postClaim();
      return {status: 'synthetic-import'};
    },
  };
}

test('offline wrapper admits edited observed HTML with the same tracker anchor', () => {
  const calls = {prepare: 0, proof: 0};
  const guard = createGuardedLegacyMigration(api(calls));
  const {spec, observation} = fixture();
  assert.notEqual(observation.old.directItem.fields.DraftBodyHtml,
    observation.mail.draft.bodyHtml);
  const plan = guard.prepareReopenableMigration(spec, observation,
    {domParserClass: TestParser});
  guard.prepareReopenableRestrictedProof(plan, observation,
    {domParserClass: TestParser});
  assert.deepEqual(calls, {prepare: 1, proof: 1});
});

test('offline one-shot wrapper blocks changed HTML before any List POST', async () => {
  const calls = {prepare: 0, proof: 0, posts: 0};
  const guard = createGuardedLegacyMigration(api(calls));
  const {spec, observation} = fixture();
  const plan = guard.prepareReopenableMigration(spec, observation,
    {domParserClass: TestParser});
  const io = {
    async observe() { return {...observation,
      mail: {draft: {...observation.mail.draft,
        bodyHtml: '<p>Link removed</p>'}}}; },
    async loadRestrictedProof() { return {}; },
    async postClaim() { calls.posts++; },
    async postDraftReceipt() { calls.posts++; },
  };
  await assert.rejects(guard.importReopenableOneShot(plan, io,
    {domParserClass: TestParser}), error =>
    error instanceof MigrationHold &&
      error.code === 'REOPEN_ADMISSION_HTML_OR_LINK_UNVERIFIED');
  assert.equal(calls.posts, 0);
});

test('the browser action entry cannot import the offline migration gate', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(root, '..',
    'gantt_github_two_button_site_integrated_source_only_20261123_v2',
    'site', 'view.mjs');
  const seen = new Set();
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    assert.equal(file.includes('legacy_migration_guard_source_only'), false);
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\()['"](\.[^'"]+)['"]/g)];
    for (const [, target] of imports) visit(resolve(dirname(file), target));
  }
  visit(entry);
  assert.ok(seen.size > 10);
});
