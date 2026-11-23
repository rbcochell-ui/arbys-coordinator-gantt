import {assertActiveConfig, buildCustomerDraft, buildProviderDraft,
  canonicalFormSourceKey, canonicalSalesforceId, customerDispatchKey,
  email, HeldActionError, PICOS_PARTS, providerDispatchKey,
  validatedCustomerTrackerUrl, validatedOutlookLink} from './contract.mjs';
import {ClaimReceiptStore} from './claim_receipt_store.mjs';
import {correlationIdOf, GraphHttpError, recipientsOf} from './graph.mjs';
import {CustomerReleaseResolver} from './customer_source.mjs';
import {ProviderSourceResolver} from './provider_source.mjs';

function fail(code) { throw new HeldActionError(code); }
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const SHA_MARKER = /^sha256:([0-9a-f]{64})$/;
const sharedSentReview = value => value ? 'SENT_DETAILS_CHANGED' : '';
const safeSourceErrorCode = error => error instanceof HeldActionError &&
  /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code ?? '') ?
    error.code : 'READ_UNCERTAIN';
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('ACTION_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Customer receipt rows are visible to the coordinator team. They hold only a
// digest of the bearer tracker URL; the owner verifies the actual Graph anchor.
async function requiredLinksMatch(links, evidence) {
  if (evidence.customerLinkSha256) {
    if (links.size !== 1) return false;
    const [link] = links;
    try { validatedCustomerTrackerUrl(link); }
    catch { return false; }
    return await sha256(link) === evidence.customerLinkSha256;
  }
  return links.size === evidence.requiredLinks.length &&
    evidence.requiredLinks.every(url => links.has(url));
}

// DOMParser silently drops duplicate attributes. Reject ambiguous raw tags and
// comments before trusting Outlook's parsed anchor targets. Based on the
// independently reviewed v11 customer readback scanner.
function hasUnsafeRawTagAttributes(html) {
  const white = char => char === ' ' || char === '\t' || char === '\r' ||
    char === '\n' || char === '\f';
  const letter = char => char !== undefined && /[A-Za-z]/.test(char);
  const tagPart = char => char !== undefined && /[A-Za-z0-9:-]/.test(char);
  const attrPart = char => char !== undefined && /[A-Za-z0-9_-]/.test(char);
  const allowedTags = new Set(['html', 'head', 'meta', 'body', 'p', 'a', 'ul',
    'li', 'strong', 'b', 'em', 'i', 'div', 'span', 'br', 'font']);
  const allowedAttrs = tag => tag === 'a' ? new Set(['href', 'target', 'rel']) :
    tag === 'meta' ? new Set(['charset', 'http-equiv', 'content']) :
    tag === 'html' ? new Set(['lang']) : new Set(['dir', 'lang']);
  let i = 0;
  while (i < html.length) {
    if (html[i++] !== '<') continue;
    if (html[i] === '!') {
      const declaration = /^!doctype[ \t\r\n\f]+html[ \t\r\n\f]*>/i.exec(html.slice(i));
      if (!declaration) return true;
      i += declaration[0].length;
      continue;
    }
    const closing = html[i] === '/';
    if (closing) i++;
    if (!letter(html[i])) return true;
    const tagStart = i;
    i++;
    while (tagPart(html[i])) i++;
    const tag = html.slice(tagStart, i).toLowerCase();
    if (!allowedTags.has(tag)) return true;
    if (closing) {
      while (white(html[i])) i++;
      if (html[i++] !== '>') return true;
      continue;
    }
    const names = new Set();
    for (;;) {
      while (white(html[i])) i++;
      if (html[i] === '>') { i++; break; }
      if (html[i] === '/' && html[i + 1] === '>') { i += 2; break; }
      if (!letter(html[i])) return true;
      const start = i++;
      while (attrPart(html[i])) i++;
      const name = html.slice(start, i).toLowerCase();
      if (names.has(name) || !allowedAttrs(tag).has(name)) return true;
      names.add(name);
      while (white(html[i])) i++;
      if (html[i] !== '=') return true;
      i++;
      while (white(html[i])) i++;
      let value;
      if (html[i] === '"' || html[i] === "'") {
        const quote = html[i++];
        const valueStart = i;
        while (i < html.length && html[i] !== quote) {
          if (html[i++] === '<') return true;
        }
        if (html[i++] !== quote) return true;
        value = html.slice(valueStart, i - 1);
      } else {
        const startValue = i;
        while (i < html.length && !white(html[i]) && html[i] !== '>') {
          if (/[<'"`=]/.test(html[i++])) return true;
        }
        if (i === startValue) return true;
        value = html.slice(startValue, i);
      }
      if ((name === 'target' && value !== '_blank') ||
          (name === 'rel' && !/^(?:noopener|noreferrer)(?: (?:noopener|noreferrer))?$/.test(value)) ||
          (name === 'dir' && value.toLowerCase() !== 'ltr') ||
          (name === 'lang' && !/^en(?:-[a-z0-9]+)*$/i.test(value)) ||
          (name === 'http-equiv' && value.toLowerCase() !== 'content-type') ||
          (name === 'charset' && !/^[a-z0-9_-]+$/i.test(value)) ||
          (name === 'content' &&
            !/^text\/html(?:;\s*charset=[a-z0-9_-]+)?$/i.test(value))) return true;
    }
    if (tag === 'a' && !names.has('href')) return true;
  }
  return false;
}

/** Browser HTML parsing; all six approved myCoke targets must remain clickable. */
export function anchorTargets(message, ParserCtor = globalThis.DOMParser) {
  if (String(message?.body?.contentType ?? '').toLowerCase() !== 'html' ||
      typeof ParserCtor !== 'function') fail('DRAFT_HTML_UNVERIFIED');
  const html = String(message.body.content ?? '');
  if (html.includes('<!--') || hasUnsafeRawTagAttributes(html)) {
    fail('DRAFT_HTML_UNVERIFIED');
  }
  let doc;
  try { doc = new ParserCtor().parseFromString(html, 'text/html'); }
  catch { fail('DRAFT_HTML_UNVERIFIED'); }
  if (typeof doc?.querySelectorAll !== 'function') fail('DRAFT_HTML_UNVERIFIED');
  const urls = new Set();
  let count = 0;
  for (const anchor of doc.querySelectorAll('a[href]')) {
    count++;
    const raw = anchor.getAttribute('href');
    let url;
    try { url = new URL(raw); } catch { fail('DRAFT_HTML_UNVERIFIED'); }
    if (url.protocol !== 'https:' || raw !== url.href) fail('DRAFT_HTML_UNVERIFIED');
    urls.add(url.href);
  }
  if (count !== urls.size) fail('DRAFT_HTML_UNVERIFIED');
  return urls;
}

function intendedFromReceipt(receipt, actionKind) {
  let to, links;
  try {
    to = JSON.parse(receipt.fields.IntendedToJson);
    links = JSON.parse(receipt.fields.RequiredLinksJson);
  } catch { fail('DRAFT_RECEIPT_INVALID'); }
  const provider = actionKind === 'provider-parts';
  const customer = actionKind === 'customer-tracker';
  if ((!provider && !customer) || !Array.isArray(to) ||
      (provider && ![0, 2].includes(to.length)) ||
      (customer && to.length !== 1) ||
      to.some(value => typeof value !== 'string' || email(value) !== value) ||
      (to.length === 2 && to[0] === to[1]) || !Array.isArray(links) ||
      (provider && (links.length !== PICOS_PARTS.length ||
        !same(links, PICOS_PARTS.map(part => part.url)))) ||
      (customer && (links.length !== 1 ||
        !SHA_MARKER.test(links[0] ?? ''))) ||
      !/^[0-9a-f]{64}$/.test(receipt.fields.IntendedBodySha256 ?? '')) {
    fail('DRAFT_RECEIPT_INVALID');
  }
  return {subject: receipt.fields.IntendedSubject, to,
    requiredLinks: provider ? links : [],
    customerLinkSha256: customer ? SHA_MARKER.exec(links[0])[1] : null,
    id: receipt.fields.DraftImmutableId,
    bodySha256: receipt.fields.IntendedBodySha256,
    webLink: null};
}

async function verifyDraftMessage(message, evidence, claim, draftsFolderId, ParserCtor) {
  const to = recipientsOf(message);
  const cc = recipientsOf(message, 'ccRecipients');
  const bcc = recipientsOf(message, 'bccRecipients');
  const links = anchorTargets(message, ParserCtor);
  const bodySha256 = await sha256(String(message.body?.content ?? ''));
  const webLink = validatedOutlookLink(message.webLink);
  if (message.id !== evidence.id || message.isDraft !== true ||
      message.parentFolderId !== draftsFolderId ||
      correlationIdOf(message) !== claim.fields.CorrelationId ||
      message.subject !== evidence.subject ||
       !(await requiredLinksMatch(links, evidence)) ||
      (evidence.htmlBody !== undefined &&
        String(message.body?.content ?? '') !== evidence.htmlBody) ||
      (evidence.webLink && webLink !== evidence.webLink)) {
    fail('DRAFT_READBACK_MISMATCH');
  }
  return {webLink, recipientReviewRequired:
    (claim.fields.ActionKind === 'provider-parts' && evidence.to.length === 0) ||
    to.length !== evidence.to.length || !same(to, evidence.to) ||
    cc.length > 0 || bcc.length > 0,
    contentReviewRequired: evidence.bodySha256 !== undefined &&
      bodySha256 !== evidence.bodySha256};
}

// Existing drafts stay reachable after source or human edits. These checks
// prove the same owner-mailbox draft, then surface edits for coordinator review.
// The first draft's readback above remains strict before a Draft receipt exists.
async function inspectExistingDraft(message, evidence, claim, draftsFolderId,
    ParserCtor) {
  const webLink = validatedOutlookLink(message?.webLink);
  if (message?.id !== evidence.id || message.isDraft !== true ||
      message.parentFolderId !== draftsFolderId ||
      correlationIdOf(message) !== claim.fields.CorrelationId) {
    fail('DRAFT_IDENTITY_MISMATCH');
  }
  const reasons = [];
  let recipientReviewRequired = claim.fields.ActionKind === 'provider-parts' &&
    evidence.to.length === 0;
  try {
    const to = recipientsOf(message);
    const cc = recipientsOf(message, 'ccRecipients');
    const bcc = recipientsOf(message, 'bccRecipients');
    if (!same(to, evidence.to) || cc.length || bcc.length) {
      recipientReviewRequired = true;
      reasons.push('Recipients changed in Outlook');
    }
  } catch {
    recipientReviewRequired = true;
    reasons.push('Recipients need review');
  }
  if (message.subject !== evidence.subject) reasons.push('Subject changed in Outlook');
  const bodySha256 = await sha256(String(message.body?.content ?? ''));
  if (bodySha256 !== evidence.bodySha256) reasons.push('Body changed in Outlook');
  try {
    const links = anchorTargets(message, ParserCtor);
    if (!(await requiredLinksMatch(links, evidence))) {
      reasons.push('Required links changed in Outlook');
    }
  } catch { reasons.push('Required links need review'); }
  return {webLink, recipientReviewRequired, contentReviewRequired:
    reasons.some(reason => !reason.startsWith('Recipients')),
    reviewReason: reasons.join('; ')};
}

export class LeanGanttActions {
  constructor({config, graph, now = () => Date.now(),
      randomUUID = () => globalThis.crypto.randomUUID(),
      domParserClass = globalThis.DOMParser}) {
    if (typeof graph?.bindAccount !== 'function' ||
        typeof randomUUID !== 'function') throw new TypeError('Bound delegated Graph is required');
    this.config = config;
    this.graph = graph;
    this.now = now;
    this.randomUUID = randomUUID;
    this.domParserClass = domParserClass;
  }

  async _context(action = 'provider') {
    assertActiveConfig(this.config, action);
    const graph = this.graph.bindAccount();
    const actor = await graph.getMe();
    if (!this.config.coordinatorOids.some(id => id.toLowerCase() === actor.id)) {
      fail('COORDINATOR_NOT_ASSIGNED');
    }
    const store = new ClaimReceiptStore({graph, config: this.config, now: this.now});
    const source = action === 'provider' ?
      new ProviderSourceResolver({graph, config: this.config, now: this.now}) :
      new CustomerReleaseResolver({graph, config: this.config, now: this.now});
    await store.assertSchema();
    return {graph, actor, store, source};
  }

  async _sameActor(context) {
    const latest = await context.graph.getMe();
    if (latest.id !== context.actor.id || latest.address !== context.actor.address) {
      fail('MAILBOX_SWITCHED');
    }
  }

  async _existingAction(state, context) {
    // A shared row occupies the key but cannot itself prove a mailbox send.
    // Only the claim owner can verify the original message through /me.
    if (state.sent) {
      if (state.claim.fields.MigratedFrom ||
          state.claim.fields.ActorOid.toLowerCase() !== context.actor.id ||
          state.claim.fields.ActorEmail !== context.actor.address) {
        return {status: 'sent_recorded_unverified',
          dispatchKey: state.claim.fields.DispatchKey};
      }
      return this._checkState(state, context);
    }
    if (state.claim.fields.ActorOid.toLowerCase() !== context.actor.id ||
        state.claim.fields.ActorEmail !== context.actor.address) {
      return {status: 'draft_status_unverified',
        dispatchKey: state.claim.fields.DispatchKey,
        owner: state.claim.fields.ActorEmail};
    }
    // Historical pilot drafts lack this runtime's opaque header.
    // Their one-time imported Claims occupy the key, but this route never
    // guesses a new correlation or creates a replacement draft.
    if (state.claim.fields.MigratedFrom) {
      return {status: 'legacy_occupied', reason: 'OWNER_RECONCILIATION_REQUIRED'};
    }
    if (!state.draft) fail('CLAIM_OCCUPIED_WITHOUT_DRAFT_RECEIPT');
    return this._checkState(state, context);
  }

  /** Read-only click-time preview. Draft methods reread everything afterward. */
  async preview(kind, entityId) {
    if (kind !== 'provider' && kind !== 'customer') fail('ACTION_KIND_INVALID');
    const id = kind === 'provider' ? canonicalSalesforceId(entityId) :
      canonicalFormSourceKey(entityId);
    const dispatchKey = kind === 'provider' ? providerDispatchKey(id) :
      customerDispatchKey(id);
    const context = await this._context(kind);
    const state = await context.store.getState(dispatchKey);
    if (state) {
      const status = state.sent ? 'sent_recorded_unverified' :
        state.claim.fields.MigratedFrom ?
        'legacy_occupied' : state.claim.fields.ActorOid.toLowerCase() !==
        context.actor.id ? 'draft_status_unverified' : state.draft ?
          'draft_occupied' : 'claim_outcome_unverified';
      return {kind, id, dispatchKey, status,
        to: [], cc: [], recipientReviewRequired: false,
        webLink: null, reviewReason: sharedSentReview(
          state.sent?.fields.ReviewReason)};
    }
    const source = await context.source.resolve(id, context.actor);
    const draft = kind === 'provider' ? buildProviderDraft(source) :
      buildCustomerDraft(source);
    return {kind, id, dispatchKey, status: 'eligible',
      storeNumber: kind === 'provider' ? source.storeNumber : null,
      woNumber: kind === 'provider' ? source.woNumber : null,
      agentCode: kind === 'provider' ? source.agentCode : null,
      thirstyOwner: kind === 'provider' ? source.thirstyOwner : null,
      to: [...draft.to], cc: [],
      recipientReviewRequired: kind === 'provider' && draft.to.length === 0,
      validUntilUtc: new Date(source.validUntilMs).toISOString()};
  }

  async providerDraft(nativeWoId) {
    const id = canonicalSalesforceId(nativeWoId);
    const key = providerDispatchKey(id);
    const context = await this._context('provider');
    const existing = await context.store.getState(key);
    if (existing) return this._existingAction(existing, context);

    const source = await context.source.resolve(id, context.actor);
    const content = buildProviderDraft(source);
    const attemptId = this.randomUUID();
    const correlationId = this.randomUUID();
    const claim = await context.store.createClaim(key, context.actor, source,
      attemptId, correlationId);

    // Both protected rows are reread after the physical Claim exists. An
    // uncertain result leaves that Claim occupied and cannot mint a new draft.
    const current = await context.source.confirmUnchanged(source, context.actor);
    await this._sameActor(context);
    let created;
    try {
      created = await context.graph.createDraft(content, correlationId, () => {
        if (this.now() >= Math.min(source.validUntilMs, current.validUntilMs)) {
          fail('SOURCE_WINDOW_EXPIRED_BEFORE_DRAFT');
        }
      });
    } catch (error) {
      if (error?.code === 'SOURCE_WINDOW_EXPIRED_BEFORE_DRAFT') throw error;
      fail('DRAFT_OUTCOME_UNKNOWN');
    }
    const evidence = {...content, id: created.id, webLink: null};
    const message = await context.graph.getMessage(created.id);
    const draftsId = await context.graph.getFolderId('drafts');
    const inspected = await verifyDraftMessage(message, evidence, claim,
      draftsId, this.domParserClass);
    const state = await context.store.appendDraft(claim, context.actor,
      {...content, id: created.id}, message);
    if (!state.draft || state.sent) fail('DRAFT_RECEIPT_READBACK_MISMATCH');
    return {status: inspected.recipientReviewRequired ?
      'recipient_review_required' : 'draft',
      dispatchKey: key, webLink: inspected.webLink,
      immutableId: created.id, recipientReviewRequired: inspected.recipientReviewRequired,
      contentReviewRequired: false, reviewReason: ''};
  }

  /** Manual Check Sent and return/focus share this attended observation. */
  async checkSent(nativeWoId) {
    const id = canonicalSalesforceId(nativeWoId);
    const context = await this._context('provider');
    const state = await context.store.getState(providerDispatchKey(id));
    if (!state) return {status: 'not_started'};
    return this._existingAction(state, context);
  }

  async _checkState(state, context) {
    const actionKind = state.claim.fields.ActionKind;
    const evidence = intendedFromReceipt(state.draft, actionKind);
    await this._sameActor(context);
    let message;
    let recoveredId = null;
    try { message = await context.graph.getMessage(evidence.id); }
    catch (error) {
      if (error instanceof GraphHttpError && error.status === 404) {
        try {
          // A previously recorded Sent ID is only a read hint. Mailbox and
          // correlation checks below still decide whether it is trustworthy.
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
    if (message.isDraft === true) {
      let sourceReviewReason = '';
      if (actionKind === 'provider-parts') {
        try {
          const current = await context.source.resolve(state.claim.fields.EntityId,
            context.actor);
          if (current.digest !== state.claim.fields.SourceDigest ||
              current.etagsJson !== state.claim.fields.SourceETagsJson) {
            sourceReviewReason = 'WO or contact changed after draft';
          }
        } catch (error) {
          sourceReviewReason =
            `WO or contact needs review: ${safeSourceErrorCode(error)}`;
        }
      } else {
        // A daily customer release may refresh its ETag without changing the
        // approved recipient or stable bearer URL. Both must still be current.
        try {
          const current = await context.source.resolve(state.claim.fields.EntityId,
            context.actor, {allowOccupied: true});
          if (current.recipientEmail !== evidence.to[0] ||
              await sha256(current.trackerUrl) !== evidence.customerLinkSha256 ||
              (current.legacyDraftMessageId &&
                current.legacyDraftMessageId !== evidence.id) ||
              (current.legacyDraftWebLink &&
                validatedOutlookLink(current.legacyDraftWebLink) !==
                  validatedOutlookLink(message.webLink))) {
            sourceReviewReason = 'Customer release changed after draft';
          }
        } catch (error) {
          sourceReviewReason =
            `Customer release needs review: ${safeSourceErrorCode(error)}`;
        }
      }
      const draftsId = await context.graph.getFolderId('drafts');
      const inspected = await inspectExistingDraft(message, evidence, state.claim,
        draftsId, this.domParserClass);
      if (state.sent) fail('DRAFT_AND_SENT_CONFLICT');
      const reviewReason = [sourceReviewReason, inspected.reviewReason]
        .filter(Boolean).join('; ');
      return {status: sourceReviewReason ? 'source_changed_review_required' :
        inspected.recipientReviewRequired ? 'recipient_review_required' :
          inspected.contentReviewRequired ? 'draft_review_required' : 'draft',
        dispatchKey: state.claim.fields.DispatchKey,
        webLink: inspected.webLink, immutableId: evidence.id,
        recipientReviewRequired: inspected.recipientReviewRequired,
        contentReviewRequired: inspected.contentReviewRequired,
        reviewReason};
    }
    if (message.isDraft !== false) fail('MAILBOX_STATE_UNKNOWN');
    const sentId = await context.graph.getFolderId('sentitems');
    if (message.parentFolderId !== sentId ||
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
      if (!(await requiredLinksMatch(links, evidence))) {
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
          f.ReviewReason !== sharedSentReview(actual.reviewReason)) {
        fail('SENT_RECEIPT_CONFLICT');
      }
    } else {
      await context.store.appendSent(state, context.actor, actual);
    }
    return {status: differences.length ? 'sent_with_changes' : 'sent',
      dispatchKey: state.claim.fields.DispatchKey,
      sentAtUtc: actual.sentAtUtc,
      reviewReason: sharedSentReview(actual.reviewReason)};
  }

  async customerDraft(formSourceKey) {
    const key = canonicalFormSourceKey(formSourceKey);
    const dispatchKey = customerDispatchKey(key);
    const context = await this._context('customer');
    const existing = await context.store.getState(dispatchKey);
    if (existing) return this._existingAction(existing, context);

    const source = await context.source.resolve(key, context.actor);
    const content = buildCustomerDraft(source);
    const attemptId = this.randomUUID();
    const correlationId = this.randomUUID();
    const claim = await context.store.createClaim(dispatchKey, context.actor,
      source, attemptId, correlationId);
    const current = await context.source.confirmUnchanged(source, context.actor);
    await this._sameActor(context);
    let created;
    try {
      created = await context.graph.createDraft(content, correlationId, () => {
        if (this.now() >= Math.min(source.validUntilMs, current.validUntilMs)) {
          fail('RELEASE_WINDOW_EXPIRED_BEFORE_DRAFT');
        }
      });
    } catch (error) {
      if (error?.code === 'RELEASE_WINDOW_EXPIRED_BEFORE_DRAFT') throw error;
      fail('DRAFT_OUTCOME_UNKNOWN');
    }
    const evidence = {...content, id: created.id, webLink: null};
    const message = await context.graph.getMessage(created.id);
    const draftsId = await context.graph.getFolderId('drafts');
    const inspected = await verifyDraftMessage(message, evidence, claim,
      draftsId, this.domParserClass);
    if (inspected.recipientReviewRequired) fail('CUSTOMER_DRAFT_RECIPIENT_MISMATCH');
    const state = await context.store.appendDraft(claim, context.actor,
      {...content, id: created.id}, message);
    if (!state.draft || state.sent) fail('DRAFT_RECEIPT_READBACK_MISMATCH');
    return {status: 'draft', dispatchKey, webLink: inspected.webLink,
      immutableId: created.id, recipientReviewRequired: false};
  }

  async checkCustomerSent(formSourceKey) {
    const key = canonicalFormSourceKey(formSourceKey);
    const context = await this._context('customer');
    const state = await context.store.getState(customerDispatchKey(key));
    if (!state) return {status: 'not_started'};
    return this._existingAction(state, context);
  }
}

/** Opt-in host hook. Static Pages has no observer after the tab is closed. */
function attachAttendedCheck({check, getEntityId, onResult,
    onError, windowObject = globalThis.window, documentObject = globalThis.document}) {
  if (!windowObject?.addEventListener || !windowObject?.removeEventListener ||
      !documentObject?.addEventListener || !documentObject?.removeEventListener ||
      typeof check !== 'function' || typeof getEntityId !== 'function' ||
      typeof onResult !== 'function' || typeof onError !== 'function') {
    throw new TypeError('Browser host callbacks are required');
  }
  let busy = false;
  const inspect = async () => {
    if (busy || documentObject.visibilityState === 'hidden') return;
    const id = getEntityId();
    if (!id) return;
    busy = true;
    try { onResult(await check(id)); }
    catch (error) { onError(error); }
    finally { busy = false; }
  };
  windowObject.addEventListener('focus', inspect);
  documentObject.addEventListener('visibilitychange', inspect);
  return () => {
    windowObject.removeEventListener('focus', inspect);
    documentObject.removeEventListener('visibilitychange', inspect);
  };
}

export function attachAttendedSentCheck({runtime, getNativeWoId, ...rest}) {
  if (typeof runtime?.checkSent !== 'function') throw new TypeError('Provider checkSent required');
  return attachAttendedCheck({check: id => runtime.checkSent(id),
    getEntityId: getNativeWoId, ...rest});
}

export function attachAttendedCustomerSentCheck({runtime, getFormSourceKey, ...rest}) {
  if (typeof runtime?.checkCustomerSent !== 'function') {
    throw new TypeError('Customer checkCustomerSent required');
  }
  return attachAttendedCheck({check: key => runtime.checkCustomerSent(key),
    getEntityId: getFormSourceKey, ...rest});
}
