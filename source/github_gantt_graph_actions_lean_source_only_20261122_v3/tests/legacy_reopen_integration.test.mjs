import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {LegacyHold, LegacyReopenAdapter} from '../legacy_reopen.mjs';
import {recordLegacySentOnce} from '../legacy_sent_receipt.mjs';
import {createSignedOwnerRoute} from '../signed_owner_route.mjs';
import {LegacyOwnerRecovery} from '../legacy_owner_recovery.mjs';
import {createDerivedLegacyProofReader} from '../legacy_migration_proof.mjs';
import {createLegacySentGraphPort} from '../legacy_sent_graph_port.mjs';
import {sentPlanDigest} from '../legacy_sent_attempt_contract.mjs';
import {LeanGanttActions} from '../actions.mjs';
import {GraphHttpError} from '../graph.mjs';
import {SnapshotProviderActionWriter} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v7_verified_prefill/snapshot_provider_writer.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const oldItemSha = fields => sha(JSON.stringify(stable({
  id: '1', eTag: '"4"', fields,
})));
const actor = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  address: 'owner@example.invalid',
});
const providerKey = 'provider-parts:0WOTN00000abcde4AA';
const customerKey = 'customer-tracker:F:12345678:9999999999';
const providerListId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customerListId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const parts = Array.from({length: 6}, (_, i) =>
  `https://parts.example.invalid/product/${i + 1}`);
const tracker = 'https://tracker.example.invalid/project/track.html?' +
  'p=p_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#k=' + 'A'.repeat(43);

class TestParser {
  parseFromString(html) {
    return {querySelectorAll: () => [...html.matchAll(/<a href="([^"]+)"/g)]
      .map(match => ({getAttribute: name => name === 'href' ? match[1] : null}))};
  }
}

const clone = value => structuredClone(value);
const recipient = address => ({emailAddress: {address}});

function makeFixture(kind = 'provider-parts') {
  const provider = kind === 'provider-parts';
  const key = provider ? providerKey : customerKey;
  const entity = key.slice(`${kind}:`.length);
  const marker = `legacy-${kind}:synthetic-review-packet`;
  const id = provider ? 'immutable-provider-synthetic' : 'immutable-customer-synthetic';
  const webLink = `https://outlook.office.com/owa/?ItemID=${id}`;
  const to = provider ? ['manager@example.invalid', 'planner@example.invalid'] :
    ['customer@example.invalid'];
  const subject = provider ? 'Synthetic WO | Parts review' :
    'Follow along with a synthetic project';
  const html = provider ? `<p>Parts review</p><ul>${parts.map(link =>
    `<li><a href="${link}">part</a></li>`).join('')}</ul>` :
    `<p>Thank you.</p><p><a href="${tracker}">Project status</a></p>`;
  const releaseHtml = '<p>Thank you for submitting your Arby\'s request to Coca-Cola.</p>' +
    `<p>To follow our progress anytime, <a href="${tracker}">view your project tracker</a>.</p>` +
    '<p>This page shows the work orders verified so far; others may exist. ' +
    'Your requested date is a planning request, not a confirmed installation date. ' +
    'Later project steps will say “Not confirmed” until we verify them.</p>' +
    '<p>If you have questions, please reply to this email.</p>' +
    '<p>Cheers,<br>The Arby\'s Coca-Cola team</p>';
  const claim = {id: '41', etag: '"1"', fields: {
    Title: key, DispatchKey: key, ActionKind: kind, EntityId: entity,
    ActorOid: actor.id, ActorEmail: actor.address, MigratedFrom: marker,
    AttemptId: '44444444-4444-4444-8444-444444444444',
    CorrelationId: '55555555-5555-4555-8555-555555555555',
    SourceDigest: 'd'.repeat(64),
    SourceETagsJson: JSON.stringify(provider ? {
      wo: {itemId: '77', etag: '"2"'},
      contact: {itemId: '78', etag: '"3"'},
    } : {release: {itemId: '1', etag: '"4"'}}),
    ClaimedAtUtc: '2026-11-23T11:00:00.000Z',
  }};
  const draft = {id: '42', etag: '"1"', fields: {
    Title: `${key}|Draft`, DispatchKey: key,
    ReceiptKey: `${key}|Draft`, Kind: 'Draft',
    ClaimItemId: '41', ActorOid: actor.id, MigratedFrom: marker,
    DraftImmutableId: id, DraftWebLink: '', IntendedSubject: subject,
    IntendedToJson: JSON.stringify(to),
    RequiredLinksJson: JSON.stringify(provider ? parts : [`sha256:${sha(tracker)}`]),
    IntendedBodySha256: sha(html),
    RecordedAtUtc: '2026-11-23T11:01:00.000Z',
  }};
  const oldFields = provider ? {
    DispatchKey: key, NativeWorkOrderId: entity, MailboxOwner: actor.address,
    IntentId: '22222222-2222-4222-8222-222222222222', State: 'Draft',
    SentAtUtc: null, ImmutableMessageId: id, DraftWebLink: webLink,
    ExpectedManagerEmail: to[0], ExpectedPlannerEmail: to[1],
  } : {
    FormSourceKey: entity, ReleaseState: 'Ready', DraftState: 'DraftReady',
    ReleaseKind: 'SyntheticRelease/v1', DraftMailbox: actor.address,
    DraftMessageId: id, DraftWebLink: webLink, RecipientEmail: to[0],
    DraftSubject: subject, DraftBodyHtml: releaseHtml,
    CustomerTrackingUrl: tracker,
    ReleaseReceiptSha256: 'a'.repeat(64), CiphertextSha256: 'b'.repeat(64),
    PublishedCommit: 'c'.repeat(40), IssuedAtUtc: '2026-11-20T00:00:00Z',
    ReadyUntilUtc: '2026-11-25T00:00:00Z',
  };
  const message = {
    id, isDraft: true, parentFolderId: 'synthetic-drafts-folder',
    sentDateTime: null, internetMessageId: null, subject,
    webLink, body: {contentType: 'html', content: html},
    toRecipients: to.map(recipient), ccRecipients: [], bccRecipients: [],
    from: recipient(actor.address), sender: recipient(actor.address),
    internetMessageHeaders: provider ? [{name: 'X-Arbys-Parts-Intent-Id',
      value: oldFields.IntentId}] : [],
  };
  const config = {
    siteId: 'groups.example.invalid,cccccccc-cccc-4ccc-8ccc-cccccccccccc,' +
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    siteUrl: 'https://groups.example.invalid/sites/Synthetic',
    oldLists: {
      'provider-parts': {listId: providerListId, itemId: 1,
        title: 'Synthetic Provider Ledger',
        migrationPlanSha256: 'e'.repeat(64)},
      'customer-tracker': {listId: customerListId, itemId: 1,
        title: 'Synthetic Customer Releases',
        migrationPlanSha256: 'e'.repeat(64)},
    },
    providerPartUrls: parts,
    tracker: {origin: 'https://tracker.example.invalid',
      paths: ['/project/track.html']},
    approvedCustomerReleaseKinds: ['SyntheticRelease/v1'],
  };
  if (!provider) claim.fields.SourceDigest = oldItemSha(oldFields);
  const state = {claim, draft, sent: null};
  for (const item of Object.values(config.oldLists)) {
    item.migrationReadback = {
      claimItemId: '41', claimGraphEtag: '"1"',
      claimFieldsSha256: sha(JSON.stringify(stable(claim.fields))),
      draftReceiptItemId: '42', draftGraphEtag: '"1"',
      draftFieldsSha256: sha(JSON.stringify(stable(draft.fields))),
    };
    item.originalOldRow = {graphEtag: '"4"',
      fullFieldsSha256: sha(JSON.stringify(stable(oldFields)))};
  }
  const proof = {schema: 'legacy-migration-proof/v3',
    marker, dispatchKey: key, actionKind: kind,
    actorOid: actor.id, actorEmail: actor.address,
    oldListId: provider ? providerListId : customerListId,
    oldItemId: 1, oldGraphEtag: '"4"',
    oldFieldsSha256: sha(JSON.stringify(Object.fromEntries(
      Object.entries(oldFields).sort(([a], [b]) => a.localeCompare(b))))),
    immutableMessageId: id, planSha256: 'e'.repeat(64),
    fingerprint: 'f'.repeat(64)};
  const calls = {requests: [], oldReads: 0, stateReads: 0, fenceReads: 0,
    proofReads: 0};
  const graph = {
    bindAccount() { return this; },
    async getMe() { return clone(actor); },
    async getFolderId(folder) {
      return folder === 'drafts' ? 'synthetic-drafts-folder' :
        'synthetic-sent-folder';
    },
    async request(path, options) {
      calls.requests.push({path, method: options?.method ?? 'GET'});
      assert.equal(options?.method ?? 'GET', 'GET');
      if (path.includes('/me/messages/')) return {status: 200, data: clone(message)};
      const listId = provider ? providerListId : customerListId;
      assert.ok(path.includes(`/lists/${listId}`));
      if (path.includes('/items/1')) {
        calls.oldReads++;
        return {status: 200, data: {id: '1', eTag: '"4"',
          fields: clone(oldFields)}};
      }
      return {status: 200, data: {id: listId,
        displayName: provider ? 'Synthetic Provider Ledger' :
          'Synthetic Customer Releases',
        webUrl: `https://groups.example.invalid/sites/Synthetic/Lists/${provider ?
          'Provider' : 'Customer'}`}};
    },
    async createDraft() { assert.fail('replacement draft must never be created'); },
  };
  const makeStore = () => ({
    async assertSchema() {},
    async getState() { calls.stateReads++; return clone(state); },
  });
  const inspectLegacyInventory = async requested => {
    calls.fenceReads++;
    return {proofDigest: 'a'.repeat(64),
      validUntilMs: Date.parse('2026-11-24T00:00:00Z'),
      occupied: {status: 'legacy_occupied', dispatchKey: requested,
        rowRef: {siteId: config.siteId,
        listId: provider ? providerListId : customerListId,
        itemId: 1, etag: '"4"'}}};
  };
  const loadMigrationProof = async () => {
    calls.proofReads++;
    return clone(proof);
  };
  const adapter = new LegacyReopenAdapter({graph, makeStore,
    inspectLegacyInventory,
    loadMigrationProof, config,
    domParserClass: TestParser, now: () => Date.parse('2026-11-23T12:00:00Z')});
  return {key, id, webLink, to, html, state, oldFields, message, proof, config,
    graph, calls, adapter};
}

async function held(operation, code) {
  await assert.rejects(operation, error => error instanceof LegacyHold &&
    error.code === code);
}

test('provider reopens the same immutable draft with old intent header and no new header', async () => {
  const f = makeFixture();
  const result = await f.adapter.reopen(f.key);
  assert.deepEqual(result, {status: 'legacy_draft_review_required',
    reason: 'CURRENT_SOURCE_REVIEW_REQUIRED', webLink: f.webLink,
    sentAtUtc: null, sendReady: false});
  assert.equal(f.calls.oldReads, 2);
  assert.equal(f.calls.stateReads, 2);
  assert.equal(f.calls.fenceReads, 2);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
  assert.ok(f.calls.requests.some(call => call.path.includes(
    `/me/messages/${encodeURIComponent(f.id)}`)));
});

test('signed inventory and pinned V3 migration plan reopen the old draft without a proof file', async () => {
  const f = makeFixture();
  const list = f.config.oldLists['provider-parts'];
  const spec = {kind: 'provider-parts', entityId: f.key.slice(15),
    oldListGuid: list.listId, oldListTitle: list.title,
    oldKeyField: 'DispatchKey', oldHeader: 'x-arbys-parts-intent-id'};
  const claimNames = ['Title', 'DispatchKey', 'ActionKind', 'EntityId',
    'ActorOid', 'ActorEmail', 'AttemptId', 'CorrelationId', 'SourceDigest',
    'SourceETagsJson', 'ClaimedAtUtc', 'MigratedFrom'];
  const draftNames = ['Title', 'ReceiptKey', 'DispatchKey', 'Kind',
    'ActorOid', 'DraftImmutableId', 'IntendedSubject', 'IntendedToJson',
    'RequiredLinksJson', 'IntendedBodySha256', 'MigratedFrom'];
  const claimFields = Object.fromEntries(claimNames.map(name =>
    [name, f.state.claim.fields[name]]));
  const draftBase = Object.fromEntries(draftNames.map(name =>
    [name, f.state.draft.fields[name]]));
  f.config.newLists = {claims: '99999999-9999-4999-8999-999999999999',
    receipts: '88888888-8888-4888-8888-888888888888'};
  list.migrationSpec = spec;
  list.migrationFingerprintSha256 = f.proof.fingerprint;
  list.migrationPlanSha256 = sha(JSON.stringify(stable({spec,
    fingerprint: f.proof.fingerprint, claimFields, draftBase,
    listGuids: f.config.newLists})));
  f.proof.planSha256 = list.migrationPlanSha256;
  f.proof.oldItemId = '1';
  f.proof.oldFieldsSha256 = sha(JSON.stringify(stable(f.oldFields)));
  f.state.claim.createdByOid = actor.id;
  f.state.draft.createdByOid = actor.id;
  const proofDigest = sha(JSON.stringify(stable(f.proof)));
  const originalInventory = f.adapter.inspectLegacyInventory;
  const adapter = new LegacyReopenAdapter({graph: f.graph,
    makeStore: f.adapter.makeStore,
    inspectLegacyInventory: async (...args) => ({
      ...await originalInventory(...args), migrationProofDigest: proofDigest}),
    loadMigrationProof: createDerivedLegacyProofReader({
      ...f.config, oldLists: {
        ...f.config.oldLists,
        'customer-tracker': {
          ...f.config.oldLists['customer-tracker'],
          migrationSpec: {kind: 'customer-tracker',
            entityId: 'F:123:456',
            oldListGuid: f.config.oldLists['customer-tracker'].listId,
            oldListTitle: f.config.oldLists['customer-tracker'].title,
            oldKeyField: 'FormSourceKey',
            approvedReleaseKind: 'SyntheticRelease/v1'},
          migrationFingerprintSha256: f.proof.fingerprint,
        },
      },
    }),
    config: f.config, domParserClass: TestParser,
    now: () => Date.parse('2026-11-23T12:00:00Z')});
  assert.equal((await adapter.reopen(f.key)).webLink, f.webLink);
  assert.equal(f.calls.proofReads, 0);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
});

test('customer reopens only the same draft and never exposes the tracker URL', async () => {
  const f = makeFixture('customer-tracker');
  assert.notEqual(f.oldFields.DraftBodyHtml, f.message.body.content);
  const result = await f.adapter.reopen(f.key);
  assert.equal(result.status, 'legacy_draft_review_required');
  assert.equal(result.webLink, f.webLink);
  assert.equal(JSON.stringify(result).includes(tracker), false);
});

test('reviewed Outlook host with a Graph route beyond mail and owa can reopen', async () => {
  const f = makeFixture('customer-tracker');
  const alternate = 'https://outlook.office.com/custom-route/invented';
  f.oldFields.DraftWebLink = alternate;
  f.message.webLink = alternate;
  f.proof.oldFieldsSha256 = sha(JSON.stringify(stable(f.oldFields)));
  f.config.oldLists['customer-tracker'].originalOldRow.fullFieldsSha256 =
    f.proof.oldFieldsSha256;
  f.state.claim.fields.SourceDigest = oldItemSha(f.oldFields);
  f.config.oldLists['customer-tracker'].migrationReadback.claimFieldsSha256 =
    sha(JSON.stringify(stable(f.state.claim.fields)));
  assert.equal((await f.adapter.reopen(f.key)).webLink, alternate);
});

test('another coordinator receives occupied handoff, without mailbox read or link', async () => {
  const f = makeFixture();
  f.graph.getMe = async () => ({id: '33333333-3333-4333-8333-333333333333',
    address: 'teammate@example.invalid'});
  const result = await f.adapter.reopen(f.key);
  assert.deepEqual(result, {status: 'legacy_occupied',
    reason: 'OWNER_HANDOFF_REQUIRED', webLink: null});
  assert.equal(f.calls.oldReads, 0);
  assert.ok(f.calls.requests.every(call => !call.path.includes('/me/messages/')));
});

test('missing migrated draft receipt stays occupied and never posts', async () => {
  const f = makeFixture();
  f.state.draft = null;
  await held(() => f.adapter.reopen(f.key), 'LEGACY_NEW_STATE_UNVERIFIED');
  assert.equal(f.calls.oldReads, 0);
});

test('old provider intent header mismatch holds', async () => {
  const f = makeFixture();
  f.message.internetMessageHeaders[0].value = '33333333-3333-4333-8333-333333333333';
  await held(() => f.adapter.reopen(f.key), 'LEGACY_INTENT_HEADER_MISMATCH');
});

test('old customer Release recipient mismatch holds before Outlook read', async () => {
  const f = makeFixture('customer-tracker');
  f.oldFields.RecipientEmail = 'different@example.invalid';
  f.proof.oldFieldsSha256 = sha(JSON.stringify(Object.fromEntries(
    Object.entries(f.oldFields).sort(([a], [b]) => a.localeCompare(b)))));
  f.config.oldLists['customer-tracker'].originalOldRow.fullFieldsSha256 =
    f.proof.oldFieldsSha256;
  f.state.claim.fields.SourceDigest = oldItemSha(f.oldFields);
  f.config.oldLists['customer-tracker'].migrationReadback.claimFieldsSha256 =
    sha(JSON.stringify(stable(f.state.claim.fields)));
  await held(() => f.adapter.reopen(f.key), 'LEGACY_CUSTOMER_RELEASE_MISMATCH');
  assert.ok(f.calls.requests.every(call => !call.path.includes('/me/messages/')));
});

test('a changed body or extra recipient never gets a reopen link', async () => {
  const body = makeFixture();
  body.message.body.content += '<p>altered</p>';
  await held(() => body.adapter.reopen(body.key), 'LEGACY_MESSAGE_BODY_CHANGED');
  const recipientChanged = makeFixture();
  recipientChanged.message.ccRecipients.push(recipient('extra@example.invalid'));
  await held(() => recipientChanged.adapter.reopen(recipientChanged.key),
    'LEGACY_MESSAGE_RECIPIENTS_CHANGED');
});

test('a missing immutable message is unresolved, never a free key', async () => {
  const f = makeFixture();
  const original = f.graph.request;
  f.graph.request = async function(path, options) {
    if (path.includes('/me/messages/')) throw new Error('404');
    return original.call(this, path, options);
  };
  await held(() => f.adapter.reopen(f.key), 'LEGACY_MESSAGE_READ_UNCERTAIN');
});

test('Sent status requires the same immutable ID in real Sent Items', async () => {
  const f = makeFixture();
  f.message.isDraft = false;
  f.message.parentFolderId = 'synthetic-sent-folder';
  f.message.sentDateTime = '2026-11-23T12:12:00Z';
  f.message.internetMessageId = '<synthetic@example.invalid>';
  f.message.webLink = 'https://outlook.office.com/mail/sent/synthetic';
  const result = await f.adapter.reopen(f.key);
  assert.deepEqual(result, {status: 'sent_observed_unlogged',
    reason: 'SENT_RECEIPT_REQUIRED', webLink: null,
    sentAtUtc: '2026-11-23T12:12:00.000Z', sendReady: false});
  const missingEvidence = makeFixture();
  missingEvidence.message.isDraft = false;
  missingEvidence.message.parentFolderId = 'synthetic-sent-folder';
  await held(() => missingEvidence.adapter.reopen(missingEvidence.key),
    'LEGACY_SENT_NOT_CONFIRMED');
});

test('a recorded Sent receipt keeps its details-changed status', async () => {
  const f = makeFixture();
  f.message.isDraft = false;
  f.message.parentFolderId = 'synthetic-sent-folder';
  f.message.sentDateTime = '2026-11-23T12:12:00Z';
  f.message.internetMessageId = '<synthetic@example.invalid>';
  f.message.webLink = 'https://outlook.office.com/mail/sent/synthetic';
  f.state.sent = {id: '43', etag: '"1"', createdByOid: actor.id,
    fields: {
    Title: `${f.key}|Sent`, DispatchKey: f.key,
    ReceiptKey: `${f.key}|Sent`, Kind: 'Sent',
    ClaimItemId: '41', ActorOid: actor.id,
    MigratedFrom: f.state.claim.fields.MigratedFrom,
    DraftImmutableId: f.id, SentImmutableId: f.id,
    SentAtUtc: '2026-11-23T12:12:00.000Z',
    SentInternetMessageId: '<synthetic@example.invalid>',
    ActualSubject: `sha256:${sha(f.message.subject)}`,
    ActualBodySha256: sha(f.html),
    ActualLinksSha256: sha(JSON.stringify([...parts].sort())),
    ActualToJson: JSON.stringify(f.to), ActualCcJson: '[]',
    ActualBccJson: '[]', ReviewReason: 'SENT_DETAILS_CHANGED',
    RecordedAtUtc: '2026-11-23T12:13:00.000Z',
  }};
  const result = await f.adapter.reopen(f.key);
  assert.equal(result.status, 'sent_with_changes');
  assert.equal(result.webLink, null);
  f.state.sent.createdByOid =
    '33333333-3333-4333-8333-333333333333';
  await held(() => f.adapter.reopen(f.key),
    'LEGACY_SENT_RECEIPT_CONFLICT');
});

test('old-row ETag or new Claim change during read holds the result', async () => {
  const oldChanged = makeFixture();
  const original = oldChanged.graph.request;
  oldChanged.graph.request = async function(path, options) {
    const response = await original.call(this, path, options);
    if (path.includes('/items/1') && oldChanged.calls.oldReads === 2) {
      response.data.eTag = '"5"';
    }
    return response;
  };
  await held(() => oldChanged.adapter.reopen(oldChanged.key),
    'LEGACY_CONCURRENT_CHANGE');

  const newChanged = makeFixture();
  const originalStore = newChanged.adapter.makeStore;
  newChanged.adapter.makeStore = graph => {
    const store = originalStore(graph);
    const get = store.getState;
    store.getState = async (...args) => {
      const state = await get(...args);
      if (newChanged.calls.stateReads === 2) state.draft.etag = '"2"';
      return state;
    };
    return store;
  };
  await held(() => newChanged.adapter.reopen(newChanged.key),
    'LEGACY_CONCURRENT_CHANGE');
});

test('a draft sent during the trailing reads cannot return a stale draft link', async () => {
  const f = makeFixture();
  const original = f.graph.request;
  let mailReads = 0;
  f.graph.request = async function(path, options) {
    const response = await original.call(this, path, options);
    if (path.includes('/me/messages/') && ++mailReads === 2) {
      response.data.isDraft = false;
      response.data.parentFolderId = 'synthetic-sent-folder';
    }
    return response;
  };
  await held(() => f.adapter.reopen(f.key), 'LEGACY_CONCURRENT_CHANGE');
});

test('old row changed before reopen cannot be accepted as the migration row', async () => {
  const f = makeFixture();
  f.oldFields.SourceRevision = 'new unreviewed revision';
  await held(() => f.adapter.reopen(f.key),
    'LEGACY_OLD_ROW_CHANGED_SINCE_MIGRATION');
  assert.ok(f.calls.requests.every(call => !call.path.includes('/me/messages/')));
});

test('renewed provider proof or inventory cannot rebase the original Ledger row', async () => {
  const changedFields = makeFixture();
  changedFields.oldFields.SourceRevision = 'invented later edit';
  changedFields.proof.oldFieldsSha256 =
    sha(JSON.stringify(stable(changedFields.oldFields)));
  await held(() => changedFields.adapter.reopen(changedFields.key),
    'LEGACY_MIGRATION_PROOF_INVALID');
  assert.equal(changedFields.calls.oldReads, 1);

  const changedEtag = makeFixture();
  changedEtag.proof.oldGraphEtag = '"5"';
  const originalInspect = changedEtag.adapter.inspectLegacyInventory;
  changedEtag.adapter.inspectLegacyInventory = async (...args) => {
    const result = await originalInspect(...args);
    return {...result, occupied: {...result.occupied,
      rowRef: {...result.occupied.rowRef, etag: '"5"'}}};
  };
  await held(() => changedEtag.adapter.reopen(changedEtag.key),
    'LEGACY_FENCE_IDENTITY_MISMATCH');
  assert.equal(changedEtag.calls.oldReads, 0);
});

test('missing or mismatched migration proof stops before mailbox reads', async () => {
  const absent = makeFixture();
  absent.adapter.loadMigrationProof = async () => null;
  await held(() => absent.adapter.reopen(absent.key),
    'LEGACY_MIGRATION_PROOF_INVALID');
  assert.equal(absent.calls.oldReads, 1);

  const mismatched = makeFixture();
  mismatched.proof.immutableMessageId = 'other-immutable-synthetic';
  await held(() => mismatched.adapter.reopen(mismatched.key),
    'LEGACY_MIGRATION_PROOF_INVALID');
  assert.equal(mismatched.calls.oldReads, 1);
  assert.ok(absent.calls.requests.every(call =>
    !call.path.includes('/me/messages/')));
  assert.ok(mismatched.calls.requests.every(call =>
    !call.path.includes('/me/messages/')));
});

test('fence failure holds even if a migrated Claim is present', async () => {
  const f = makeFixture();
  f.adapter.inspectLegacyInventory = async () => null;
  await held(() => f.adapter.reopen(f.key), 'LEGACY_FENCE_UNVERIFIED');
  assert.equal(f.calls.oldReads, 0);
});

test('a fence row identity different from the adapter target holds', async () => {
  const f = makeFixture();
  f.adapter.inspectLegacyInventory = async requested => ({
    proofDigest: 'a'.repeat(64),
    validUntilMs: Date.parse('2026-11-24T00:00:00Z'),
    occupied: {status: 'legacy_occupied', dispatchKey: requested,
      rowRef: {siteId: f.config.siteId,
        listId: customerListId, itemId: 1, etag: '"4"'}}});
  await held(() => f.adapter.reopen(f.key), 'LEGACY_FENCE_IDENTITY_MISMATCH');
  assert.equal(f.calls.oldReads, 0);
});

test('duplicated HTML href attribute fails before DOM parsing', async () => {
  const f = makeFixture();
  const first = parts[0];
  f.message.body.content = f.message.body.content.replace(
    `<a href="${first}">`, `<a href="${first}" href="https://evil.example.invalid/">`);
  f.state.draft.fields.IntendedBodySha256 = sha(f.message.body.content);
  f.config.oldLists['provider-parts'].migrationReadback.draftFieldsSha256 =
    sha(JSON.stringify(stable(f.state.draft.fields)));
  await held(() => f.adapter.reopen(f.key), 'LEGACY_HTML_UNVERIFIED');
});

function moveToSent(f) {
  f.message.isDraft = false;
  f.message.parentFolderId = 'synthetic-sent-folder';
  f.message.sentDateTime = '2026-11-23T12:12:00Z';
  f.message.internetMessageId = '<synthetic@example.invalid>';
  f.message.webLink = 'https://outlook.office.com/mail/sent/synthetic';
}

function saveAttempt(f, fields, id = '43') {
  f.state.attempt = {id, etag: '"1"', createdByOid: actor.id,
    fields: clone(fields)};
}
function saveSent(f, fields, id = '44') {
  f.state.sent = {id, etag: '"1"', createdByOid: actor.id,
    fields: clone(fields)};
}

test('V3 proof and pinned migration plan are required', async () => {
  const wrongSchema = makeFixture();
  wrongSchema.proof.schema = 'legacy-migration-proof/v2';
  await held(() => wrongSchema.adapter.reopen(wrongSchema.key),
    'LEGACY_MIGRATION_PROOF_INVALID');
  const wrongPlan = makeFixture();
  wrongPlan.proof.planSha256 = 'd'.repeat(64);
  await held(() => wrongPlan.adapter.reopen(wrongPlan.key),
    'LEGACY_MIGRATION_PROOF_INVALID');
  assert.equal(wrongPlan.calls.oldReads, 1);
});

test('Claim or Draft Receipt changed after migration cannot reopen', async () => {
  const claim = makeFixture();
  claim.state.claim.fields.SourceDigest = 'f'.repeat(64);
  await held(() => claim.adapter.reopen(claim.key),
    'LEGACY_NEW_STATE_CHANGED_SINCE_MIGRATION');
  assert.equal(claim.calls.oldReads, 0);
  const draft = makeFixture('customer-tracker');
  draft.state.draft.fields.IntendedToJson =
    JSON.stringify(['other@example.invalid']);
  await held(() => draft.adapter.reopen(draft.key),
    'LEGACY_NEW_STATE_CHANGED_SINCE_MIGRATION');
  assert.equal(draft.calls.oldReads, 0);
});

test('customer Claim source binds the exact old Graph item', async () => {
  const f = makeFixture('customer-tracker');
  f.state.claim.fields.SourceDigest = 'd'.repeat(64);
  f.config.oldLists['customer-tracker'].migrationReadback.claimFieldsSha256 =
    sha(JSON.stringify(stable(f.state.claim.fields)));
  await held(() => f.adapter.reopen(f.key),
    'LEGACY_CUSTOMER_SOURCE_MISMATCH');
  assert.ok(f.calls.requests.every(call => !call.path.includes('/me/messages/')));
});

test('signed inventory digest or expiry drift at final read holds', async () => {
  const changed = makeFixture();
  const original = changed.adapter.inspectLegacyInventory;
  changed.adapter.inspectLegacyInventory = async (...args) => {
    const result = await original(...args);
    return changed.calls.fenceReads === 2 ?
      {...result, proofDigest: 'b'.repeat(64)} : result;
  };
  await held(() => changed.adapter.reopen(changed.key),
    'LEGACY_CONCURRENT_CHANGE');
  const expired = makeFixture();
  const inspect = expired.adapter.inspectLegacyInventory;
  expired.adapter.inspectLegacyInventory = async (...args) => {
    const result = await inspect(...args);
    return expired.calls.fenceReads === 2 ?
      {...result, validUntilMs: Date.parse('2026-11-23T11:59:00Z')} : result;
  };
  await held(() => expired.adapter.reopen(expired.key),
    'LEGACY_CONCURRENT_CHANGE');
});

test('changed Sent immutable ID is unresolved; subject match never substitutes', async () => {
  const f = makeFixture();
  moveToSent(f);
  let subjectScan = false;
  const original = f.graph.request;
  f.graph.request = async function(path, options) {
    if (path.includes('/me/messages/')) throw new Error('saved ID not found');
    if (path.includes('subject')) subjectScan = true;
    return original.call(this, path, options);
  };
  await held(() => f.adapter.reopen(f.key), 'LEGACY_MESSAGE_READ_UNCERTAIN');
  assert.equal(subjectScan, false);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
});

test('one-time Sent receipt records the same proven provider item only', async () => {
  const f = makeFixture();
  moveToSent(f);
  let posts = 0;
  const post = async (fields, boundary, beforeFetch) => {
    posts++;
    beforeFetch();
    assert.equal(fields.MigratedFrom,
      f.state.claim.fields.MigratedFrom);
    assert.equal(fields.DraftImmutableId, f.id);
    assert.equal(fields.ClaimItemId, '41');
    assert.equal(boundary.oldRowEtag, '"4"');
    assert.equal(JSON.stringify(fields).includes('https://'), false);
    if (fields.Kind === 'SentAttempt') {
      assert.equal(fields.PlannedSentSha256,
        await sentPlanDigest(boundary.plannedSentFields));
      saveAttempt(f, fields);
      return {status: 201, data: {id: '43'}};
    }
    assert.equal(fields.Kind, 'Sent');
    assert.equal(fields.SentImmutableId, f.id);
    assert.equal(boundary.attemptItemId, '43');
    saveSent(f, fields);
    return {status: 201, data: {id: '44'}};
  };
  const result = await recordLegacySentOnce(f.adapter, f.key, post,
    {now: () => Date.parse('2026-11-23T12:00:00Z')});
  assert.equal(result.status, 'sent');
  assert.equal(result.webLink, null);
  assert.equal(posts, 2);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
});

test('post-marker owner reread keeps the exact frozen Sent timestamp and digest', async () => {
  const f = makeFixture();
  moveToSent(f);
  let observationNow = Date.parse('2026-11-23T12:00:00Z');
  f.adapter.now = () => observationNow;
  let markerDigest = null;
  let posts = 0;
  const result = await recordLegacySentOnce(f.adapter, f.key,
    async (fields, refs, beforeFetch) => {
      posts++;
      beforeFetch();
      if (fields.Kind === 'SentAttempt') {
        markerDigest = fields.PlannedSentSha256;
        assert.equal(markerDigest,
          await sentPlanDigest(refs.plannedSentFields));
        saveAttempt(f, fields);
        observationNow += 1000;
        return {status: 201, data: {id: '43'}};
      }
      assert.equal(fields.Kind, 'Sent');
      assert.equal(fields.RecordedAtUtc,
        '2026-11-23T12:00:00.000Z');
      assert.equal(refs.plannedSentSha256, markerDigest);
      assert.equal(await sentPlanDigest(fields), markerDigest);
      saveSent(f, fields);
      return {status: 201, data: {id: '44'}};
    }, {now: () => Date.parse('2026-11-23T12:00:00Z')});
  assert.equal(result.status, 'sent');
  assert.equal(posts, 2);
});

test('one-time Sent receipt works for exact customer release without link exposure', async () => {
  const f = makeFixture('customer-tracker');
  moveToSent(f);
  let posts = 0;
  const result = await recordLegacySentOnce(f.adapter, f.key,
    async (fields, _boundary, beforeFetch) => {
      posts++;
      beforeFetch();
      assert.equal(JSON.stringify(fields).includes(tracker), false);
      if (fields.Kind === 'SentAttempt') {
        saveAttempt(f, fields);
        return {status: 201, data: {id: '43'}};
      }
      saveSent(f, fields);
      return {status: 201, data: {id: '44'}};
    }, {now: () => Date.parse('2026-11-23T12:00:00Z')});
  assert.equal(result.status, 'sent');
  assert.equal(posts, 2);
});

test('one-time Sent writer never posts for draft, missing ID, or nonowner', async () => {
  for (const mode of ['draft', 'missing', 'nonowner']) {
    const f = makeFixture();
    if (mode !== 'draft') moveToSent(f);
    if (mode === 'missing') {
      const request = f.graph.request;
      f.graph.request = async function(path, options) {
        if (path.includes('/me/messages/')) throw new Error('404');
        return request.call(this, path, options);
      };
    }
    if (mode === 'nonowner') {
      f.graph.getMe = async () => ({
        id: '33333333-3333-4333-8333-333333333333',
        address: 'teammate@example.invalid',
      });
    }
    let posts = 0;
    await assert.rejects(() => recordLegacySentOnce(f.adapter, f.key,
      async () => { posts++; throw new Error('must not post'); },
      {now: () => Date.parse('2026-11-23T12:00:00Z')}),
      error => error instanceof LegacyHold);
    assert.equal(posts, 0);
  }
});

test('ambiguous Sent attempt POST is terminal with no retry', async () => {
  const f = makeFixture();
  moveToSent(f);
  let posts = 0;
  await held(() => recordLegacySentOnce(f.adapter, f.key,
    async (_fields, _boundary, beforeFetch) => {
      posts++;
      beforeFetch();
      throw new Error('lost response');
    }, {now: () => Date.parse('2026-11-23T12:00:00Z')}),
  'LEGACY_SENT_ATTEMPT_OUTCOME_UNKNOWN');
  assert.equal(posts, 1);
});

test('a POST port that skips the action-time boundary cannot claim Sent', async () => {
  const f = makeFixture();
  moveToSent(f);
  await held(() => recordLegacySentOnce(f.adapter, f.key,
    async () => ({status: 201, data: {id: '43'}}),
    {now: () => Date.parse('2026-11-23T12:00:00Z')}),
  'LEGACY_SENT_ATTEMPT_OUTCOME_UNKNOWN');
});

test('Sent readback must be the exact newly created receipt item', async () => {
  const f = makeFixture();
  moveToSent(f);
  await held(() => recordLegacySentOnce(f.adapter, f.key,
    async (fields, _boundary, beforeFetch) => {
      beforeFetch();
      if (fields.Kind === 'SentAttempt') {
        saveAttempt(f, fields);
        return {status: 201, data: {id: '43'}};
      }
      saveSent(f, fields, '45');
      return {status: 201, data: {id: '44'}};
    }, {now: () => Date.parse('2026-11-23T12:00:00Z')}),
  'LEGACY_SENT_READBACK_UNCERTAIN');
});

test('production composition rejects an unsigned caller-supplied inventory loader', async () => {
  const f = makeFixture();
  const adapter = createSignedOwnerRoute({
    graph: f.graph, makeStore: f.adapter.makeStore,
    loadMigrationProof: f.adapter.loadMigrationProof,
    config: f.config, domParserClass: TestParser,
    now: () => Date.parse('2026-11-23T12:00:00Z'),
    loadLegacyFenceProof: async () => ({occupiedKeys: [f.key]}),
  });
  await held(() => adapter.reopen(f.key), 'LEGACY_FENCE_UNVERIFIED');
  assert.equal(f.calls.oldReads, 0);
});

function recoveryFor(f) {
  return new LegacyOwnerRecovery({adapter: f.adapter,
    now: () => Date.parse('2026-11-23T12:00:00Z')});
}

function leanFor(f, recovery) {
  const actions = new LeanGanttActions({config: {}, graph: f.graph,
    legacyOwnerRecovery: recovery});
  actions._context = async () => ({graph: f.graph, actor,
    store: {getState: async () => clone(f.state)}});
  return actions;
}

test('integrated customer owner preview and click reopen the same old draft', async () => {
  const f = makeFixture('customer-tracker');
  const actions = leanFor(f, recoveryFor(f));
  const formKey = f.key.slice('customer-tracker:'.length);
  assert.equal((await actions.preview('customer', formKey)).status,
    'draft_occupied');
  const result = await actions.customerDraft(formKey);
  assert.equal(result.status, 'legacy_draft_review_required');
  assert.equal(result.webLink, f.webLink);
  assert.equal(result.sendReady, false);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
});

test('integrated provider owner uses snapshot writer without a new draft', async () => {
  const f = makeFixture();
  const writer = new SnapshotProviderActionWriter({config: {},
    graph: f.graph, legacyOwnerRecovery: recoveryFor(f)});
  writer._context = async () => ({graph: f.graph, actor,
    store: {getState: async () => clone(f.state)}});
  assert.equal((await writer.observe(f.key, actor)).status,
    'draft_occupied');
  const result = await writer.resume(f.key, actor);
  assert.equal(result.status, 'legacy_draft_review_required');
  assert.equal(result.webLink, f.webLink);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
});

test('integrated nonowner receives occupied state without old row or mail read', async () => {
  const f = makeFixture('customer-tracker');
  f.graph.getMe = async () => ({id:
    '33333333-3333-4333-8333-333333333333',
  address: 'teammate@example.invalid'});
  const actions = leanFor(f, recoveryFor(f));
  const key = f.key.slice('customer-tracker:'.length);
  assert.equal((await actions.preview('customer', key)).status,
    'legacy_occupied');
  const result = await actions.customerDraft(key);
  assert.equal(result.status, 'legacy_occupied');
  assert.equal(result.webLink, null);
  assert.equal(f.calls.oldReads, 0);
  assert.ok(f.calls.requests.every(call =>
    !call.path.includes('/me/messages/')));
});

test('missing or changed immutable ID cannot create a replacement draft', async () => {
  const missing = makeFixture();
  const original = missing.graph.request.bind(missing.graph);
  missing.graph.request = async (path, options) => {
    if (path.includes('/me/messages/')) throw new GraphHttpError(404);
    return original(path, options);
  };
  const missingWriter = new SnapshotProviderActionWriter({config: {},
    graph: missing.graph, legacyOwnerRecovery: recoveryFor(missing)});
  missingWriter._context = async () => ({graph: missing.graph, actor,
    store: {getState: async () => clone(missing.state)}});
  assert.equal((await missingWriter.observe(missing.key, actor)).status,
    'legacy_occupied');
  assert.equal((await missingWriter.resume(missing.key, actor)).status,
    'unresolved');

  const changed = makeFixture('customer-tracker');
  changed.message.id = 'another-immutable-message';
  const actions = leanFor(changed, recoveryFor(changed));
  const key = changed.key.slice('customer-tracker:'.length);
  assert.equal((await actions.customerDraft(key)).status, 'unresolved');
  assert.ok(changed.calls.requests.every(call => call.method === 'GET'));
});

test('exact migrated Sent port POSTs only the selected Receipts List', async () => {
  const f = makeFixture();
  moveToSent(f);
  const plan = await f.adapter.prepareSentReceipt(f.key);
  const calls = [];
  const graph = {bindAccount() { return {
    async getMe() { return actor; },
    async request(path, options) {
      calls.push({path, options});
      options.beforeFetch();
      return {status: 201, data: {id: '43'}};
    },
  }; }};
  const receiptsListId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const post = createLegacySentGraphPort({graph,
    siteId: f.config.siteId, receiptsListId});
  let boundary = 0;
  const digest = await sentPlanDigest(plan.fields);
  const marker = {
    Title: `${f.key}|SentAttempt`, ReceiptKey: `${f.key}|SentAttempt`,
    DispatchKey: f.key, Kind: 'SentAttempt', ClaimItemId: plan.claimItemId,
    ActorOid: actor.id, DraftImmutableId: f.id,
    PlannedSentSha256: digest,
    RecordedAtUtc: '2026-11-23T12:00:00.000Z',
    MigratedFrom: plan.fields.MigratedFrom,
  };
  const markerResponse = await post(marker,
    {...plan, plannedSentFields: plan.fields}, () => { boundary++; });
  const sentResponse = await post(plan.fields,
    {...plan, attemptItemId: '43', attemptEtag: '"1"',
      plannedSentSha256: digest}, () => { boundary++; });
  assert.equal(markerResponse.status, 201);
  assert.equal(sentResponse.status, 201);
  assert.equal(boundary, 2);
  assert.equal(calls.length, 2);
  for (const [index, fields] of [marker, plan.fields].entries()) {
    assert.equal(calls[index].path,
      `/v1.0/sites/${encodeURIComponent(f.config.siteId)}` +
        `/lists/${receiptsListId}/items`);
    assert.equal(calls[index].options.method, 'POST');
    assert.deepEqual(calls[index].options.body, {fields});
    assert.equal(calls[index].path.includes('/me/messages'), false);
  }
});

test('repeated Check Sent after an uncertain final POST only inspects until the exact receipt appears', async () => {
  const f = makeFixture();
  moveToSent(f);
  let postAttempts = 0;
  let postedSentFields = null;
  const recovery = new LegacyOwnerRecovery({adapter: f.adapter,
    now: () => Date.parse('2026-11-23T12:00:00Z'),
    postSentReceipt: async (fields, _refs, beforeFetch) => {
      postAttempts++;
      beforeFetch();
      if (fields.Kind === 'SentAttempt') {
        saveAttempt(f, fields);
        return {status: 201, data: {id: '43'}};
      }
      postedSentFields = clone(fields);
      throw new Error('response lost after a possible List write');
    }});

  const first = await recovery.checkSent(f.key);
  assert.equal(first.status, 'unresolved');
  assert.equal(postAttempts, 2);
  const automaticCheck = await recovery.checkSent(f.key);
  const manualCheck = await recovery.checkSent(f.key);
  assert.equal(automaticCheck.status, 'unresolved');
  assert.equal(manualCheck.status, 'unresolved');
  assert.equal(manualCheck.reason, 'SENT_RECEIPT_RECONCILIATION_REQUIRED');
  assert.equal(postAttempts, 2);

  // The ambiguous final POST is later found as the one exact receipt. Every
  // subsequent check is a mailbox/List read, never a second write.
  saveSent(f, postedSentFields);
  const readback = await recovery.checkSent(f.key);
  assert.equal(readback.status, 'sent');
  assert.equal(readback.webLink, null);
  assert.equal(postAttempts, 2);
  assert.ok(f.calls.requests.every(call => call.method === 'GET'));
});

test('a reload with only the saved SentAttempt marker cannot post Sent again', async () => {
  const f = makeFixture();
  moveToSent(f);
  const plan = await f.adapter.prepareSentReceipt(f.key);
  saveAttempt(f, {
    Title: `${f.key}|SentAttempt`, ReceiptKey: `${f.key}|SentAttempt`,
    DispatchKey: f.key, Kind: 'SentAttempt', ClaimItemId: plan.claimItemId,
    ActorOid: actor.id, DraftImmutableId: f.id,
    PlannedSentSha256: await sentPlanDigest(plan.fields),
    RecordedAtUtc: '2026-11-23T12:00:00.000Z',
    MigratedFrom: plan.fields.MigratedFrom,
  });
  let writes = 0;
  const reloaded = new LegacyOwnerRecovery({adapter: f.adapter,
    now: () => Date.parse('2026-11-23T12:00:00Z'),
    postSentReceipt: async () => { writes++; throw new Error('must not POST'); }});
  const result = await reloaded.checkSent(f.key);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reason, 'SENT_RECEIPT_RECONCILIATION_REQUIRED');
  assert.equal(writes, 0);
  await held(() => f.adapter.prepareSentReceipt(f.key),
    'LEGACY_SENT_ATTEMPT_OCCUPIED');
});

test('a concurrent Check Sent cannot race a second legacy receipt POST', async () => {
  const f = makeFixture();
  moveToSent(f);
  let postAttempts = 0;
  let writeEntered;
  const entered = new Promise(resolve => { writeEntered = resolve; });
  let finishWrite;
  const pendingWrite = new Promise(resolve => { finishWrite = resolve; });
  const recovery = new LegacyOwnerRecovery({adapter: f.adapter,
    now: () => Date.parse('2026-11-23T12:00:00Z'),
    postSentReceipt: async (_fields, _refs, beforeFetch) => {
      postAttempts++;
      beforeFetch();
      writeEntered();
      await pendingWrite;
      throw new Error('uncertain first response');
    }});

  const first = recovery.checkSent(f.key);
  await entered;
  const overlapping = await recovery.checkSent(f.key);
  assert.equal(overlapping.status, 'unresolved');
  assert.equal(postAttempts, 1);
  finishWrite();
  assert.equal((await first).status, 'unresolved');
  assert.equal((await recovery.checkSent(f.key)).status, 'unresolved');
  assert.equal(postAttempts, 1);
});
