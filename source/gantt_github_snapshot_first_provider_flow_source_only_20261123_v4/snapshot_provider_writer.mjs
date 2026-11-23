/**
 * Held no-send Graph writer for the snapshot-first provider route. It shares
 * V2's physical Claim/Receipt Lists, immutable Outlook IDs, and six-link
 * readback, while accepting explicit Release-backed Claim provenance.
 */
import {anchorTargets} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/actions.mjs';
import {buildProviderDraft, canonicalSalesforceId, email,
  HeldActionError, PICOS_PARTS, providerDispatchKey,
  validatedOutlookLink} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {correlationIdOf, GraphHttpError, recipientsOf} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/graph.mjs';
import {buildSnapshotProviderContent} from './snapshot_first_provider_flow.mjs';
import {GANTT_RELEASE_KEY} from './release_reader.mjs';
import {SnapshotClaimReceiptStore, SNAPSHOT_CLAIM_MODE} from
  './snapshot_claim_store.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SITE_ID = /^[^,]+,[0-9a-f-]{36},[0-9a-f-]{36}$/iu;
const SHA = /^[0-9a-f]{64}$/u;
const PREINSTALL = new Set(['Pending Readiness', 'Pending Scheduled Date']);
const LINKS = Object.freeze(PICOS_PARTS.map(part => part.url));
const same = (a, b) => JSON.stringify([...a].sort()) ===
  JSON.stringify([...b].sort());

function fail(code) { throw new HeldActionError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value) {
  if (value === null || typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('SNAPSHOT_CLAIM_SOURCE_INVALID');
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('SNAPSHOT_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function actorOf(value) {
  if (!object(value) || !GUID.test(value.id ?? '') ||
      typeof value.address !== 'string') fail('COORDINATOR_IDENTITY_UNVERIFIED');
  let address;
  try { address = email(value.address); }
  catch { fail('COORDINATOR_IDENTITY_UNVERIFIED'); }
  if (address !== value.address) fail('COORDINATOR_IDENTITY_UNVERIFIED');
  return {id: value.id.toLowerCase(), address};
}
function exactWo(value) {
  const id = canonicalSalesforceId(value);
  if (!id.startsWith('0WO')) fail('NATIVE_WO_ID_INVALID');
  return id;
}
function idFromKey(dispatchKey) {
  if (typeof dispatchKey !== 'string' ||
      !dispatchKey.startsWith('provider-parts:')) fail('DISPATCH_KEY_INVALID');
  const id = exactWo(dispatchKey.slice('provider-parts:'.length));
  if (providerDispatchKey(id) !== dispatchKey) fail('DISPATCH_KEY_INVALID');
  return id;
}
function validTo(to) {
  if (!Array.isArray(to) || to.length > 2 ||
      to.some(address => typeof address !== 'string' ||
        email(address) !== address) || new Set(to).size !== to.length) {
    fail('PROVIDER_AUDIENCE_INVALID');
  }
  return to;
}
function assertConfig(config) {
  if (config?.enabled !== true || config?.providerSnapshotEnabled !== true ||
      config?.occupiedPilotClaimsMigrated !== true ||
      config?.emptyToDraftCanaryPassed !== true ||
      !SITE_ID.test(config.siteId ?? '') || !object(config.lists) ||
      !['ganttRelease', 'claims', 'receipts'].every(name =>
        GUID.test(config.lists[name] ?? '')) ||
      new Set(['ganttRelease', 'claims', 'receipts'].map(name =>
        config.lists[name].toLowerCase())).size !== 3 ||
      !Array.isArray(config.coordinatorOids) ||
      !config.coordinatorOids.length ||
      !config.coordinatorOids.every(value => GUID.test(value)) ||
      !Array.isArray(config.releaseOwnerOids) ||
      !config.releaseOwnerOids.length ||
      !config.releaseOwnerOids.every(value => GUID.test(value))) {
    fail('SNAPSHOT_WRITER_NOT_RELEASED');
  }
}
function receiptEvidence(state) {
  const f = state?.draft?.fields;
  if (!object(f)) fail('DRAFT_RECEIPT_MISSING');
  let to, links;
  try { to = JSON.parse(f.IntendedToJson); links = JSON.parse(f.RequiredLinksJson); }
  catch { fail('DRAFT_RECEIPT_INVALID'); }
  validTo(to);
  if (!Array.isArray(links) || JSON.stringify(links) !== JSON.stringify(LINKS) ||
      typeof f.IntendedSubject !== 'string' || !f.IntendedSubject ||
      !SHA.test(f.IntendedBodySha256 ?? '') ||
      typeof f.DraftImmutableId !== 'string' || !f.DraftImmutableId ||
      f.DraftWebLink != null && f.DraftWebLink !== '') {
    fail('DRAFT_RECEIPT_INVALID');
  }
  return {to, links, id: f.DraftImmutableId,
    subject: f.IntendedSubject, bodySha256: f.IntendedBodySha256};
}
function sourceForClaim(command) {
  if (!object(command) || typeof command.verifySourceAfterClaim !== 'function' ||
      !object(command.release) || !object(command.release.fields) ||
      !object(command.source) || !object(command.content) ||
      !/^[1-9][0-9]*$/u.test(String(command.release.id ?? '')) ||
      typeof command.release.etag !== 'string' || !command.release.etag ||
      !SHA.test(command.release.fields.DecryptedHtmlSha256 ?? '') ||
      !SHA.test(command.release.fields.EncryptedPayloadSha256 ?? '') ||
      !PREINSTALL.has(command.datedPhase) ||
      command.source.id !== command.nativeWoId ||
      command.source.sourceAsOfUtc !==
        command.release.fields.OverlayObservedAtUtc ||
      command.source.eligibility !== 'preinstall_snapshot_candidate' ||
      command.source.draftSuggestionAllowed !== true ||
      !['fountain', 'unknown'].includes(command.scopeClass) ||
      command.source.scopeClass !== command.scopeClass ||
      !['Installation', 'Relocation'].includes(command.source.visitKind) ||
      command.recipientSuggestion !== command.source.recipientSuggestion ||
      command.dispatchKey !== providerDispatchKey(command.nativeWoId)) {
    fail('SNAPSHOT_DRAFT_COMMAND_INVALID');
  }
  const to = validTo(command.source.to);
  if ((command.recipientSuggestion === 'none' && to.length !== 0) ||
      (command.recipientSuggestion === 'exact_saved_file_pair' &&
        ![1, 2].includes(to.length))) {
    fail('SNAPSHOT_DRAFT_COMMAND_INVALID');
  }
  const expected = buildSnapshotProviderContent(command.source, {to});
  if (command.content.subject !== expected.subject ||
      command.content.htmlBody !== expected.htmlBody ||
      JSON.stringify(command.content.to) !== JSON.stringify(expected.to) ||
      JSON.stringify(command.content.requiredLinks) !==
        JSON.stringify(expected.requiredLinks)) {
    fail('SNAPSHOT_DRAFT_CONTENT_INVALID');
  }
  const evidence = {
    mode: SNAPSHOT_CLAIM_MODE,
    release: {itemId: String(command.release.id), etag: command.release.etag,
      htmlSha256: command.release.fields.DecryptedHtmlSha256,
      ciphertextSha256: command.release.fields.EncryptedPayloadSha256},
    snapshot: {nativeWoId: command.nativeWoId,
      sourceAsOfUtc: command.source.sourceAsOfUtc,
      datedPhase: command.datedPhase,
      woNumber: command.source.woNumber,
      agentCode: command.source.agentCode,
      visitKind: command.source.visitKind,
      scopeClass: command.scopeClass,
      recipientSuggestion: command.recipientSuggestion,
      suggestedTo: [...to], thirstyUrl: command.source.thirstyUrl},
  };
  return {nativeWoId: command.nativeWoId,
    etagsJson: canonical(evidence)};
}
function actualLinks(message, ParserCtor) {
  const links = anchorTargets(message, ParserCtor);
  if (links.size !== LINKS.length || !LINKS.every(url => links.has(url))) {
    fail('DRAFT_LINKS_UNVERIFIED');
  }
  return links;
}

export class SnapshotProviderActionWriter {
  constructor({config, graph, now = () => Date.now(),
      randomUUID = () => globalThis.crypto.randomUUID(),
      domParserClass = globalThis.DOMParser} = {}) {
    if (typeof graph?.bindAccount !== 'function' ||
        typeof randomUUID !== 'function' || typeof now !== 'function') {
      throw new TypeError('Bound delegated Graph writer is required');
    }
    this.config = config;
    this.graph = graph;
    this.now = now;
    this.randomUUID = randomUUID;
    this.domParserClass = domParserClass;
  }

  async _context(requestedActor) {
    assertConfig(this.config);
    const graph = this.graph.bindAccount();
    const actor = actorOf(await graph.getMe());
    const wanted = actorOf(requestedActor);
    if (actor.id !== wanted.id || actor.address !== wanted.address ||
        !this.config.coordinatorOids.some(id =>
          id.toLowerCase() === actor.id)) {
      fail('COORDINATOR_NOT_ASSIGNED');
    }
    const store = new SnapshotClaimReceiptStore({graph,
      config: this.config, now: this.now});
    await store.assertSchema();
    return {graph, actor, store};
  }

  async _sameActor(context) {
    const latest = actorOf(await context.graph.getMe());
    if (latest.id !== context.actor.id ||
        latest.address !== context.actor.address) fail('MAILBOX_SWITCHED');
  }

  async observe(dispatchKey, actor) {
    idFromKey(dispatchKey);
    const context = await this._context(actor);
    const state = await context.store.getState(dispatchKey);
    if (!state) return {status: 'absent', dispatchKey};
    if (state.sent) return {status: 'sent_recorded_unverified', dispatchKey};
    if (state.claim.fields.MigratedFrom) return {status: 'legacy_occupied', dispatchKey};
    if (state.claim.fields.ActorOid.toLowerCase() !== context.actor.id ||
        state.claim.fields.ActorEmail !== context.actor.address) {
      return {status: 'draft_status_unverified', dispatchKey};
    }
    return {status: state.draft ? 'draft_occupied' :
      'claim_outcome_unverified', dispatchKey};
  }

  async _existing(state, context) {
    const dispatchKey = state.claim.fields.DispatchKey;
    if (state.sent) {
      if (state.claim.fields.MigratedFrom ||
          state.claim.fields.ActorOid.toLowerCase() !== context.actor.id ||
          state.claim.fields.ActorEmail !== context.actor.address) {
        return {status: 'sent_recorded_unverified', dispatchKey};
      }
      return this._checkState(state, context);
    }
    if (state.claim.fields.MigratedFrom) {
      return {status: 'legacy_occupied', dispatchKey};
    }
    if (state.claim.fields.ActorOid.toLowerCase() !== context.actor.id ||
        state.claim.fields.ActorEmail !== context.actor.address) {
      return {status: 'draft_status_unverified', dispatchKey};
    }
    if (!state.draft) return {status: 'claim_outcome_unverified', dispatchKey};
    return this._checkState(state, context);
  }

  async resume(dispatchKey, actor) {
    idFromKey(dispatchKey);
    const context = await this._context(actor);
    const state = await context.store.getState(dispatchKey);
    return state ? this._existing(state, context) :
      {status: 'not_started', dispatchKey};
  }

  async createFirstDraft(command) {
    const id = exactWo(command?.nativeWoId);
    if (command?.dispatchKey !== providerDispatchKey(id)) {
      fail('SNAPSHOT_DRAFT_COMMAND_INVALID');
    }
    const context = await this._context(command.actor);
    if (!object(command.release) || !object(command.release.fields) ||
        command.release.siteId !== this.config.siteId ||
        String(command.release.listId).toLowerCase() !==
          this.config.lists.ganttRelease.toLowerCase() ||
        command.release.fields.ReleaseKey !== GANTT_RELEASE_KEY ||
        command.release.fields.ReleaseState !== 'Approved' ||
        command.release.modifiedBy !==
          String(command.release.fields.ApprovedByOid ?? '').toLowerCase() ||
        !this.config.releaseOwnerOids.some(id => id.toLowerCase() ===
          command.release.modifiedBy) ||
        !Number.isFinite(Date.parse(command.release.fields.ValidUntilUtc ?? '')) ||
        this.now() >= Date.parse(command.release.fields.ValidUntilUtc)) {
      fail('SNAPSHOT_RELEASE_LIST_MISMATCH');
    }
    const before = await context.store.getState(command.dispatchKey);
    if (before) {
      // A different coordinator may have claimed the key after the caller's
      // last observe. No new Claim or draft belongs to this attempt.
      const existing = await this._existing(before, context);
      return Object.freeze({...existing, reusedExistingClaim: true});
    }
    const source = sourceForClaim(command);
    source.digest = await sha256(source.etagsJson);
    const attemptId = this.randomUUID();
    const correlationId = this.randomUUID();
    if (!GUID.test(attemptId) || !GUID.test(correlationId) ||
        attemptId === correlationId) fail('SNAPSHOT_ATTEMPT_ID_INVALID');
    const claim = await context.store.createClaim(command.dispatchKey,
      context.actor, source, attemptId, correlationId);
    // The flow's callback rereads the protected Release, served ciphertext,
    // decrypted HTML, actor, and exact selection after the physical Claim.
    const post = await command.verifySourceAfterClaim();
    if (!object(post) || String(post.releaseItemId) !==
        String(command.release.id) || post.releaseETag !== command.release.etag ||
        post.decryptedHtmlSha256 !==
          command.release.fields.DecryptedHtmlSha256 ||
        !Number.isFinite(Date.parse(post.validUntilUtc ?? '')) ||
        this.now() >= Date.parse(post.validUntilUtc)) {
      fail('SNAPSHOT_SOURCE_CHANGED_AFTER_CLAIM');
    }
    await this._sameActor(context);
    let created;
    try {
      created = await context.graph.createDraft(command.content, correlationId,
        () => {
          if (this.now() >= Date.parse(post.validUntilUtc)) {
            fail('SNAPSHOT_SOURCE_EXPIRED_BEFORE_DRAFT');
          }
        });
    } catch (error) {
      if (error?.code === 'SNAPSHOT_SOURCE_EXPIRED_BEFORE_DRAFT') throw error;
      fail('DRAFT_OUTCOME_UNKNOWN');
    }
    const message = await context.graph.getMessage(created.id);
    const draftsFolderId = await context.graph.getFolderId('drafts');
    const inspected = await this._verifyNewDraft(message, created.id,
      command.content, claim, draftsFolderId);
    const state = await context.store.appendDraft(claim, context.actor,
      {...command.content, id: created.id}, message);
    if (!state.draft || state.sent) fail('DRAFT_RECEIPT_READBACK_MISMATCH');
    return {status: inspected.recipientReviewRequired ?
      'recipient_review_required' : 'draft',
      dispatchKey: command.dispatchKey, webLink: inspected.webLink,
      immutableId: created.id,
      recipientReviewRequired: inspected.recipientReviewRequired,
      contentReviewRequired: false, reviewReason: ''};
  }

  async _verifyNewDraft(message, id, content, claim, draftsFolderId) {
    const to = recipientsOf(message);
    const cc = recipientsOf(message, 'ccRecipients');
    const bcc = recipientsOf(message, 'bccRecipients');
    const links = actualLinks(message, this.domParserClass);
    const webLink = validatedOutlookLink(message?.webLink);
    if (message?.id !== id || message.isDraft !== true ||
        message.parentFolderId !== draftsFolderId ||
        correlationIdOf(message) !== claim.fields.CorrelationId ||
        message.subject !== content.subject ||
        String(message.body?.content ?? '') !== content.htmlBody) {
      fail('DRAFT_READBACK_MISMATCH');
    }
    if (links.size !== content.requiredLinks.length ||
        !content.requiredLinks.every(url => links.has(url))) {
      fail('DRAFT_READBACK_MISMATCH');
    }
    return {webLink, recipientReviewRequired: content.to.length === 0 ||
      !same(to, content.to) || cc.length > 0 || bcc.length > 0};
  }

  async checkSent(dispatchKey, actor) {
    idFromKey(dispatchKey);
    const context = await this._context(actor);
    const state = await context.store.getState(dispatchKey);
    return state ? this._existing(state, context) :
      {status: 'not_started', dispatchKey};
  }

  async _checkState(state, context) {
    const evidence = receiptEvidence(state);
    await this._sameActor(context);
    let message;
    let recoveredId = null;
    try { message = await context.graph.getMessage(evidence.id); }
    catch (error) {
      if (error instanceof GraphHttpError && error.status === 404) {
        try {
          // A stored Sent ID is only a hint. The owner's mailbox and exact
          // correlation checks below still decide whether it was sent.
          recoveredId = state.sent &&
            state.sent.fields.SentImmutableId !== evidence.id ?
            state.sent.fields.SentImmutableId :
            await context.graph.findSentByCorrelation(
              state.claim.fields.CorrelationId, state.claim.fields.ClaimedAtUtc);
          if (!recoveredId) {
            return {status: 'unresolved', reason: 'SENT_ITEM_NOT_VERIFIED'};
          }
          message = await context.graph.getMessage(recoveredId);
        } catch {
          return {status: 'unresolved', reason: 'SENT_SCAN_UNVERIFIED'};
        }
      } else {
        fail('MAILBOX_READ_UNCERTAIN');
      }
    }
    if (message?.id !== (recoveredId ?? evidence.id) ||
        correlationIdOf(message) !== state.claim.fields.CorrelationId) {
      fail('MAILBOX_CORRELATION_MISMATCH');
    }
    if (recoveredId && message.isDraft !== false) {
      fail('SENT_SCAN_NOT_SENT');
    }
    const key = state.claim.fields.DispatchKey;
    if (message.isDraft === true) {
      const draftsId = await context.graph.getFolderId('drafts');
      if (message.parentFolderId !== draftsId) fail('DRAFT_IDENTITY_MISMATCH');
      if (state.sent) fail('DRAFT_AND_SENT_CONFLICT');
      const webLink = validatedOutlookLink(message.webLink);
      const reasons = [];
      let recipientReviewRequired = evidence.to.length === 0;
      try {
        const to = recipientsOf(message);
        const cc = recipientsOf(message, 'ccRecipients');
        const bcc = recipientsOf(message, 'bccRecipients');
        if (!same(to, evidence.to) || cc.length || bcc.length) {
          reasons.push('Recipients changed in Outlook');
          recipientReviewRequired = true;
        }
      } catch {
        reasons.push('Recipients need review');
        recipientReviewRequired = true;
      }
      if (message.subject !== evidence.subject) reasons.push('Subject changed in Outlook');
      const bodySha = await sha256(String(message.body?.content ?? ''));
      if (bodySha !== evidence.bodySha256) reasons.push('Body changed in Outlook');
      try { actualLinks(message, this.domParserClass); }
      catch { reasons.push('Required links need review'); }
      const contentReviewRequired = reasons.some(value =>
        !value.startsWith('Recipients'));
      return {status: recipientReviewRequired ? 'recipient_review_required' :
        contentReviewRequired ? 'draft_review_required' : 'draft',
      dispatchKey: key, webLink, immutableId: evidence.id,
      recipientReviewRequired, contentReviewRequired,
      reviewReason: reasons.join('; ')};
    }
    if (message.isDraft !== false) fail('MAILBOX_STATE_UNKNOWN');
    const sentFolderId = await context.graph.getFolderId('sentitems');
    if (message.parentFolderId !== sentFolderId ||
        !Number.isFinite(Date.parse(message.sentDateTime ?? '')) ||
        typeof message.internetMessageId !== 'string' ||
        !message.internetMessageId) fail('SENT_NOT_CONFIRMED');
    const to = recipientsOf(message);
    const cc = recipientsOf(message, 'ccRecipients');
    const bcc = recipientsOf(message, 'bccRecipients');
    if (!to.length && !cc.length && !bcc.length) fail('SENT_RECIPIENTS_MISSING');
    const differences = [];
    if (!same(to, evidence.to) || cc.length || bcc.length) {
      differences.push('Recipients changed in Outlook');
    }
    if (message.subject !== evidence.subject) differences.push('Subject changed in Outlook');
    const rawBody = String(message.body?.content ?? '');
    const bodySha256 = await sha256(rawBody);
    if (bodySha256 !== evidence.bodySha256) differences.push('Body changed in Outlook');
    let linksSha256;
    try {
      const links = anchorTargets(message, this.domParserClass);
      linksSha256 = await sha256(JSON.stringify([...links].sort()));
      if (links.size !== LINKS.length || !LINKS.every(url => links.has(url))) {
        differences.push('Required links changed in Outlook');
      }
    } catch {
      linksSha256 = await sha256(`UNVERIFIED:${rawBody}`);
      differences.push('Required links could not be verified');
    }
    const actual = {id: message.id, to, cc, bcc,
      sentAtUtc: new Date(message.sentDateTime).toISOString(),
      internetMessageId: message.internetMessageId,
      subject: message.subject, bodySha256, linksSha256,
      reviewReason: differences.join('; ')};
    if (state.sent) {
      const f = state.sent.fields;
      if (f.SentImmutableId !== actual.id ||
          f.SentAtUtc !== actual.sentAtUtc ||
          f.SentInternetMessageId !== actual.internetMessageId ||
          f.ActualSubject !== `sha256:${await sha256(actual.subject)}` ||
          f.ActualBodySha256 !== actual.bodySha256 ||
          f.ActualLinksSha256 !== actual.linksSha256 ||
          f.ActualToJson !== JSON.stringify(actual.to) ||
          f.ActualCcJson !== JSON.stringify(actual.cc) ||
          f.ActualBccJson !== JSON.stringify(actual.bcc) ||
          f.ReviewReason !== (actual.reviewReason ? 'SENT_DETAILS_CHANGED' : '')) {
        fail('SENT_RECEIPT_CONFLICT');
      }
    } else {
      await context.store.appendSent(state, context.actor, actual);
    }
    return {status: differences.length ? 'sent_with_changes' : 'sent',
      dispatchKey: key, sentAtUtc: actual.sentAtUtc};
  }
}
