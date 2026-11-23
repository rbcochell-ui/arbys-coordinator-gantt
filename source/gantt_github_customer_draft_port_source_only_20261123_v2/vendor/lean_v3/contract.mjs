export class HeldActionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'HeldActionError';
    this.code = code;
  }
}

export const GRAPH_SCOPES = Object.freeze({
  identity: Object.freeze(['User.Read']),
  lists: Object.freeze(['Lists.SelectedOperations.Selected']),
  mail: Object.freeze(['Mail.ReadWrite']),
});
export const CORRELATION_HEADER = 'x-arbys-correlation-id';
export const SITE_URL = 'https://groups.coca-cola.com/sites/ArbysOperations';
export const MAX_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_CONTACT_REVIEW_AGE_MS = 30 * MAX_SOURCE_AGE_MS;
export const MAX_CONTACT_CHECK_AGE_MS = 7 * MAX_SOURCE_AGE_MS;
export const MAX_READ_WINDOW_MS = 15 * 60 * 1000;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE_ID = /^groups\.coca-cola\.com,[0-9a-f-]{36},[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const TERMINAL = /(?:^|[\s-])(?:hld|hold|closed|complete|completed|cancel|cancelled|canceled|terminated)(?:$|[\s-])/i;

export function assertActiveConfig(config, action = 'provider') {
  if (!['provider', 'customer'].includes(action) ||
      config?.enabled !== true ||
      config?.occupiedPilotClaimsMigrated !== true ||
      !GUID.test(config.tenantId ?? '') || !GUID.test(config.clientId ?? '') ||
      !SITE_ID.test(config.siteId ?? '') ||
      !config?.lists ||
      ![...(action === 'provider' ? ['woSource', 'verifiedContacts'] :
        ['customerReleases']), 'claims', 'receipts'].every(name =>
        GUID.test(config.lists[name] ?? '')) ||
      new Set([...(action === 'provider' ? ['woSource', 'verifiedContacts'] :
        ['customerReleases']), 'claims', 'receipts'].map(name =>
        config.lists[name].toLowerCase())).size !==
        (action === 'provider' ? 4 : 3) ||
      !Array.isArray(config.coordinatorOids) || !config.coordinatorOids.length ||
      !config.coordinatorOids.every(id => GUID.test(id))) {
    throw new HeldActionError('RUNTIME_NOT_RELEASED');
  }
  if (action === 'provider' && (config?.providerEnabled !== true ||
      !Array.isArray(config.eligibleRawSpStatuses) ||
      !Array.isArray(config.eligibleWorkOrderStatuses) ||
      !config.eligibleWorkOrderStatuses.length ||
      !Array.isArray(config.eligibleServiceTypeCodes) ||
      !config.eligibleServiceTypeCodes.length ||
      config.eligibleServiceTypeCodes.some(value =>
        typeof value !== 'string' || !/^[A-Z0-9]{1,3}$/.test(value)) ||
      !Array.isArray(config.eligibleWorkOrderTypes) ||
      !config.eligibleWorkOrderTypes.length ||
      config.eligibleWorkOrderTypes.some(value =>
        typeof value !== 'string' || !value || value !== value.trim()) ||
      [...config.eligibleRawSpStatuses, ...config.eligibleWorkOrderStatuses].some(value =>
        typeof value !== 'string' || !value || value !== value.trim() || TERMINAL.test(value)))) {
    throw new HeldActionError('RUNTIME_NOT_RELEASED');
  }
  if (action === 'customer' && (config?.customerEnabled !== true ||
      !Array.isArray(config.releaseOwnerOids) ||
      !config.releaseOwnerOids.length ||
      !config.releaseOwnerOids.every(id => GUID.test(id)) ||
      !Array.isArray(config.approvedCustomerReleaseKinds) ||
      !config.approvedCustomerReleaseKinds.length ||
      !config.approvedCustomerReleaseKinds.every(value =>
        typeof value === 'string' && value.length <= 80 &&
        /^[A-Za-z0-9/_-]+$/.test(value)))) {
    throw new HeldActionError('RUNTIME_NOT_RELEASED');
  }
  return config;
}

export function email(value) {
  if (typeof value !== 'string' || value !== value.trim() ||
      value.length > 254 || !EMAIL.test(value)) throw new HeldActionError('EMAIL_INVALID');
  return value.toLowerCase();
}

export function canonicalSalesforceId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{18}$/.test(value)) {
    throw new HeldActionError('NATIVE_WO_ID_INVALID');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/.test(value[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  if (value.slice(15) !== suffix) throw new HeldActionError('NATIVE_WO_ID_INVALID');
  return value;
}

export function canonicalFormSourceKey(value) {
  // customer-tracker: + FORM key + |SentAttempt must fit a 255-character key.
  if (typeof value !== 'string' || value.length > 226 ||
      !/^F:[1-9][0-9]*:[1-9][0-9]*$/.test(value)) {
    throw new HeldActionError('FORM_SOURCE_KEY_INVALID');
  }
  return value;
}

export function providerDispatchKey(nativeWoId) {
  return `provider-parts:${canonicalSalesforceId(nativeWoId)}`;
}

export function customerDispatchKey(formSourceKey) {
  return `customer-tracker:${canonicalFormSourceKey(formSourceKey)}`;
}

export function receiptKey(dispatchKey, kind) {
  if (!['Draft', 'SentAttempt', 'Sent'].includes(kind) ||
      typeof dispatchKey !== 'string' ||
      dispatchKey.length + kind.length + 1 > 255) {
    throw new HeldActionError('RECEIPT_KEY_INVALID');
  }
  return `${dispatchKey}|${kind}`;
}

export function assertEligibleStatus(wo, config) {
  // SourceComplete is the current writer's attestation that the source Hold
  // field was explicitly checked as 0. Optional raw projections, when present,
  // must corroborate it. Unknown or terminal normalized status never passes.
  if (wo?.SourceComplete !== true ||
      (wo.SourceHoldFlag !== null && wo.SourceHoldFlag !== '0') ||
      (wo.RawSPStatus !== null &&
        (typeof wo.RawSPStatus !== 'string' || TERMINAL.test(wo.RawSPStatus) ||
         !config.eligibleRawSpStatuses.includes(wo.RawSPStatus))) ||
      typeof wo?.WorkOrderStatus !== 'string' || TERMINAL.test(wo.WorkOrderStatus) ||
      !config.eligibleWorkOrderStatuses.includes(wo.WorkOrderStatus)) {
    throw new HeldActionError('WO_STATUS_HELD');
  }
}

export const PICOS_PARTS = Object.freeze([
  Object.freeze({code: '125124', name: 'Bundled Tubing', material: '3517264', url: 'https://www.mycoke.com/product/tubing-fs-16ln-14-38-2-12-re-bndl/01tPY000009IyzqYAC'}),
  Object.freeze({code: '29915', name: 'Stainless Chase (two if needed)', material: '3510205', url: 'https://www.mycoke.com/product/chase-4in-x-4in-x-48in-assy-ss/01tPY000009IqcYYAS'}),
  Object.freeze({code: '122795', name: 'Water Shut-off', material: '3523343', url: 'https://www.mycoke.com/product/valve-shutoff-12in-barb-gray/01tPY000009J5DJYA0'}),
  Object.freeze({code: '21191', name: 'Inlet Shut-off 3/8', material: '3524217', url: 'https://www.mycoke.com/product/valveshut-off-38in-barb/01tPY000009IpEzYAK'}),
  Object.freeze({code: '148791', name: "Valve Decal Kit for Lit LEV; verify current Arby's installation kit fit", material: '3514278', url: 'https://www.mycoke.com/product/kit-arbys-new-equipment-installati/01tPY000009IQq6YAG'}),
  Object.freeze({code: '148136', name: 'Water Lever', material: '3508899', url: 'https://www.mycoke.com/product/leverwatersfv1uf1extendedlit/01tPY000009JjlqYAC'}),
]);

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export function buildProviderDraft(source) {
  const woNumber = source?.woNumber;
  const agentCode = source?.agentCode;
  if (typeof woNumber !== 'string' || !/^[0-9]{5,12}$/.test(woNumber) ||
      typeof agentCode !== 'string' || !/^[A-Z][A-Z0-9]{0,9}$/.test(agentCode) ||
      !Array.isArray(source?.to) || ![0, 2].includes(source.to.length) ||
      (source.to.length === 2 && source.to.map(email)[0] === source.to.map(email)[1])) {
    throw new HeldActionError('PROVIDER_DRAFT_SOURCE_INVALID');
  }
  const parts = PICOS_PARTS.map(part =>
    `<li><a href="${escapeHtml(part.url)}">${escapeHtml(part.code)} ${escapeHtml(part.name)}</a> (myCoke material ${escapeHtml(part.material)})</li>`
  ).join('');
  const htmlBody = `<p>Hello,</p><p>For Arby's installation work order <strong>${escapeHtml(woNumber)}</strong> assigned to SP agent <strong>${escapeHtml(agentCode)}</strong>, please order each of the six myCoke parts below for this installation before the work date. The stainless chase quantity is two if this visit needs two. If an item is already on hand or does not fit this visit, reply with that exception before placing a duplicate or unsuitable order. Verify the current service date in Thirsty.</p><ul>${parts}</ul><p>Please confirm item details and quantities, then reply with what you ordered, the order reference, and expected delivery date. If the date or scope changed, please update the work order in Thirsty.</p>`;
  return Object.freeze({
    subject: `Arby's WO ${woNumber} | Provider parts review`,
    htmlBody,
    to: Object.freeze(source.to.map(email)),
    requiredLinks: Object.freeze(PICOS_PARTS.map(part => part.url)),
  });
}

export function validatedCustomerTrackerUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new HeldActionError('CUSTOMER_TRACKER_URL_INVALID');
  }
  let url;
  try { url = new URL(value); }
  catch { throw new HeldActionError('CUSTOMER_TRACKER_URL_INVALID'); }
  const query = [...url.searchParams.entries()];
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (url.origin !== 'https://rbcochell-ui.github.io' ||
      !['/arbys-customer-status-preview/',
        '/arbys-customer-status-preview/track.html'].includes(url.pathname) ||
      query.length !== 1 || query[0][0] !== 'p' ||
      !/^p_[0-9a-f]{32}$/.test(query[0][1]) ||
      fragment.length !== 1 || fragment[0][0] !== 'k' ||
      !/^[A-Za-z0-9_-]{43}$/.test(fragment[0][1]) ||
      url.username || url.password || value !== url.href) {
    throw new HeldActionError('CUSTOMER_TRACKER_URL_INVALID');
  }
  return value;
}

export function canonicalCustomerBody(fullPrivateUrl) {
  const link = validatedCustomerTrackerUrl(fullPrivateUrl);
  return '<p>Thank you for submitting your request to Coca-Cola.</p>' +
    `<p>To follow along with our progress, you can check <a href="${escapeHtml(link)}">your project tracker</a> anytime. ` +
    'If you have any questions, please reply to this email.</p>';
}

export function buildCustomerDraft(source) {
  const to = email(source?.recipientEmail);
  const trackerUrl = validatedCustomerTrackerUrl(source?.trackerUrl);
  const subject = source?.subject;
  if (typeof subject !== 'string' || !subject.trim() ||
      subject !== subject.trim() || subject.length > 255 ||
      /[\r\n]/.test(subject) || /https?:\/\//i.test(subject) ||
      source?.htmlBody !== canonicalCustomerBody(trackerUrl)) {
    throw new HeldActionError('CUSTOMER_DRAFT_SOURCE_INVALID');
  }
  return Object.freeze({subject, htmlBody: source.htmlBody,
    to: Object.freeze([to]), requiredLinks: Object.freeze([trackerUrl])});
}

export function validatedOutlookLink(value) {
  let url;
  try { url = new URL(value); } catch { throw new HeldActionError('OUTLOOK_LINK_INVALID'); }
  if (url.protocol !== 'https:' ||
      !['outlook.office.com', 'outlook.office365.com'].includes(url.hostname) ||
      url.username || url.password) throw new HeldActionError('OUTLOOK_LINK_INVALID');
  return url.href;
}
