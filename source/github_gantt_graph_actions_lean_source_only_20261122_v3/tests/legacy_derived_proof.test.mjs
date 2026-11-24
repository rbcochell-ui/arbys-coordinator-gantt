import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import test from 'node:test';
import {createDerivedLegacyProofReader} from '../legacy_migration_proof.mjs';

globalThis.crypto ??= webcrypto;
const stable = value => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(stable(value));
const OWNER = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const CLAIMS = '33333333-3333-4333-8333-333333333333';
const RECEIPTS = '44444444-4444-4444-8444-444444444444';
const KEY = 'provider-parts:0WOTN00000abcde4AA';
const MARKER = 'legacy-provider-parts:invented-review';
const FINGERPRINT = 'f'.repeat(64);

function fixture() {
  const spec = {kind: 'provider-parts',
    entityId: '0WOTN00000abcde4AA', oldListGuid: OLD,
    oldListTitle: 'Invented Provider Ledger',
    oldKeyField: 'DispatchKey', oldHeader: 'x-arbys-parts-intent-id'};
  const claimFields = {Title: KEY, DispatchKey: KEY,
    ActionKind: 'provider-parts', EntityId: spec.entityId,
    ActorOid: OWNER, ActorEmail: 'owner@example.invalid',
    AttemptId: '55555555-5555-4555-8555-555555555555',
    CorrelationId: '66666666-6666-4666-8666-666666666666',
    SourceDigest: 'a'.repeat(64), SourceETagsJson: '{}',
    ClaimedAtUtc: '2026-11-23T11:00:00.000Z',
    MigratedFrom: MARKER};
  const draftBase = {Title: `${KEY}|Draft`,
    ReceiptKey: `${KEY}|Draft`, DispatchKey: KEY, Kind: 'Draft',
    ActorOid: OWNER, DraftImmutableId: 'immutable-invented-draft',
    IntendedSubject: 'Invented parts review',
    IntendedToJson: '["manager@example.invalid","planner@example.invalid"]',
    RequiredLinksJson: '["https://parts.example.invalid/1"]',
    IntendedBodySha256: 'b'.repeat(64), MigratedFrom: MARKER};
  const state = {claim: {id: '41', etag: '"1"', createdByOid: OWNER,
    fields: {...claimFields, SharePointExtra: 'unchanged'}},
  draft: {id: '42', etag: '"1"', createdByOid: OWNER,
    fields: {...draftBase, ClaimItemId: '41', DraftWebLink: '',
      RecordedAtUtc: '2026-11-23T11:01:00.000Z'}}, sent: null};
  const oldRow = {id: '1', etag: '"4"', fields: {
    DispatchKey: KEY, ImmutableMessageId: draftBase.DraftImmutableId}};
  const listGuids = {claims: CLAIMS, receipts: RECEIPTS};
  const planSha256 = hash(canonical({spec, fingerprint: FINGERPRINT,
    claimFields, draftBase, listGuids}));
  const readback = {claimItemId: '41', draftReceiptItemId: '42',
    claimGraphEtag: '"1"', draftGraphEtag: '"1"',
    claimFieldsSha256: hash(canonical(state.claim.fields)),
    draftFieldsSha256: hash(canonical(state.draft.fields))};
  const config = {newLists: listGuids,
    approvedCustomerReleaseKinds: ['InventedRelease/v1'], oldLists: {
    'provider-parts': {listId: OLD, itemId: 1,
      title: spec.oldListTitle, migrationSpec: spec,
      migrationFingerprintSha256: FINGERPRINT,
      migrationPlanSha256: planSha256, migrationReadback: readback,
      originalOldRow: {graphEtag: '"4"',
        fullFieldsSha256: hash(canonical(oldRow.fields))}},
    'customer-tracker': {listId: '77777777-7777-4777-8777-777777777777',
      itemId: 2, title: 'Invented Customer Releases',
      migrationSpec: {kind: 'customer-tracker', entityId: 'F:123:456',
        oldListGuid: '77777777-7777-4777-8777-777777777777',
        oldListTitle: 'Invented Customer Releases',
        oldKeyField: 'FormSourceKey',
        approvedReleaseKind: 'InventedRelease/v1'},
      migrationFingerprintSha256: FINGERPRINT,
      migrationPlanSha256: 'e'.repeat(64),
      migrationReadback: readback,
      originalOldRow: {graphEtag: '"4"',
        fullFieldsSha256: hash(canonical(oldRow.fields))}},
  }};
  const actor = {id: OWNER, address: 'owner@example.invalid'};
  const proof = {schema: 'legacy-migration-proof/v3',
    marker: MARKER, dispatchKey: KEY, actionKind: 'provider-parts',
    actorOid: OWNER, actorEmail: actor.address,
    oldListId: OLD, oldItemId: '1', oldGraphEtag: '"4"',
    oldFieldsSha256: hash(canonical(oldRow.fields)),
    immutableMessageId: draftBase.DraftImmutableId,
    planSha256, fingerprint: FINGERPRINT};
  const inventory = {migrationProofDigest: hash(canonical(proof))};
  return {config, state, oldRow, actor, inventory, proof};
}

async function derive(f) {
  return createDerivedLegacyProofReader(f.config)(MARKER, null, {
    state: f.state, oldRow: f.oldRow, inventory: f.inventory,
    actor: f.actor, kind: 'provider-parts', dispatchKey: KEY});
}

test('owner reopens only the V3 proof bound to the signed digest', async () => {
  const f = fixture();
  assert.deepEqual(await derive(f), f.proof);
  assert.equal(Object.isFrozen(await derive(f)), true);
});

test('changed creator, saved plan, old fields or signed digest holds', async () => {
  for (const mutate of [
    f => { f.state.claim.createdByOid =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; },
    f => { f.state.draft.createdByOid =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; },
    f => { f.state.draft.fields.IntendedSubject = 'changed'; },
    f => { f.oldRow.fields.ImmutableMessageId = 'changed'; },
    f => { f.inventory.migrationProofDigest = '0'.repeat(64); },
    f => { f.config.oldLists['provider-parts'].migrationFingerprintSha256 =
      '0'.repeat(64); },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(derive(f), error =>
      error?.name === 'LegacyHold');
  }
});

test('missing reviewed owner pins hold before a browser Graph call', () => {
  const f = fixture();
  delete f.config.oldLists['provider-parts'].migrationSpec;
  assert.throws(() => createDerivedLegacyProofReader(f.config),
    error => error?.code === 'LEGACY_DERIVED_PROOF_PIN_MISSING');
});
