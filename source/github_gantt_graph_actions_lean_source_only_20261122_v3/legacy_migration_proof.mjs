import {LegacyHold} from './legacy_reopen.mjs';

// This module reconstructs the V3 migration proof from direct, owner-only
// reads. No historical mailbox ID, customer link, or pilot key is bundled.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const CLAIM_FIELDS = Object.freeze(['Title', 'DispatchKey', 'ActionKind',
  'EntityId', 'ActorOid', 'ActorEmail', 'AttemptId', 'CorrelationId',
  'SourceDigest', 'SourceETagsJson', 'ClaimedAtUtc', 'MigratedFrom']);
const DRAFT_FIELDS = Object.freeze(['Title', 'ReceiptKey', 'DispatchKey',
  'Kind', 'ActorOid', 'DraftImmutableId', 'IntendedSubject',
  'IntendedToJson', 'RequiredLinksJson', 'IntendedBodySha256',
  'MigratedFrom']);

const object = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);
function hold(code = 'LEGACY_DERIVED_PROOF_INVALID') {
  throw new LegacyHold(code);
}
function exactKeys(value, expected) {
  return object(value) && JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, stable(value[key])]));
  if (value === null || typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number' && Number.isFinite(value)) return value;
  hold();
}
const canonical = value => JSON.stringify(stable(value));
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) hold('LEGACY_CRYPTO_UNAVAILABLE');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function pick(fields, keys) {
  if (!object(fields)) hold();
  const result = {};
  for (const key of keys) {
    if (!Object.hasOwn(fields, key) || fields[key] === undefined) hold();
    result[key] = fields[key];
  }
  return result;
}
function specFor(kind, list, dispatchKey, approvedKinds = []) {
  const spec = list?.migrationSpec;
  const provider = kind === 'provider-parts';
  const names = provider ? ['kind', 'entityId', 'oldListGuid',
    'oldListTitle', 'oldKeyField', 'oldHeader'] :
    ['kind', 'entityId', 'oldListGuid', 'oldListTitle', 'oldKeyField',
      'approvedReleaseKind'];
  if (!exactKeys(spec, names) || spec.kind !== kind ||
      spec.entityId !== dispatchKey.slice(`${kind}:`.length) ||
      String(spec.oldListGuid).toLowerCase() !==
        String(list.listId).toLowerCase() ||
      spec.oldListTitle !== list.title ||
      spec.oldKeyField !== (provider ? 'DispatchKey' : 'FormSourceKey') ||
      (provider ? spec.oldHeader !== 'x-arbys-parts-intent-id' :
        typeof spec.approvedReleaseKind !== 'string' ||
        !approvedKinds.includes(spec.approvedReleaseKind))) hold();
  return spec;
}

/**
 * Rebuild exactly the object returned by V3 prepareRestrictedProof, then
 * compare it to the digest inside the already verified owner-signed Release
 * inventory. The Claim/Draft full-field digests and ETags are checked by the
 * caller before this function. A missing signature digest always holds.
 */
export async function deriveLegacyMigrationProof({marker, dispatchKey, kind,
    actor, state, oldRow, inventory, config} = {}) {
  const list = config?.oldLists?.[kind];
  const claim = state?.claim;
  const draft = state?.draft;
  const newLists = config?.newLists;
  if (!object(list) || !object(newLists) ||
      !GUID.test(newLists.claims ?? '') ||
      !GUID.test(newLists.receipts ?? '') ||
      newLists.claims.toLowerCase() === newLists.receipts.toLowerCase() ||
      !SHA.test(list.migrationFingerprintSha256 ?? '') ||
      !SHA.test(list.migrationPlanSha256 ?? '') ||
      !SHA.test(inventory?.migrationProofDigest ?? '') ||
      !object(claim) || !object(draft) || !object(oldRow) ||
      !object(actor) || !GUID.test(actor.id ?? '') ||
      !GUID.test(claim.createdByOid ?? '') ||
      !GUID.test(draft.createdByOid ?? '') ||
      claim.createdByOid.toLowerCase() !== actor.id.toLowerCase() ||
      draft.createdByOid.toLowerCase() !== actor.id.toLowerCase() ||
      claim.fields?.MigratedFrom !== marker ||
      draft.fields?.MigratedFrom !== marker ||
      draft.fields?.DraftWebLink !== '' &&
        draft.fields?.DraftWebLink !== null &&
        draft.fields?.DraftWebLink !== undefined ||
      String(draft.fields?.ClaimItemId) !== String(claim.id) ||
      !Number.isFinite(Date.parse(draft.fields?.RecordedAtUtc ?? ''))) {
    hold();
  }
  const spec = specFor(kind, list, dispatchKey,
    config.approvedCustomerReleaseKinds);
  const claimFields = pick(claim.fields, CLAIM_FIELDS);
  const draftBase = pick(draft.fields, DRAFT_FIELDS);
  const listGuids = {claims: newLists.claims, receipts: newLists.receipts};
  const planSha256 = await sha256(canonical({spec,
    fingerprint: list.migrationFingerprintSha256,
    claimFields, draftBase, listGuids}));
  if (planSha256 !== list.migrationPlanSha256) hold();
  const proof = {
    schema: 'legacy-migration-proof/v3',
    marker, dispatchKey, actionKind: kind,
    actorOid: claim.fields.ActorOid,
    actorEmail: claim.fields.ActorEmail,
    oldListId: list.listId,
    oldItemId: String(oldRow.id),
    oldGraphEtag: oldRow.etag,
    oldFieldsSha256: await sha256(canonical(oldRow.fields)),
    immutableMessageId: draft.fields.DraftImmutableId,
    planSha256, fingerprint: list.migrationFingerprintSha256,
  };
  if (await sha256(canonical(proof)) !== inventory.migrationProofDigest) {
    hold('LEGACY_SIGNED_PROOF_DIGEST_MISMATCH');
  }
  return Object.freeze(proof);
}

/** Browser composition uses this reader; it has no secret local proof file. */
export function createDerivedLegacyProofReader(config) {
  if (!object(config?.oldLists) || !object(config?.newLists) ||
      !GUID.test(config.newLists.claims ?? '') ||
      !GUID.test(config.newLists.receipts ?? '') ||
      config.newLists.claims.toLowerCase() ===
        config.newLists.receipts.toLowerCase()) {
    hold('LEGACY_DERIVED_PROOF_PIN_MISSING');
  }
  for (const kind of ['provider-parts', 'customer-tracker']) {
    const list = config.oldLists[kind];
    const readback = list?.migrationReadback;
    const original = list?.originalOldRow;
    if (!GUID.test(list?.listId ?? '') ||
        !/^[1-9][0-9]*$/.test(String(list?.itemId ?? '')) ||
        typeof list?.title !== 'string' || !list.title ||
        !object(list?.migrationSpec) ||
        !SHA.test(list.migrationFingerprintSha256 ?? '') ||
        !SHA.test(list.migrationPlanSha256 ?? '') ||
        !/^[1-9][0-9]*$/.test(String(readback?.claimItemId ?? '')) ||
        !/^[1-9][0-9]*$/.test(String(readback?.draftReceiptItemId ?? '')) ||
        typeof readback?.claimGraphEtag !== 'string' ||
        !readback.claimGraphEtag ||
        typeof readback?.draftGraphEtag !== 'string' ||
        !readback.draftGraphEtag ||
        !SHA.test(readback?.claimFieldsSha256 ?? '') ||
        !SHA.test(readback?.draftFieldsSha256 ?? '') ||
        typeof original?.graphEtag !== 'string' ||
        !original.graphEtag ||
        !SHA.test(original?.fullFieldsSha256 ?? '')) {
      hold('LEGACY_DERIVED_PROOF_PIN_MISSING');
    }
    try {
      specFor(kind, list,
        `${kind}:${list.migrationSpec.entityId}`,
        config.approvedCustomerReleaseKinds);
    } catch { hold('LEGACY_DERIVED_PROOF_PIN_MISSING'); }
  }
  return (marker, _graph, context) => deriveLegacyMigrationProof({
    ...context, marker, config});
}
