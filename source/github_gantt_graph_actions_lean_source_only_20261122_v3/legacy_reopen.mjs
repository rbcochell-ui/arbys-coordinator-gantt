/**
 * Read-only compatibility path for a migrated historical Outlook draft.
 *
 * This module contains no pilot key, mailbox address, message ID, or tracker
 * capability. The caller supplies reviewed List identities and the two old
 * record numbers through config. It never posts, patches, sends, or deletes.
 */
import {canonicalSentMaterial, LEGACY_SENT_ATTEMPT_FIELDS,
  LEGACY_SENT_FIELDS, sentPlanDigest} from
  './legacy_sent_attempt_contract.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const SHA_MARKER = /^sha256:([0-9a-f]{64})$/;
const MIGRATION_MARKER = /^legacy-(provider-parts|customer-tracker):[A-Za-z0-9._:-]{1,88}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const GRAPH_LIST_SCOPES = Object.freeze(['Lists.SelectedOperations.Selected']);
const GRAPH_MAIL_SCOPES = Object.freeze(['Mail.ReadWrite']);
const OUTLOOK_HOSTS = new Set([
  'outlook.office.com', 'outlook.office365.com',
]);

export class LegacyHold extends Error {
  constructor(code) {
    super(code);
    this.name = 'LegacyHold';
    this.code = code;
  }
}

const hold = code => { throw new LegacyHold(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const blank = value => value === undefined || value === null || value === '';
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

function email(value) {
  if (typeof value !== 'string' || value !== value.trim() ||
      value.length > 254 || !EMAIL.test(value) || value !== value.toLowerCase()) {
    hold('LEGACY_EMAIL_INVALID');
  }
  return value;
}

function utc(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) hold('LEGACY_TIME_INVALID');
  return new Date(value).toISOString();
}

function text(value, max = 2048) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    hold('LEGACY_EVIDENCE_INCOMPLETE');
  }
  return value;
}

function exactUrl(value, hosts = null) {
  let url;
  try { url = new URL(value); } catch { hold('LEGACY_LINK_INVALID'); }
  if (typeof value !== 'string' || value !== url.href ||
      url.protocol !== 'https:' || url.username || url.password ||
      (hosts && !hosts.has(url.hostname))) hold('LEGACY_LINK_INVALID');
  return value;
}

function outlookLink(value) {
  let url;
  try { url = new URL(value); } catch { hold('LEGACY_LINK_INVALID'); }
  // Match the reviewed V3 migration contract. The path is supplied by Graph
  // and compared to the exact old List receipt; only official Outlook hosts
  // are accepted. Graph may use a route other than /owa/ or /mail/.
  if (typeof value !== 'string' || url.protocol !== 'https:' ||
      !OUTLOOK_HOSTS.has(url.hostname) || url.username || url.password) {
    hold('LEGACY_LINK_INVALID');
  }
  return url.href;
}

export function verifiedLegacyOutlookLink(value) {
  return outlookLink(value);
}

function trackerLink(value, tracker) {
  const link = exactUrl(value);
  const url = new URL(link);
  const query = [...url.searchParams.entries()];
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (url.origin !== tracker.origin || !tracker.paths.includes(url.pathname) ||
      query.length !== 1 || query[0][0] !== 'p' ||
      !/^p_[0-9a-f]{32}$/.test(query[0][1]) ||
      fragment.length !== 1 || fragment[0][0] !== 'k' ||
      !/^[A-Za-z0-9_-]{43}$/.test(fragment[0][1])) {
    hold('LEGACY_TRACKER_LINK_INVALID');
  }
  return link;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) hold('LEGACY_CRYPTO_UNAVAILABLE');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function recipients(message, field) {
  if (!Array.isArray(message?.[field])) hold('LEGACY_RECIPIENTS_UNVERIFIED');
  return message[field].map(item => email(item?.emailAddress?.address));
}

function storedRecipients(value, count) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { hold('LEGACY_RECEIPT_INVALID'); }
  if (!Array.isArray(parsed) || parsed.length !== count ||
      parsed.some(address => email(address) !== address) ||
      new Set(parsed).size !== parsed.length) hold('LEGACY_RECEIPT_INVALID');
  return parsed;
}

function storedLinks(value, count) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { hold('LEGACY_RECEIPT_INVALID'); }
  if (!Array.isArray(parsed) || parsed.length !== count ||
      new Set(parsed).size !== parsed.length) hold('LEGACY_RECEIPT_INVALID');
  return parsed;
}

// This conservative raw-tag check is deliberately compatible with the V3
// Gantt reader. DOMParser otherwise discards duplicate attributes silently.
function unsafeRawTags(html) {
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
    const start = i;
    i++;
    while (tagPart(html[i])) i++;
    const tag = html.slice(start, i).toLowerCase();
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
      const first = i++;
      while (attrPart(html[i])) i++;
      const name = html.slice(first, i).toLowerCase();
      if (names.has(name) || !allowedAttrs(tag).has(name)) return true;
      names.add(name);
      while (white(html[i])) i++;
      if (html[i++] !== '=') return true;
      while (white(html[i])) i++;
      let value;
      if (html[i] === '"' || html[i] === "'") {
        const quote = html[i++];
        const startValue = i;
        while (i < html.length && html[i] !== quote) {
          if (html[i++] === '<') return true;
        }
        if (html[i++] !== quote) return true;
        value = html.slice(startValue, i - 1);
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

function anchors(message, ParserCtor) {
  if (String(message?.body?.contentType ?? '').toLowerCase() !== 'html' ||
      typeof message.body.content !== 'string' ||
      message.body.content.length > 500_000 ||
      typeof ParserCtor !== 'function' ||
      message.body.content.includes('<!--') ||
      unsafeRawTags(message.body.content)) hold('LEGACY_HTML_UNVERIFIED');
  let doc;
  try { doc = new ParserCtor().parseFromString(message.body.content, 'text/html'); }
  catch { hold('LEGACY_HTML_UNVERIFIED'); }
  if (typeof doc?.querySelectorAll !== 'function') hold('LEGACY_HTML_UNVERIFIED');
  const links = new Set();
  let count = 0;
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const link = exactUrl(anchor.getAttribute('href'));
    count++;
    links.add(link);
  }
  if (count !== links.size) hold('LEGACY_HTML_UNVERIFIED');
  return links;
}

// Shared by the source-only migration admission wrapper. Its values must be
// derived from the same complete direct Graph HTML that the future reopen
// reads, never from a detached preview's claimed anchor list.
export function verifiedLegacyAnchorTargets(html, ParserCtor) {
  return Object.freeze([...anchors({body: {contentType: 'html',
    content: html}}, ParserCtor)]);
}

function actionKind(dispatchKey) {
  if (typeof dispatchKey !== 'string') hold('LEGACY_KEY_INVALID');
  if (dispatchKey.startsWith('provider-parts:') && dispatchKey.length > 15) {
    return 'provider-parts';
  }
  if (dispatchKey.startsWith('customer-tracker:') && dispatchKey.length > 17) {
    return 'customer-tracker';
  }
  hold('LEGACY_KEY_INVALID');
}

function assertConfig(config) {
  let site;
  try { site = new URL(config?.siteUrl); } catch { hold('LEGACY_CONFIG_INVALID'); }
  const siteIds = String(config?.siteId ?? '').split(',');
  if (site.protocol !== 'https:' || site.username || site.password ||
      site.search || site.hash || siteIds.length !== 3 ||
      siteIds[0] !== site.hostname ||
      !GUID.test(siteIds[1] ?? '') || !GUID.test(siteIds[2] ?? '') ||
      !object(config.oldLists) ||
      !Array.isArray(config.providerPartUrls) ||
      config.providerPartUrls.length !== 6 ||
      new Set(config.providerPartUrls).size !== 6 ||
      !object(config.tracker) ||
      !Array.isArray(config.tracker.paths) ||
      !config.tracker.paths.length ||
      !Array.isArray(config.approvedCustomerReleaseKinds) ||
      !config.approvedCustomerReleaseKinds.length) hold('LEGACY_CONFIG_INVALID');
  for (const part of config.providerPartUrls) exactUrl(part);
  let trackerOrigin;
  try { trackerOrigin = new URL(config.tracker.origin); }
  catch { hold('LEGACY_CONFIG_INVALID'); }
  if (trackerOrigin.href !== `${trackerOrigin.origin}/` ||
      trackerOrigin.protocol !== 'https:' ||
      config.tracker.origin !== trackerOrigin.origin ||
      config.tracker.paths.some(path => typeof path !== 'string' ||
        !path.startsWith('/') || path.startsWith('//'))) hold('LEGACY_CONFIG_INVALID');
  for (const kind of ['provider-parts', 'customer-tracker']) {
    const item = config.oldLists[kind];
    const readback = item?.migrationReadback;
    const original = item?.originalOldRow;
    if (!GUID.test(item?.listId ?? '') ||
        !/^[1-9][0-9]*$/.test(String(item?.itemId ?? '')) ||
        typeof item?.title !== 'string' || !item.title ||
        !SHA.test(item?.migrationPlanSha256 ?? '') ||
        !/^[1-9][0-9]*$/.test(String(readback?.claimItemId ?? '')) ||
        !/^[1-9][0-9]*$/.test(String(readback?.draftReceiptItemId ?? '')) ||
        !text(readback?.claimGraphEtag, 1024) ||
        !text(readback?.draftGraphEtag, 1024) ||
        !SHA.test(readback?.claimFieldsSha256 ?? '') ||
        !SHA.test(readback?.draftFieldsSha256 ?? '') ||
        !text(original?.graphEtag, 1024) ||
        !SHA.test(original?.fullFieldsSha256 ?? '')) {
      hold('LEGACY_CONFIG_INVALID');
    }
  }
  return site;
}

function stateSignature(state) {
  const record = item => item ? [String(item.id), item.etag,
    item.createdByOid ?? null, stable(item.fields)] : null;
  for (const item of [state?.claim, state?.draft, state?.attempt,
    state?.sent].filter(Boolean)) {
    if (!/^[1-9][0-9]*$/.test(String(item.id)) ||
        typeof item.etag !== 'string' || !item.etag || !object(item.fields)) {
      hold('LEGACY_NEW_STATE_UNVERIFIED');
    }
  }
  return JSON.stringify([record(state?.claim), record(state?.draft),
    record(state?.attempt), record(state?.sent)]);
}

function validateState(state, dispatchKey, kind) {
  stateSignature(state);
  const claim = state?.claim?.fields;
  const draft = state?.draft?.fields;
  let sourceEtags;
  try { sourceEtags = JSON.parse(claim?.SourceETagsJson); }
  catch { hold('LEGACY_NEW_STATE_UNVERIFIED'); }
  if (!object(claim) || !object(draft) ||
      claim.Title !== dispatchKey || claim.DispatchKey !== dispatchKey ||
      claim.ActionKind !== kind ||
      claim.EntityId !== dispatchKey.slice(`${kind}:`.length) ||
      !GUID.test(claim.ActorOid ?? '') || email(claim.ActorEmail) !== claim.ActorEmail ||
      !GUID.test(claim.AttemptId ?? '') ||
      !GUID.test(claim.CorrelationId ?? '') ||
      claim.AttemptId === claim.CorrelationId ||
      !SHA.test(claim.SourceDigest ?? '') ||
      !object(sourceEtags) ||
      (kind === 'customer-tracker'
        ? !/^[1-9][0-9]*$/.test(String(sourceEtags.release?.itemId ?? '')) ||
          !text(sourceEtags.release?.etag, 1024) ||
          Object.keys(sourceEtags).length !== 1
        : !/^[1-9][0-9]*$/.test(String(sourceEtags.wo?.itemId ?? '')) ||
          !text(sourceEtags.wo?.etag, 1024) ||
          !object(sourceEtags.contact)) ||
      !utc(claim.ClaimedAtUtc) ||
      !MIGRATION_MARKER.test(claim.MigratedFrom ?? '') ||
      claim.MigratedFrom.split(':')[0] !== `legacy-${kind}` ||
      draft.MigratedFrom !== claim.MigratedFrom ||
      draft.Title !== `${dispatchKey}|Draft` ||
      draft.DispatchKey !== dispatchKey || draft.Kind !== 'Draft' ||
      draft.ReceiptKey !== `${dispatchKey}|Draft` ||
      String(draft.ClaimItemId) !== String(state.claim.id) ||
      String(draft.ActorOid ?? '').toLowerCase() !== claim.ActorOid.toLowerCase() ||
      !blank(draft.DraftWebLink) ||
      !text(draft.DraftImmutableId) ||
      !text(draft.IntendedSubject, 255) ||
      !SHA.test(draft.IntendedBodySha256 ?? '') ||
      !utc(draft.RecordedAtUtc)) {
    hold('LEGACY_NEW_STATE_UNVERIFIED');
  }
  if (state.attempt) {
    const item = state.attempt;
    const attempt = item.fields;
    const receiptKey = `${dispatchKey}|SentAttempt`;
    if (!object(attempt) ||
        LEGACY_SENT_ATTEMPT_FIELDS.some(name =>
          !Object.hasOwn(attempt, name)) ||
        attempt.Title !== receiptKey || attempt.ReceiptKey !== receiptKey ||
        attempt.DispatchKey !== dispatchKey ||
        attempt.Kind !== 'SentAttempt' ||
        String(attempt.ClaimItemId) !== String(state.claim.id) ||
        String(attempt.ActorOid ?? '').toLowerCase() !==
          claim.ActorOid.toLowerCase() ||
        String(item.createdByOid ?? '').toLowerCase() !==
          claim.ActorOid.toLowerCase() ||
        attempt.DraftImmutableId !== draft.DraftImmutableId ||
        attempt.MigratedFrom !== claim.MigratedFrom ||
        !SHA.test(attempt.PlannedSentSha256 ?? '') ||
        !utc(attempt.RecordedAtUtc)) {
      hold('LEGACY_SENT_ATTEMPT_INVALID');
    }
  }
  return {claim, draft};
}

function validateActor(actor) {
  if (!GUID.test(actor?.id ?? '') ||
      typeof actor.address !== 'string' || email(actor.address) !== actor.address) {
    hold('LEGACY_ACTOR_UNVERIFIED');
  }
  return actor;
}

function validateProof(proof, marker, dispatchKey, kind, actor, list, draftId) {
  if (!object(proof) || proof.schema !== 'legacy-migration-proof/v3' ||
      !SHA.test(proof.planSha256 ?? '') ||
      !SHA.test(proof.fingerprint ?? '') ||
      proof.marker !== marker ||
      proof.dispatchKey !== dispatchKey || proof.actionKind !== kind ||
      String(proof.actorOid ?? '').toLowerCase() !== actor.id.toLowerCase() ||
      proof.actorEmail !== actor.address ||
      String(proof.oldListId ?? '').toLowerCase() !== list.listId.toLowerCase() ||
      String(proof.oldItemId) !== String(list.itemId) ||
      typeof proof.oldGraphEtag !== 'string' || !proof.oldGraphEtag ||
      !SHA.test(proof.oldFieldsSha256 ?? '') ||
      proof.oldGraphEtag !== list.originalOldRow.graphEtag ||
      proof.oldFieldsSha256 !== list.originalOldRow.fullFieldsSha256 ||
      proof.planSha256 !== list.migrationPlanSha256 ||
      proof.immutableMessageId !== draftId) {
    hold('LEGACY_MIGRATION_PROOF_INVALID');
  }
  return proof;
}

async function readList(graph, config, kind, siteUrl) {
  const list = config.oldLists[kind];
  const base = `/v1.0/sites/${encodeURIComponent(config.siteId)}/lists/${list.listId}`;
  let meta, item;
  try {
    meta = await graph.request(`${base}?$select=id,displayName,webUrl`,
      {scopes: GRAPH_LIST_SCOPES});
    item = await graph.request(`${base}/items/${list.itemId}?$select=id,eTag&$expand=fields`,
      {scopes: GRAPH_LIST_SCOPES});
  } catch { hold('LEGACY_OLD_ROW_READ_UNCERTAIN'); }
  let web;
  try { web = new URL(meta?.data?.webUrl); } catch { hold('LEGACY_OLD_LIST_UNVERIFIED'); }
  if (meta?.status !== 200 ||
      String(meta.data?.id ?? '').toLowerCase() !== list.listId.toLowerCase() ||
      meta.data?.displayName !== list.title ||
      web.origin !== siteUrl.origin ||
      !web.pathname.startsWith(`${siteUrl.pathname.replace(/\/$/, '')}/`)) {
    hold('LEGACY_OLD_LIST_UNVERIFIED');
  }
  const row = item?.data;
  const etag = row?.eTag ?? row?.['@odata.etag'];
  if (item?.status !== 200 || !object(row) || Array.isArray(row.value) ||
      row['@odata.nextLink'] || String(row.id) !== String(list.itemId) ||
      typeof etag !== 'string' || !etag || !object(row.fields)) {
    hold('LEGACY_OLD_ROW_UNVERIFIED');
  }
  return {id: String(row.id), etag, fields: row.fields};
}

async function readMessage(graph, immutableId) {
  const select = 'id,isDraft,parentFolderId,sentDateTime,toRecipients,ccRecipients,bccRecipients,internetMessageHeaders,webLink,subject,body,internetMessageId,from,sender';
  let response;
  try {
    response = await graph.request(
      `/v1.0/me/messages/${encodeURIComponent(immutableId)}?$select=${select}`,
      {scopes: GRAPH_MAIL_SCOPES, headers: {Prefer: 'IdType="ImmutableId"'}});
  } catch { hold('LEGACY_MESSAGE_READ_UNCERTAIN'); }
  if (response?.status !== 200 || !object(response.data)) {
    hold('LEGACY_MESSAGE_READ_UNCERTAIN');
  }
  return response.data;
}

function providerEvidence(old, claim, draft, expectedTo, expectedLinks, config) {
  if (old.DispatchKey !== claim.DispatchKey ||
      old.NativeWorkOrderId !== claim.EntityId ||
      old.MailboxOwner !== claim.ActorEmail ||
      !GUID.test(old.IntentId ?? '') ||
      !['Draft', 'Sent', 'SentModified'].includes(old.State) ||
      (old.State === 'Draft' && !blank(old.SentAtUtc)) ||
      (old.State !== 'Draft' && blank(old.SentAtUtc)) ||
      old.ImmutableMessageId !== draft.DraftImmutableId ||
      !same(expectedTo, [email(old.ExpectedManagerEmail), email(old.ExpectedPlannerEmail)]) ||
      expectedLinks.length !== config.providerPartUrls.length ||
      !same(expectedLinks, config.providerPartUrls)) {
    hold('LEGACY_PROVIDER_EVIDENCE_MISMATCH');
  }
  for (const link of expectedLinks) exactUrl(link);
  return {intentId: old.IntentId, oldLink: outlookLink(old.DraftWebLink),
    requiredLinks: expectedLinks};
}

async function customerEvidence(old, claim, draft, expectedTo, storedLinkMarkers,
    config, ParserCtor, now) {
  const formKey = claim.DispatchKey.slice('customer-tracker:'.length);
  const link = trackerLink(old.CustomerTrackingUrl, config.tracker);
  const issued = utc(old.IssuedAtUtc);
  const readyUntil = utc(old.ReadyUntilUtc);
  if (old.FormSourceKey !== formKey || claim.EntityId !== formKey ||
      old.ReleaseState !== 'Ready' || old.DraftState !== 'DraftReady' ||
      !config.approvedCustomerReleaseKinds.includes(old.ReleaseKind) ||
      old.DraftMailbox !== claim.ActorEmail ||
      old.DraftMessageId !== draft.DraftImmutableId ||
      email(old.RecipientEmail) !== expectedTo[0] ||
      old.DraftSubject !== draft.IntendedSubject ||
      !SHA.test(old.ReleaseReceiptSha256 ?? '') ||
      !SHA.test(old.CiphertextSha256 ?? '') ||
      !/^[0-9a-f]{40}$/.test(old.PublishedCommit ?? '') ||
      !text(old.DraftBodyHtml, 500_000) ||
      Date.parse(readyUntil) <= Date.parse(issued) ||
      storedLinkMarkers.length !== 1 ||
      !SHA_MARKER.test(storedLinkMarkers[0] ?? '') ||
      `sha256:${await sha256(link)}` !== storedLinkMarkers[0]) {
    hold('LEGACY_CUSTOMER_RELEASE_MISMATCH');
  }
  const releaseBodyLinks = anchors({body: {contentType: 'html',
    content: old.DraftBodyHtml}}, ParserCtor);
  if (releaseBodyLinks.size !== 1 || !releaseBodyLinks.has(link)) {
    hold('LEGACY_CUSTOMER_RELEASE_MISMATCH');
  }
  // V3 migration binds the *observed Outlook draft* body hash to the Draft
  // Receipt. The exact Release template may differ from the observed draft
  // HTML (for example, after an edit). Both must still contain only this
  // verified tracker anchor, and the live draft must match its migrated hash.
  return {oldLink: outlookLink(old.DraftWebLink), requiredLinks: [link],
    releaseStale: now >= Date.parse(readyUntil)};
}

function oldIntentHeader(message, intentId) {
  if (!Array.isArray(message.internetMessageHeaders)) {
    hold('LEGACY_INTENT_HEADER_UNVERIFIED');
  }
  const rows = message.internetMessageHeaders.filter(header =>
    String(header?.name ?? '').toLowerCase() === 'x-arbys-parts-intent-id');
  if (rows.length !== 1 || rows[0].value !== intentId) {
    hold('LEGACY_INTENT_HEADER_MISMATCH');
  }
}

async function validateSentReceipt(state, message, to, cc, bcc, bodySha, links) {
  if (!state.sent) return null;
  const f = state.sent.fields;
  const linksSha = await sha256(JSON.stringify([...links].sort()));
  if (f.Title !== `${state.claim.fields.DispatchKey}|Sent` ||
      f.DispatchKey !== state.claim.fields.DispatchKey ||
      f.Kind !== 'Sent' || f.ReceiptKey !== `${f.DispatchKey}|Sent` ||
      String(f.ClaimItemId) !== String(state.claim.id) ||
      String(f.ActorOid ?? '').toLowerCase() !==
        state.claim.fields.ActorOid.toLowerCase() ||
      String(state.sent.createdByOid ?? '').toLowerCase() !==
        state.claim.fields.ActorOid.toLowerCase() ||
      f.MigratedFrom !== state.claim.fields.MigratedFrom ||
      f.DraftImmutableId !== message.id || f.SentImmutableId !== message.id ||
      f.SentAtUtc !== utc(message.sentDateTime) ||
      f.SentInternetMessageId !== message.internetMessageId ||
      f.ActualSubject !== `sha256:${await sha256(message.subject)}` ||
      f.ActualBodySha256 !== bodySha || f.ActualLinksSha256 !== linksSha ||
      f.ActualToJson !== JSON.stringify(to) ||
      f.ActualCcJson !== JSON.stringify(cc) ||
      f.ActualBccJson !== JSON.stringify(bcc) ||
      !utc(f.RecordedAtUtc) ||
      !['', 'SENT_DETAILS_CHANGED'].includes(f.ReviewReason)) {
    hold('LEGACY_SENT_RECEIPT_CONFLICT');
  }
  return f.ReviewReason === 'SENT_DETAILS_CHANGED' ? 'sent_with_changes' : 'sent';
}

/**
 * Requires the reviewed two-key fence and an existing migrated Claim/Receipt.
 * Even a failed proof leaves the key occupied; callers must never fall through
 * to the new-draft POST path. The returned Outlook link is Ryan-only UI data.
 */
export class LegacyReopenAdapter {
  constructor({graph, makeStore, inspectLegacyInventory, loadMigrationProof, config,
      domParserClass = globalThis.DOMParser,
      now = () => Date.now()}) {
    if (typeof graph?.bindAccount !== 'function' ||
        typeof makeStore !== 'function' ||
        typeof inspectLegacyInventory !== 'function' ||
        typeof loadMigrationProof !== 'function' || typeof now !== 'function') {
      throw new TypeError('Bound read ports are required');
    }
    this.graph = graph;
    this.makeStore = makeStore;
    this.inspectLegacyInventory = inspectLegacyInventory;
    this.loadMigrationProof = loadMigrationProof;
    this.config = config;
    this.domParserClass = domParserClass;
    this.now = now;
  }

  async _inspect(dispatchKey, {prepareSent = false} = {}) {
    const kind = actionKind(dispatchKey);
    const siteUrl = assertConfig(this.config);
    const graph = this.graph.bindAccount();
    let inventory;
    try { inventory = await this.inspectLegacyInventory(
      dispatchKey, graph, this.config.siteId); }
    catch { hold('LEGACY_FENCE_UNVERIFIED'); }
    const occupied = inventory?.occupied;
    if (occupied?.status !== 'legacy_occupied' ||
        occupied.dispatchKey !== dispatchKey ||
        !SHA.test(inventory.proofDigest ?? '') ||
        !Number.isFinite(inventory.validUntilMs) ||
        inventory.validUntilMs <= this.now()) hold('LEGACY_FENCE_UNVERIFIED');
    // The fence and adapter must inspect the *same* old physical row. The
    // current stand-alone fence must be extended to return this read identity
    // before integration; a Boolean occupation is deliberately insufficient.
    const fencedRow = occupied.rowRef;
    const configuredRow = this.config.oldLists[kind];
    if (!object(fencedRow) || fencedRow.siteId !== this.config.siteId ||
        String(fencedRow.listId ?? '').toLowerCase() !==
          configuredRow.listId.toLowerCase() ||
        String(fencedRow.itemId) !== String(configuredRow.itemId) ||
        typeof fencedRow.etag !== 'string' || !fencedRow.etag ||
        fencedRow.etag !== configuredRow.originalOldRow.graphEtag) {
      hold('LEGACY_FENCE_IDENTITY_MISMATCH');
    }

    let store;
    try { store = this.makeStore(graph); }
    catch { hold('LEGACY_NEW_STATE_UNVERIFIED'); }
    let state;
    try {
      await store.assertSchema();
      state = await store.getState(dispatchKey);
    } catch { hold('LEGACY_NEW_STATE_UNVERIFIED'); }
    const {claim, draft} = validateState(state, dispatchKey, kind);
    const readback = this.config.oldLists[kind].migrationReadback;
    if (String(state.claim.id) !== String(readback.claimItemId) ||
        String(state.draft.id) !== String(readback.draftReceiptItemId) ||
        state.claim.etag !== readback.claimGraphEtag ||
        state.draft.etag !== readback.draftGraphEtag ||
        await sha256(JSON.stringify(stable(claim))) !==
          readback.claimFieldsSha256 ||
        await sha256(JSON.stringify(stable(draft))) !==
          readback.draftFieldsSha256) {
      hold('LEGACY_NEW_STATE_CHANGED_SINCE_MIGRATION');
    }
    let actor;
    try { actor = validateActor(await graph.getMe()); }
    catch { hold('LEGACY_ACTOR_UNVERIFIED'); }
    if (claim.ActorOid.toLowerCase() !== actor.id.toLowerCase() ||
        claim.ActorEmail !== actor.address) {
      return {publicResult: Object.freeze({status: 'legacy_occupied',
        reason: 'OWNER_HANDOFF_REQUIRED', webLink: null}),
        sentPlan: null, recordedSent: null, recordedAttempt: null};
    }

    const to = storedRecipients(draft.IntendedToJson,
      kind === 'provider-parts' ? 2 : 1);
    const linkMarkers = storedLinks(draft.RequiredLinksJson,
      kind === 'provider-parts' ? 6 : 1);
    const oldRow = await readList(graph, this.config, kind, siteUrl);
    let proof;
    try {
      proof = validateProof(await this.loadMigrationProof(
        claim.MigratedFrom, graph, Object.freeze({state, oldRow,
          inventory, actor, kind, dispatchKey})), claim.MigratedFrom,
        dispatchKey, kind, actor, this.config.oldLists[kind],
        draft.DraftImmutableId);
    } catch { hold('LEGACY_MIGRATION_PROOF_INVALID'); }
    if (oldRow.etag !== fencedRow.etag ||
        oldRow.etag !== proof.oldGraphEtag ||
        await sha256(JSON.stringify(stable(oldRow.fields))) !==
          proof.oldFieldsSha256 ||
        proof.oldFieldsSha256 !==
          configuredRow.originalOldRow.fullFieldsSha256) {
      hold('LEGACY_OLD_ROW_CHANGED_SINCE_MIGRATION');
    }
    if (kind === 'customer-tracker') {
      const sourceEtags = JSON.parse(claim.SourceETagsJson);
      const directItem = {id: oldRow.id, eTag: oldRow.etag,
        fields: oldRow.fields};
      if (String(sourceEtags.release?.itemId) !== oldRow.id ||
          sourceEtags.release?.etag !== oldRow.etag ||
          claim.SourceDigest !==
            await sha256(JSON.stringify(stable(directItem)))) {
        hold('LEGACY_CUSTOMER_SOURCE_MISMATCH');
      }
    }
    let evidence;
    if (kind === 'provider-parts') {
      evidence = providerEvidence(oldRow.fields, claim, draft, to,
        linkMarkers, this.config);
    } else {
      evidence = await customerEvidence(oldRow.fields, claim, draft, to,
        linkMarkers, this.config, this.domParserClass, this.now());
    }
    const message = await readMessage(graph, draft.DraftImmutableId);
    const currentWebLink = outlookLink(message.webLink);
    if (message.id !== draft.DraftImmutableId ||
        message.subject !== draft.IntendedSubject ||
        email(message.from?.emailAddress?.address) !== actor.address ||
        email(message.sender?.emailAddress?.address) !== actor.address) {
      hold('LEGACY_MESSAGE_IDENTITY_MISMATCH');
    }
    if (kind === 'provider-parts') oldIntentHeader(message, evidence.intentId);
    const actualTo = recipients(message, 'toRecipients');
    const actualCc = recipients(message, 'ccRecipients');
    const actualBcc = recipients(message, 'bccRecipients');
    if (!same(actualTo, to) || actualCc.length || actualBcc.length) {
      hold('LEGACY_MESSAGE_RECIPIENTS_CHANGED');
    }
    const links = anchors(message, this.domParserClass);
    if (links.size !== evidence.requiredLinks.length ||
        !same([...links], evidence.requiredLinks)) hold('LEGACY_MESSAGE_LINKS_CHANGED');
    const bodySha = await sha256(message.body.content);
    if (bodySha !== draft.IntendedBodySha256) hold('LEGACY_MESSAGE_BODY_CHANGED');

    let status, reason, sentAtUtc = null;
    if (message.isDraft === true) {
      if (state.sent || state.attempt) {
        hold('LEGACY_DRAFT_AND_SENT_CONFLICT');
      }
      let draftsId;
      try { draftsId = await graph.getFolderId('drafts'); }
      catch { hold('LEGACY_DRAFTS_FOLDER_UNVERIFIED'); }
      if (message.parentFolderId !== draftsId ||
          currentWebLink !== evidence.oldLink || !blank(message.sentDateTime) ||
          (kind === 'provider-parts' && oldRow.fields.State !== 'Draft')) {
        hold('LEGACY_DRAFT_FOLDER_MISMATCH');
      }
      status = 'legacy_draft_review_required';
      reason = kind === 'customer-tracker' && evidence.releaseStale ?
        'RELEASE_EXPIRED_REVIEW_REQUIRED' : 'CURRENT_SOURCE_REVIEW_REQUIRED';
    } else if (message.isDraft === false) {
      let sentId;
      try { sentId = await graph.getFolderId('sentitems'); }
      catch { hold('LEGACY_SENT_FOLDER_UNVERIFIED'); }
      if (message.parentFolderId !== sentId ||
          typeof message.internetMessageId !== 'string' ||
          !message.internetMessageId ||
          Date.parse(message.sentDateTime) < Date.parse(claim.ClaimedAtUtc) ||
          (kind === 'provider-parts' && oldRow.fields.State !== 'Draft' &&
            utc(oldRow.fields.SentAtUtc) !== utc(message.sentDateTime))) {
        hold('LEGACY_SENT_NOT_CONFIRMED');
      }
      sentAtUtc = utc(message.sentDateTime);
      if (state.attempt && state.sent) {
        let savedSentFields;
        try {
          savedSentFields = Object.fromEntries(LEGACY_SENT_FIELDS.map(name =>
            [name, state.sent.fields[name]]));
          if (LEGACY_SENT_FIELDS.some(name =>
            !Object.hasOwn(state.sent.fields, name)) ||
              await sentPlanDigest(savedSentFields) !==
                state.attempt.fields.PlannedSentSha256) {
            hold('LEGACY_SENT_ATTEMPT_MISMATCH');
          }
        } catch { hold('LEGACY_SENT_ATTEMPT_MISMATCH'); }
      }
      const recordedStatus = await validateSentReceipt(state, message,
        actualTo, actualCc, actualBcc, bodySha, links);
      status = recordedStatus ?? 'sent_observed_unlogged';
      reason = recordedStatus ? '' : 'SENT_RECEIPT_REQUIRED';
    } else {
      hold('LEGACY_MAILBOX_STATE_UNVERIFIED');
    }

    // Read again after mailbox access so a concurrent old row or new receipt
    // change cannot be reported as a clean proof from mixed moments.
    let endActor, endState, endMessage, endInventory;
    try {
      endActor = validateActor(await graph.getMe());
      endState = await store.getState(dispatchKey);
      endMessage = await readMessage(graph, draft.DraftImmutableId);
      endInventory = await this.inspectLegacyInventory(dispatchKey, graph,
        this.config.siteId, inventory.proofDigest);
    } catch { hold('LEGACY_END_READ_UNCERTAIN'); }
    const endOld = await readList(graph, this.config, kind, siteUrl);
    const endRef = endInventory?.occupied?.rowRef;
    if (endActor.id !== actor.id || endActor.address !== actor.address ||
        endInventory?.proofDigest !== inventory.proofDigest ||
        endInventory?.occupied?.status !== 'legacy_occupied' ||
        endInventory?.occupied?.dispatchKey !== dispatchKey ||
        !Number.isFinite(endInventory.validUntilMs) ||
        endInventory.validUntilMs <= this.now() ||
        !object(endRef) || endRef.siteId !== fencedRow.siteId ||
        String(endRef.listId).toLowerCase() !==
          String(fencedRow.listId).toLowerCase() ||
        String(endRef.itemId) !== String(fencedRow.itemId) ||
        endRef.etag !== fencedRow.etag ||
        stateSignature(endState) !== stateSignature(state) ||
        JSON.stringify(stable(endMessage)) !== JSON.stringify(stable(message)) ||
        endOld.etag !== oldRow.etag ||
        JSON.stringify(stable(endOld.fields)) !== JSON.stringify(stable(oldRow.fields))) {
      hold('LEGACY_CONCURRENT_CHANGE');
    }
    const publicResult = Object.freeze({status, reason,
      webLink: message.isDraft ? currentWebLink : null,
      sentAtUtc, sendReady: false});
    let sentPlan = null;
    if (prepareSent && status === 'sent_observed_unlogged') {
      const fields = Object.freeze({
        Title: `${dispatchKey}|Sent`, ReceiptKey: `${dispatchKey}|Sent`,
        DispatchKey: dispatchKey, Kind: 'Sent',
        ClaimItemId: String(state.claim.id), ActorOid: actor.id,
        DraftImmutableId: draft.DraftImmutableId,
        SentImmutableId: message.id,
        ActualSubject: `sha256:${await sha256(message.subject)}`,
        ActualBodySha256: bodySha,
        ActualLinksSha256: await sha256(JSON.stringify([...links].sort())),
        ActualToJson: JSON.stringify(actualTo),
        ActualCcJson: JSON.stringify(actualCc),
        ActualBccJson: JSON.stringify(actualBcc),
        SentAtUtc: sentAtUtc,
        SentInternetMessageId: message.internetMessageId,
        ReviewReason: '', RecordedAtUtc: new Date(this.now()).toISOString(),
        MigratedFrom: claim.MigratedFrom,
      });
      sentPlan = Object.freeze({dispatchKey,
        claimItemId: String(state.claim.id), claimEtag: state.claim.etag,
        draftReceiptItemId: String(state.draft.id),
        draftReceiptEtag: state.draft.etag,
        oldRowEtag: oldRow.etag,
        inventoryProofDigest: inventory.proofDigest,
        inventoryValidUntilMs: endInventory.validUntilMs,
        fields});
    }
    const recordedSent = state.sent &&
      ['sent', 'sent_with_changes'].includes(status) ?
      {id: String(state.sent.id), fields: state.sent.fields} : null;
    const recordedAttempt = state.attempt ?
      {id: String(state.attempt.id), etag: state.attempt.etag,
        createdByOid: state.attempt.createdByOid,
        fields: state.attempt.fields} : null;
    return {publicResult, sentPlan, recordedSent, recordedAttempt};
  }

  async reopen(dispatchKey) {
    return (await this._inspect(dispatchKey)).publicResult;
  }

  async prepareSentReceipt(dispatchKey) {
    const result = await this._inspect(dispatchKey, {prepareSent: true});
    if (result.recordedAttempt) hold('LEGACY_SENT_ATTEMPT_OCCUPIED');
    if (!result.sentPlan) hold('LEGACY_SENT_RECEIPT_NOT_READY');
    return result.sentPlan;
  }

  async verifyRecordedAttempt(dispatchKey, expectedItemId,
      expectedMarkerFields, expectedSentFields) {
    const result = await this._inspect(dispatchKey, {prepareSent: true});
    const marker = result.recordedAttempt;
    const fields = expectedMarkerFields;
    if (result.publicResult.status !== 'sent_observed_unlogged' ||
        !result.sentPlan || !marker ||
        String(marker.id) !== String(expectedItemId) ||
        !object(fields) ||
        Object.keys(fields).sort().join(',') !==
          [...LEGACY_SENT_ATTEMPT_FIELDS].sort().join(',') ||
        Object.entries(fields).some(([name, value]) =>
          marker.fields[name] !== value) ||
        String(marker.createdByOid ?? '').toLowerCase() !==
          String(fields.ActorOid ?? '').toLowerCase() ||
        !marker.etag ||
        !object(expectedSentFields) ||
        Object.keys(expectedSentFields).sort().join(',') !==
          [...LEGACY_SENT_FIELDS].sort().join(',')) {
      hold('LEGACY_SENT_ATTEMPT_READBACK_UNCERTAIN');
    }
    let digest;
    try {
      if (utc(expectedSentFields.RecordedAtUtc) !==
            expectedSentFields.RecordedAtUtc ||
          canonicalSentMaterial(expectedSentFields) !==
            canonicalSentMaterial(result.sentPlan.fields)) {
        hold('LEGACY_SENT_ATTEMPT_READBACK_UNCERTAIN');
      }
      digest = await sentPlanDigest(expectedSentFields);
    }
    catch { hold('LEGACY_SENT_ATTEMPT_READBACK_UNCERTAIN'); }
    if (digest !== fields.PlannedSentSha256) {
      hold('LEGACY_SENT_ATTEMPT_READBACK_UNCERTAIN');
    }
    // The marker commits to the *exact* Sent row bytes prepared before its
    // POST. The fresh read must match every source-derived field; the saved
    // timestamp stays frozen for the sole final Sent POST.
    const sentPlan = Object.freeze({...result.sentPlan,
      fields: Object.freeze({...expectedSentFields})});
    return Object.freeze({sentPlan,
      attemptEtag: marker.etag});
  }

  async verifyRecordedSent(dispatchKey, expectedItemId, expectedFields) {
    const result = await this._inspect(dispatchKey);
    if (result.publicResult.status !== 'sent' ||
        String(result.recordedSent?.id) !== String(expectedItemId) ||
        !object(expectedFields) ||
        Object.entries(expectedFields).some(([name, value]) =>
          result.recordedSent.fields[name] !== value)) {
      hold('LEGACY_SENT_READBACK_UNCERTAIN');
    }
    return result.publicResult;
  }
}
