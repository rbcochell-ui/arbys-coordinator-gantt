import {PICOS_PARTS} from './parts.mjs';
import {encodeComposeUris} from './encoding.mjs';
import {providerCommitment, exactCommitment} from './provider_commitment.mjs';
import {PROVIDER_COMMITMENTS} from './provider_pins.mjs';
import {decryptSelectedFormOnlyBinding} from
  './form_only_binding.mjs';

// Pure source-review candidate. Importing this module performs no I/O and
// nothing in the published Gantt imports it. No function sends an email.
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTACT_MAX_AGE_MS = 30 * DAY_MS;
const PREINSTALL = new Set(['Pending Scheduled Date', 'Pending Readiness']);
const TRACKER_ORIGIN = 'https://rbcochell-ui.github.io';
const unheld = value => value === false || value === 0 || value === '0';
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/u;

export class ComposeHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ComposeHeldError';
    this.code = code;
  }
}

function text(value, field, pattern, maxLength = 254) {
  if (typeof value !== 'string') throw new ComposeHeldError(`INVALID_${field}`);
  const answer = value.trim();
  if (!answer || answer.length > maxLength || /[\u0000-\u001f\u007f]/u.test(answer) ||
      (pattern && !pattern.test(answer))) throw new ComposeHeldError(`INVALID_${field}`);
  return answer;
}

function email(value, field) {
  // Mailto recipients are placed in its path. Reject reserved URI delimiters
  // instead of trusting a mail client to interpret an encoded addr-spec.
  return text(value, field,
    /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u).toLowerCase();
}

function fresh(observed, expires, nowMs, code, maxAgeMs = DAY_MS) {
  const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u;
  if (typeof observed !== 'string' || typeof expires !== 'string' ||
      !utc.test(observed) || !utc.test(expires)) {
    throw new ComposeHeldError(code);
  }
  const observedMs = Date.parse(observed ?? '');
  const expiresMs = Date.parse(expires ?? '');
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs) ||
      !Number.isFinite(expiresMs) || observedMs > nowMs + 60_000 ||
      nowMs - observedMs > maxAgeMs || expiresMs <= nowMs ||
      expiresMs <= observedMs || expiresMs - observedMs > maxAgeMs + 60_000) {
    throw new ComposeHeldError(code);
  }
}

function recent(value, nowMs, code, maxAgeMs) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(value)) {
    throw new ComposeHeldError(code);
  }
  const checkedMs = Date.parse(value ?? '');
  if (!Number.isFinite(checkedMs) || checkedMs > nowMs + 60_000 ||
      nowMs - checkedMs > maxAgeMs) throw new ComposeHeldError(code);
}

function absoluteMyCokeLinks(body) {
  return PICOS_PARTS.every(part => body.includes(`${part.url}\n`));
}

function formatProviderCompose(input, nowMs) {
  if (input?.workOrderType !== 'Installation' ||
      input?.activityType !== 'Installation' ||
      !PREINSTALL.has(input?.status) || !unheld(input?.hold)) {
    throw new ComposeHeldError('WO_NOT_READY');
  }
  fresh(input.sourceObservedAtUtc, input.sourceValidUntilUtc, nowMs,
    'WO_SOURCE_STALE');
  recent(input.contactVerifiedAtUtc, nowMs, 'CONTACT_STALE',
    CONTACT_MAX_AGE_MS);
  const nativeWoId = text(input.nativeWoId, 'NATIVE_WO_ID', /^0WO[A-Za-z0-9]{15}$/u);
  const number = text(input.workOrderNumber, 'WO_NUMBER', /^[0-9]{5,12}$/u);
  const store = text(input.storeNumber, 'STORE', /^[0-9]{1,7}$/u);
  const acn = text(input.acn, 'ACN', /^[0-9]{4,12}$/u);
  const agent = text(input.agentCode, 'AGENT_CODE', /^[A-Za-z][A-Za-z0-9]{0,9}$/u).toUpperCase();
  const assignedSp = text(input.assignedSpName, 'ASSIGNED_SP', null, 160);
  const embeddedAgent = assignedSp.split(/[-_]/u)[0].trim().toUpperCase();
  if (embeddedAgent !== agent ||
      typeof input.contactAgentCode !== 'string' ||
      input.contactAgentCode.toUpperCase() !== agent ||
      input.chartStoreNumber !== store || input.chartAcn !== acn) {
    throw new ComposeHeldError('WO_IDENTITY_MISMATCH');
  }
  const manager = email(input.installManagerEmail, 'INSTALL_MANAGER_EMAIL');
  const planner = email(input.plannerEmail, 'PLANNER_EMAIL');
  if (manager === planner) throw new ComposeHeldError('CONTACT_ROLES_NOT_DISTINCT');
  const to = Object.freeze([manager, planner]);
  const subject = `Arby's WO ${number} | Provider parts review`;
  const lines = PICOS_PARTS.flatMap(part => [
    `- ${part.code} ${part.name} (myCoke material ${part.material})`,
    part.url,
    '',
  ]);
  const body = [
    'Hello,',
    '',
    `For Arby's installation work order ${number} assigned to SP agent ${agent}, please order each of the six myCoke parts below for this installation before the work date. The stainless chase quantity is two if this visit needs two. If an item is already on hand or does not fit this visit, reply with that exception before placing a duplicate or unsuitable order. Verify the current service date in Thirsty.`,
    '',
    ...lines,
    'Please confirm item details and quantities, then reply with what you ordered, the order reference, and expected delivery date. If the date or scope changed, please update the work order in Thirsty.',
    '',
  ].join('\n');
  if (!absoluteMyCokeLinks(body)) throw new ComposeHeldError('PART_LINKS_MISSING');
  const links = encodeComposeUris(to, subject, body);
  return Object.freeze({
    kind: 'provider', nativeWoId, storeNumber: store, acn, agentCode: agent,
    to, subject, body: links.body, links,
    reviewNote: 'A new compose window may create another draft. Verify both recipients, all six clickable links, current Thirsty status and date before sending.',
  });
}

function trackerUrl(value) {
  let url;
  if (typeof value !== 'string') throw new ComposeHeldError('TRACKER_URL_INVALID');
  try { url = new URL(value); } catch { throw new ComposeHeldError('TRACKER_URL_INVALID'); }
  const query = [...url.searchParams.entries()];
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (url.origin !== TRACKER_ORIGIN ||
      url.pathname !== '/arbys-customer-status-preview/' ||
      url.username || url.password || query.length !== 1 ||
      query[0][0] !== 'p' || !/^p_[0-9a-f]{32}$/u.test(query[0][1]) ||
      fragment.length !== 1 || fragment[0][0] !== 'k' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(fragment[0][1])) {
    throw new ComposeHeldError('TRACKER_URL_INVALID');
  }
  return url.href;
}

function formatCustomerCompose(binding, selectedFormKey, chartStoreNumber,
    nowMs) {
  // Only the pinned decoder may hand us a FORM-only binding. The static page
  // cannot treat a caller-provided URL or a boolean "verified" flag as proof.
  if (binding?.releaseState !== 'HELD_UNISSUED' ||
      binding?.recipientReview !== 'suggestion_only_unverified' ||
      binding?.templatePolicy?.schema !==
        'arbys-gantt-form-only-template-policy/v1' ||
      binding.templatePolicy.mode !== 'template_only' ||
      binding.templatePolicy.maxSourceAgeDays !== 30 ||
      binding.templatePolicy.sourceDateDisplayRequired !== true ||
      binding.templatePolicy.coordinatorVerificationBeforeSend !== true ||
      binding.templatePolicy.pageStatusClaim !== 'FORM_RECEIVED_ONLY' ||
      binding.templatePolicy.freshWorkOrderClaimAllowed !== false) {
    throw new ComposeHeldError('CUSTOMER_TRACKER_UNISSUED');
  }
  fresh(binding.sourceAsOfUtc, binding.validUntilUtc, nowMs,
    'FORM_SOURCE_STALE', 30 * DAY_MS);
  const formSourceKey = text(binding.formSourceKey, 'FORM_SOURCE_KEY', FORM_KEY);
  if (formSourceKey !== selectedFormKey) {
    throw new ComposeHeldError('FORM_IDENTITY_MISMATCH');
  }
  const store = binding.storeNumber === null ? null :
    text(binding.storeNumber, 'STORE', /^[0-9]{1,7}$/u);
  const chartStoreUnknown = chartStoreNumber === null ||
    chartStoreNumber === '' ||
    (typeof chartStoreNumber === 'string' &&
      chartStoreNumber.trim().toLowerCase() === 'unknown');
  if ((store === null && !chartStoreUnknown) ||
      (store !== null && chartStoreNumber !== store)) {
    throw new ComposeHeldError('FORM_STORE_MISMATCH');
  }
  const name = text(binding.recipientName, 'PRIMARY_CONTACT_NAME', null, 120);
  const recipient = email(binding.recipientEmail, 'PRIMARY_CONTACT_EMAIL');
  const link = trackerUrl(binding.trackerUrl);
  const subject = "Thank you for your Arby's work request";
  const body = [
    name ? `Hi ${name},` : 'Hello,',
    '',
    "Thank you for the Arby's work request. Coca-Cola has received it and is working with the team on the next steps.",
    '',
    'You can follow verified updates for your project here:',
    link,
    '',
    'The page currently confirms that we received your request. Work-order milestones will appear when they are verified.',
    '',
    'If you have any questions, please reply to this email.',
    '',
    "Cheers,",
    "Coca-Cola Arby's Operations",
    '',
  ].join('\n');
  const links = encodeComposeUris([recipient], subject, body);
  return Object.freeze({
    kind: 'customer', formSourceKey, storeNumber: store,
    storeDisplay: store ?? 'Unknown', to: Object.freeze([recipient]),
    subject, body: links.body, trackerUrl: link, links,
    issuanceState: 'UNSENT_TEMPLATE',
    reviewNote: `FORM Primary Contact is a suggested recipient from ${binding.sourceAsOfUtc}. Verify the requester, private project link, and current status before Send. Opening again may create another draft.`,
  });
}

/** Public-facing provider entry. It cannot format an arbitrary caller record. */
export async function preparePinnedProviderCompose(selectedNativeWoId, input,
    selectionDigest) {
  if (typeof selectedNativeWoId !== 'string' ||
      !/^0WO[A-Za-z0-9]{15}$/u.test(selectedNativeWoId)) {
    throw new ComposeHeldError('INVALID_SELECTED_WO');
  }
  // The public pin is keyed by an opaque HMAC of the exact selected WO under
  // this Gantt capability, rather than exposing the native ID in source.
  const pin = PROVIDER_COMMITMENTS[selectionDigest];
  if (!pin) throw new ComposeHeldError('PROVIDER_PIN_UNRELEASED');
  // Read each caller field exactly once. A getter or Proxy must not be able
  // to return pinned contacts for hashing and different contacts for output.
  let source;
  try {
    source = Object.freeze({
    nativeWoId: input.nativeWoId,
    workOrderNumber: input.workOrderNumber,
    storeNumber: input.storeNumber,
    chartStoreNumber: input.chartStoreNumber,
    acn: input.acn,
    chartAcn: input.chartAcn,
    agentCode: input.agentCode,
    assignedSpName: input.assignedSpName,
    contactAgentCode: input.contactAgentCode,
    installManagerEmail: input.installManagerEmail,
    plannerEmail: input.plannerEmail,
    contactVerifiedAtUtc: input.contactVerifiedAtUtc,
    contactRecordSha256: input.contactRecordSha256,
    workOrderType: input.workOrderType,
    activityType: input.activityType,
    status: input.status,
    hold: input.hold,
    spActivityDate: input.spActivityDate,
    sourceRowSha256: input.sourceRowSha256,
    sourceObservedAtUtc: input.sourceObservedAtUtc,
    sourceValidUntilUtc: input.sourceValidUntilUtc,
    });
  } catch {
    throw new ComposeHeldError('PROVIDER_SOURCE_INVALID');
  }
  let digest;
  try { digest = await providerCommitment(source); }
  catch { throw new ComposeHeldError('PROVIDER_SOURCE_INVALID'); }
  if (!exactCommitment(digest, pin) || source.nativeWoId !== selectedNativeWoId) {
    throw new ComposeHeldError('PROVIDER_BINDING_MISMATCH');
  }
  return formatProviderCompose(source, Date.now());
}

/** The selected local bundle is checked by the pinned publisher signature,
 * chart-key encryption and an independent exact FORM-key/full-URL commitment.
 * The commitment map is empty in this HELD packet, so all 39 entries stop.
 */
export async function prepareSignedCustomerCompose(parsedBundle, chartKeyBytes,
    selectedFormKey, chartStoreNumber) {
  if (typeof selectedFormKey !== 'string' || !FORM_KEY.test(selectedFormKey)) {
    throw new ComposeHeldError('INVALID_SELECTED_FORM');
  }
  let binding;
  try {
    binding = await decryptSelectedFormOnlyBinding(parsedBundle,
      chartKeyBytes, {kind: 'customer', id: selectedFormKey});
  } catch {
    throw new ComposeHeldError('CUSTOMER_BINDING_UNRELEASED');
  }
  return formatCustomerCompose(binding, selectedFormKey, chartStoreNumber,
    Date.now());
}

// Future UI integration must replace this hold only after an attended Outlook
// readback and an explicit decision on duplicate-draft/receipt semantics.
export function requestDirectComposeHeld(_input, _navigate) {
  throw new ComposeHeldError('DIRECT_COMPOSE_RELEASE_HELD');
}
