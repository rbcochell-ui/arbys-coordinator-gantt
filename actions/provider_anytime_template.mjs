// A dated chart can supply context for an editable parts email at any time.
// It cannot prove that a work order, service date, or contact is current.
// Nothing here creates a cloud draft, orders parts, or sends email.
import {PICOS_PARTS} from './parts.mjs';

const SNAPSHOT_RE =
  /<script type="application\/json" id="snapshotData">([^<]+)<\/script>/gu;
const WO_ID = /^0WO[A-Za-z0-9]{15}$/u;
const WO_NUMBER = /^[0-9]{5,12}$/u;
const AGENT = /^[A-Z][A-Z0-9]{0,9}$/u;
const STORE = /^[0-9]{1,7}$/u;
const ACN = /^[0-9]{4,12}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const EMAIL = /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u;
const OUTLOOK_ORIGIN = 'https://outlook.cloud.microsoft';
const OUTLOOK_PATH = '/mail/deeplink/compose';

const escapeHtml = value => String(value).replace(/[&<>"']/gu, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const nonconflict = (value, expected) => value === undefined ||
  value === expected;

function isoDate(value) {
  return typeof value === 'string' && DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function chartRecipients(project, wo, agentCode) {
  const candidate = wo.providerContactCandidate;
  if (candidate?.state !== 'two_source_file_candidate' ||
      !EMAIL.test(candidate.installManagerEmail ?? '') ||
      !EMAIL.test(candidate.plannerEmail ?? '') ||
      !ACN.test(wo.acn ?? '')) return Object.freeze([]);

  const native = wo.nativeFields ?? {};
  const nativeAgent = typeof native['Assigned SP - Name'] === 'string'
    ? native['Assigned SP - Name'].split(/[-_]/u)[0].trim().toUpperCase()
    : undefined;
  const identityAgrees = nonconflict(nativeAgent, agentCode) &&
    nonconflict(native.ACN, wo.acn) &&
    nonconflict(native['Work Order ID'], wo.id.slice(0, 15));
  const storeLinked = STORE.test(project.formStore ?? '') &&
    wo.woStore === project.formStore &&
    nonconflict(native['Store Number'], wo.woStore);
  // The chart's eighth candidate was linked by exact address, ACN and agent
  // while its native WO store was missing. Keep that stated source boundary.
  const addressLinked = candidate.matchMethod ===
      'exact_address_acn_agent' &&
    candidate.storeNumberStillMissing === true &&
    STORE.test(project.formStore ?? '') &&
    !STORE.test(wo.woStore ?? '');
  if (!identityAgrees || (!storeLinked && !addressLinked)) {
    return Object.freeze([]);
  }
  return Object.freeze([...new Set([
    candidate.installManagerEmail.toLowerCase(),
    candidate.plannerEmail.toLowerCase(),
  ])]);
}

/** Read only the authenticated chart's Installation rows; no public contacts. */
export function parseProviderTemplateCatalog(html) {
  if (typeof html !== 'string' || html.length > 800_000) {
    throw new Error('Provider template chart unavailable');
  }
  const matches = [...html.matchAll(SNAPSHOT_RE)];
  if (matches.length !== 1 || matches[0][1].length > 700_000) {
    throw new Error('Provider template chart unavailable');
  }
  let snapshot;
  try { snapshot = JSON.parse(matches[0][1]); }
  catch { throw new Error('Provider template chart unavailable'); }
  if (snapshot?.schema !== 'arbys-local-exact-form-project-preview/v16' ||
      !isoDate(snapshot.asOfDate) || !Array.isArray(snapshot.projects) ||
      snapshot.projects.length > 50) {
    throw new Error('Provider template chart unavailable');
  }
  const rows = [];
  const seen = new Set();
  for (const project of snapshot.projects) {
    if (!Array.isArray(project?.cases)) continue;
    for (const oneCase of project.cases) {
      if (!Array.isArray(oneCase?.workOrders)) continue;
      for (const wo of oneCase.workOrders) {
        if (wo?.type !== 'Installation') continue;
        if (!WO_ID.test(wo.id ?? '') || !WO_NUMBER.test(wo.number ?? '') ||
            seen.has(wo.id) || rows.length >= 50) {
          throw new Error('Provider template Installation identity unavailable');
        }
        seen.add(wo.id);
        const agentCode = typeof wo.assignedSpAgentCode === 'string'
          ? wo.assignedSpAgentCode.toUpperCase() : '';
        const agent = AGENT.test(agentCode) ? agentCode : null;
        const storeNumber = STORE.test(wo.woStore ?? '') &&
          wo.woStore === project.formStore ? wo.woStore : null;
        const status = typeof wo.status === 'string' &&
          wo.status.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(wo.status)
          ? wo.status : 'Unverified';
        const spActivityDate = isoDate(wo.spActivityDate)
          ? wo.spActivityDate : null;
        rows.push(Object.freeze({id: wo.id, workOrderNumber: wo.number,
          agentCode: agent, storeNumber, status, spActivityDate,
          spActivityDateConfirmed: false,
          suggestedRecipients: agent
            ? chartRecipients(project, wo, agent) : Object.freeze([])}));
      }
    }
  }
  rows.sort((a, b) => a.workOrderNumber.localeCompare(b.workOrderNumber));
  return Object.freeze({asOfDate: snapshot.asOfDate,
    installations: Object.freeze(rows)});
}

function exactInput(input) {
  const workOrderNumber = String(input?.workOrderNumber ?? '').trim();
  const agentCode = String(input?.agentCode ?? '').trim().toUpperCase();
  if (!WO_NUMBER.test(workOrderNumber) || !AGENT.test(agentCode) ||
      !isoDate(input?.asOfDate) ||
      !['charted', 'manual'].includes(input?.sourceMode)) {
    throw new TypeError('Enter a valid Installation WO and SP agent code');
  }
  return {workOrderNumber, agentCode, asOfDate: input.asOfDate,
    sourceMode: input.sourceMode};
}

function messageText(input) {
  const context = input.sourceMode === 'charted'
    ? `The Gantt lists this Installation WO and agent as of ${input.asOfDate}.`
    : 'The coordinator entered this Installation WO and SP agent code manually.';
  const introduction = `For Arby's installation work order ${input.workOrderNumber} (SP agent ${input.agentCode}), please review the six myCoke parts below. ${context} Confirm the current work order type, assigned provider, status, scope, service date and quantities in Thirsty before ordering. Any SP activity date shown in the Gantt is unconfirmed.`;
  const direction = 'If this installation is active and the parts are needed, please order the confirmed quantities before the confirmed work date. The stainless chase quantity is two only if this visit needs two. If an item is already on hand, does not fit, or the work order is closed or cancelled, please reply with that exception before placing an order.';
  const closing = 'Please reply with the items ordered, order reference and expected delivery date, or explain why no order is needed. If the date or scope changed, please update the work order in Thirsty.';
  const partLines = PICOS_PARTS.flatMap(part => [
    `- ${part.code} ${part.name} (myCoke material ${part.material})`,
    part.url,
    '',
  ]);
  const body = ['Hello,', '', introduction, '', direction, '',
    ...partLines, closing, ''].join('\n');
  return {introduction, direction, closing, body};
}

/** The template has no time cutoff. Outlook remains the human Send boundary. */
export function buildProviderPartsTemplate(input) {
  const exact = exactInput(input);
  const message = messageText(exact);
  const suggestions = exact.sourceMode === 'charted' &&
      Array.isArray(input?.suggestedRecipients) &&
      input.suggestedRecipients.length >= 1 &&
      input.suggestedRecipients.length <= 2 &&
      input.suggestedRecipients.every(value => EMAIL.test(value ?? '')) &&
      new Set(input.suggestedRecipients.map(value =>
        value.toLowerCase())).size === input.suggestedRecipients.length
    ? Object.freeze(input.suggestedRecipients.map(value => value.toLowerCase()))
    : Object.freeze([]);
  return Object.freeze({kind: 'provider', ...exact,
    to: suggestions,
    subject: `Arby's WO ${exact.workOrderNumber} | Provider parts review`,
    ...message});
}

/** Rich clipboard uses the part name as link text; plain text keeps full URLs. */
export function providerPartsClipboardPayload(template) {
  const exact = exactInput(template);
  const expected = messageText(exact);
  if (template?.kind !== 'provider' || template.body !== expected.body ||
      template.introduction !== expected.introduction ||
      template.direction !== expected.direction ||
      template.closing !== expected.closing) {
    throw new TypeError('Provider template changed before copy');
  }
  const items = PICOS_PARTS.map(part =>
    `<li><a href="${escapeHtml(part.url)}">${escapeHtml(part.code)} ${escapeHtml(part.name)}</a> (myCoke material ${escapeHtml(part.material)})</li>`).join('');
  const html = `<div><p>Hello,</p><p>${escapeHtml(expected.introduction)}</p>` +
    `<p>${escapeHtml(expected.direction)}</p><ul>${items}</ul>` +
    `<p>${escapeHtml(expected.closing)}</p></div>`;
  return Object.freeze({plainText: expected.body, html, linkCount: 6});
}

/** Outlook receives only To and subject. The copied body is pasted by a human. */
export function providerOutlookHeader(toText, subject) {
  if (typeof toText !== 'string' || typeof subject !== 'string' ||
      !subject || subject.length > 180 ||
      /[\u0000-\u001f\u007f]/u.test(subject)) {
    throw new TypeError('Outlook header needs a valid subject');
  }
  const to = toText.trim() ? toText.split(/[;,]/u).map(value => value.trim()) : [];
  if (to.length > 2 || to.some(value => !EMAIL.test(value)) ||
      new Set(to.map(value => value.toLowerCase())).size !== to.length) {
    throw new TypeError('Check the suggested recipients before opening Outlook');
  }
  const url = new URL(OUTLOOK_PATH, OUTLOOK_ORIGIN);
  if (to.length) url.searchParams.set('to', to.join(';'));
  url.searchParams.set('subject', subject);
  if (url.href.length > 1_000 || url.origin !== OUTLOOK_ORIGIN ||
      url.pathname !== OUTLOOK_PATH || url.searchParams.has('body')) {
    throw new TypeError('Outlook header unavailable');
  }
  return Object.freeze({url: url.href, to: Object.freeze(to), subject});
}
