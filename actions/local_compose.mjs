import {PICOS_PARTS} from './picos_parts.mjs';
import {validateCustomerTrackerUrl} from './pilot_binding.mjs';

const OUTLOOK_COMPOSE = 'https://outlook.office.com/mail/deeplink/compose';
const WO_ID = /^0WO[A-Za-z0-9]{15}$/;
const WO_NUMBER = /^[0-9]{5,12}$/;
const AGENT_CODE = /^[A-Za-z][A-Za-z0-9]{0,9}$/;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
export const MAX_COMPOSE_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;

export function freshComposeSource(value, nowMs = Date.now()) {
  if (typeof value !== 'string' || !UTC.test(value) || !Number.isFinite(nowMs)) return false;
  const observedMs = Date.parse(value);
  return Number.isFinite(observedMs) && observedMs <= nowMs + 60_000 &&
    nowMs - observedMs < MAX_COMPOSE_SOURCE_AGE_MS;
}

function required(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value) || /[\r\n]/.test(value)) {
    throw new Error(`${label} is not valid`);
  }
  return value;
}

/** Legacy compose URL for local review only; the Gantt does not navigate here. */
export function buildOutlookComposeUrl({to = [], subject, body}) {
  if (!Array.isArray(to) || to.length > 2) throw new Error('Recipient list is not valid');
  const recipients = to.map(value => required(value, EMAIL, 'Recipient'));
  if (typeof subject !== 'string' || !subject || subject.length > 160 || /[\r\n]/.test(subject)) {
    throw new Error('Subject is not valid');
  }
  if (typeof body !== 'string' || !body || body.length > 5000) throw new Error('Body is not valid');
  // encodeURIComponent keeps spaces as %20 across an Outlook sign-in redirect.
  // The compose deep link treats the body as plain text, not HTML.
  const query = [
    ...(recipients.length ? [`to=${encodeURIComponent(recipients.join(','))}`] : []),
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
  ].join('&');
  return `${OUTLOOK_COMPOSE}?${query}`;
}

function validatedProviderSource(source, nowMs) {
  if (!freshComposeSource(source?.sourceObservedAtUtc, nowMs)) {
    throw new Error('Current work order source is required');
  }
  const id = required(source?.nativeWoId, WO_ID, 'Work order ID');
  const number = required(source?.displayWoNumber, WO_NUMBER, 'Work order number');
  const agent = required(source?.agentCode, AGENT_CODE, 'Agent code').toUpperCase();
  if (source?.type !== 'Installation' || source?.eligible !== true) {
    throw new Error('Only a selected, eligible installation work order can open this review');
  }
  const suggestions = source?.suggestedRecipients ?? [];
  if (!Array.isArray(suggestions) || ![0, 2].includes(suggestions.length)) {
    throw new Error('Provider contact pair is not valid');
  }
  const to = suggestions.map(address => required(address, EMAIL, 'Provider recipient'));
  if (to.length === 2 && to[0].toLowerCase() === to[1].toLowerCase()) {
    throw new Error('Provider contact pair is not distinct');
  }
  return {id, number, agent, to};
}

export function validateProviderHandoff(source, nowMs = Date.now()) {
  return Object.freeze({kind: 'provider', id: validatedProviderSource(source, nowMs).id});
}

export function buildProviderCompose(source, nowMs = Date.now()) {
  const {id, number, agent, to} = validatedProviderSource(source, nowMs);
  const lines = PICOS_PARTS.flatMap(part => [
    `- ${part.code} ${part.name} (myCoke material ${part.material})`,
    `${part.url} `, // Trailing whitespace helps Outlook recognize a complete URL.
  ]);
  const body = [
    'Hello,',
    '',
    `For Arby's installation work order ${number} assigned to SP agent ${agent}, please order each of the six myCoke parts below for this installation before the work date. The stainless chase quantity is two if this visit needs two. If an item is already on hand or does not fit this visit, reply with that exception before placing a duplicate or unsuitable order. Verify the current service date in Thirsty.`,
    '',
    ...lines,
    '',
    'Please confirm item details and quantities, then reply with what you ordered, the order reference, and expected delivery date. If the date or scope changed, please update the work order in Thirsty.',
  ].join('\r\n');
  const subject = `Arby's WO ${number} | Provider parts review`;
  return Object.freeze({kind: 'provider', id, subject, body, to: Object.freeze(to),
    url: buildOutlookComposeUrl({subject, body, to})});
}

function validatedCustomerSource(project, binding, nowMs) {
  if (!freshComposeSource(binding?.trackerLastVerifiedAtUtc, nowMs)) {
    throw new Error('Current customer release source is required');
  }
  const key = required(project?.formSourceKey, FORM_KEY, 'FORM source key');
  if (project?.eligible !== true || binding?.formSourceKey !== key ||
      binding?.storeNumber !== project.storeNumber) {
    throw new Error('Customer project and protected link do not match');
  }
  const email = required(binding.recipientEmail, EMAIL, 'Customer recipient');
  const tracker = validateCustomerTrackerUrl(binding.trackerUrl);
  return {key, email, tracker};
}

export function validateCustomerHandoff(project, binding, nowMs = Date.now()) {
  return Object.freeze({kind: 'customer', id: validatedCustomerSource(project, binding, nowMs).key});
}

export function buildCustomerCompose(project, binding, nowMs = Date.now()) {
  const {key, email, tracker} = validatedCustomerSource(project, binding, nowMs);
  const subject = "Thank you for your Arby's work request";
  const body = [
    'Hello,',
    '',
    "Thank you for reaching out to Coca-Cola and submitting your Arby's work request. We are working with the team on the next steps.",
    '',
    'You can follow your project progress at this private link:',
    `${tracker} `,
    '',
    'You can open it at any time for the latest available update. If you have questions, please reply to this email.',
    '',
    'Cheers,',
    "Coca-Cola Arby's Operations",
  ].join('\r\n');
  return Object.freeze({kind: 'customer', id: key, subject, body, to: Object.freeze([email]),
    url: buildOutlookComposeUrl({subject, body, to: [email]})});
}
