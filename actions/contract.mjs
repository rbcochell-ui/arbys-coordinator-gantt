// Source-only contract for the GitHub-hosted Arby's coordinator Gantt.
// The public iframe may request an action by ID. Only trusted parent code may
// resolve current private source data and call the functions in this module.

export class HeldActionError extends Error {
  constructor(code, message = 'Action held for review') {
    super(message);
    this.name = 'HeldActionError';
    this.code = code;
  }
}

export const DISPATCH_HEADER = 'x-arbys-dispatch-key';
export const GRAPH_SCOPES = Object.freeze({
  profile: Object.freeze(['User.Read']),
  mail: Object.freeze(['Mail.ReadWrite']),
  // Admin consent plus an explicit app grant on this one List are required.
  ledger: Object.freeze(['Lists.SelectedOperations.Selected']),
});

// The source resolver's own expiration is an upper bound, not permission to
// carry an old receipt indefinitely. Re-read and re-evaluate before POST.
export const MAX_SOURCE_AGE_MS = 15 * 60 * 1000;
export const MAX_SOURCE_VALIDITY_SPAN_MS = 30 * 60 * 1000;

export const PICOS_PARTS = Object.freeze([
  Object.freeze({code: '125124', name: 'Bundled Tubing', material: '3517264', url: 'https://www.mycoke.com/product/tubing-fs-16ln-14-38-2-12-re-bndl/01tPY000009IyzqYAC'}),
  Object.freeze({code: '29915', name: 'Stainless Chase (two if needed)', material: '3510205', url: 'https://www.mycoke.com/product/chase-4in-x-4in-x-48in-assy-ss/01tPY000009IqcYYAS'}),
  Object.freeze({code: '122795', name: 'Water Shut-off', material: '3523343', url: 'https://www.mycoke.com/product/valve-shutoff-12in-barb-gray/01tPY000009J5DJYA0'}),
  Object.freeze({code: '21191', name: 'Inlet Shut-off 3/8', material: '3524217', url: 'https://www.mycoke.com/product/valveshut-off-38in-barb/01tPY000009IpEzYAK'}),
  Object.freeze({code: '148791', name: "Valve Decal Kit for Lit LEV; verify current Arby's installation kit fit", material: '3514278', url: 'https://www.mycoke.com/product/kit-arbys-new-equipment-installati/01tPY000009IQq6YAG'}),
  Object.freeze({code: '148136', name: 'Water Lever', material: '3508899', url: 'https://www.mycoke.com/product/leverwatersfv1uf1extendedlit/01tPY000009JjlqYAC'}),
]);

export function escaped(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function requiredText(value, name, pattern, maxLength = 255) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || (pattern && !pattern.test(text))) {
    throw new HeldActionError(`INVALID_${name.toUpperCase()}`, `${name} is not valid`);
  }
  return text;
}

export function email(value) {
  const address = requiredText(value, 'email', /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/, 254).toLowerCase();
  if (/[\r\n]/.test(address)) throw new HeldActionError('INVALID_EMAIL');
  return address;
}

export function providerDispatchKey(nativeWoId, revision = 1) {
  const id = requiredText(nativeWoId, 'native_wo_id', /^[A-Za-z0-9]{15,18}$/);
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 99) throw new HeldActionError('INVALID_REVISION');
  // The agent code is deliberately absent. Reassignment must not silently
  // create a second first-release dispatch for the same work order.
  return `AP-${id}-v${revision}`;
}

export function customerDispatchKey(formSourceKey, revision = 1) {
  const key = requiredText(formSourceKey, 'form_source_key', /^F:[0-9]+:[0-9]+$/);
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 99) throw new HeldActionError('INVALID_REVISION');
  return `CT-${key.slice(2).replace(':', '-')}-v${revision}`;
}

function verifySourceWindow(source, nowMs) {
  const receipt = requiredText(source?.receiptSha256, 'source_receipt', /^[0-9a-f]{64}$/);
  const verifiedAtMs = Date.parse(source?.verifiedAtUtc ?? '');
  const validUntilMs = Date.parse(source?.validUntilUtc ?? '');
  if (!Number.isFinite(verifiedAtMs) || !Number.isFinite(validUntilMs) ||
      verifiedAtMs > nowMs + 60_000 || validUntilMs <= nowMs || validUntilMs <= verifiedAtMs ||
      nowMs - verifiedAtMs > MAX_SOURCE_AGE_MS ||
      validUntilMs - verifiedAtMs > MAX_SOURCE_VALIDITY_SPAN_MS) {
    throw new HeldActionError('SOURCE_WINDOW_EXPIRED', 'A fresh source read is required');
  }
  return receipt;
}

export function buildProviderIntent(source, nowMs = Date.now()) {
  const receiptSha256 = verifySourceWindow(source, nowMs);
  if (source?.kind !== 'Installation' || source?.readyForPartsDraft !== true || source?.hold === true) {
    throw new HeldActionError('WO_NOT_READY', 'Current work-order source has not cleared this draft');
  }
  const nativeWoId = requiredText(source.nativeWoId, 'native_wo_id', /^[A-Za-z0-9]{15,18}$/);
  const displayWoNumber = requiredText(source.displayWoNumber, 'wo_number', /^[0-9]{5,12}$/);
  const agentCode = requiredText(source.agentCode, 'agent_code', /^[A-Za-z][A-Za-z0-9]{0,9}$/).toUpperCase();
  const installManagerEmail = email(source.installManagerEmail);
  const plannerEmail = email(source.plannerEmail);
  const to = [...new Set([installManagerEmail, plannerEmail])];
  const dispatchKey = providerDispatchKey(nativeWoId, source.dispatchRevision ?? 1);
  const parts = PICOS_PARTS.map(part =>
    `<li><a href="${escaped(part.url)}">${escaped(part.code)} ${escaped(part.name)}</a> (myCoke material ${escaped(part.material)})</li>`
  ).join('');
  const htmlBody = `<p>Hello,</p><p>For Arby's installation work order <strong>${escaped(displayWoNumber)}</strong> assigned to SP agent <strong>${escaped(agentCode)}</strong>, please order each of the six myCoke parts below for this installation before the work date. The stainless chase quantity is two if this visit needs two. If an item is already on hand or does not fit this visit, reply with that exception before placing a duplicate or unsuitable order. Verify the current service date in Thirsty.</p><ul>${parts}</ul><p>Please confirm item details and quantities, then reply with what you ordered, the order reference, and expected delivery date. If the date or scope changed, please update the work order in Thirsty.</p>`;
  return Object.freeze({kind: 'provider', dispatchKey, entityId: nativeWoId, receiptSha256,
    subject: `Arby's WO ${displayWoNumber} | Provider parts review`, htmlBody, to,
    requiredLinks: PICOS_PARTS.map(part => part.url)});
}

export function validateCustomerTrackerUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new HeldActionError('INVALID_CUSTOMER_TRACKER_URL'); }
  const query = [...url.searchParams.entries()];
  const fragment = [...new URLSearchParams(url.hash.slice(1)).entries()];
  if (url.origin !== 'https://rbcochell-ui.github.io' ||
      url.pathname !== '/arbys-customer-status-preview/track.html' ||
      query.length !== 1 || query[0][0] !== 'p' || !/^p_[0-9a-f]{32}$/.test(query[0][1]) ||
      fragment.length !== 1 || fragment[0][0] !== 'k' || !/^[A-Za-z0-9_-]{43}$/.test(fragment[0][1]) ||
      url.username || url.password) {
    throw new HeldActionError('INVALID_CUSTOMER_TRACKER_URL');
  }
  return url.href;
}

export function buildCustomerIntent(source, nowMs = Date.now()) {
  const receiptSha256 = verifySourceWindow(source, nowMs);
  if (source?.releaseState !== 'Ready' || source?.readyForCustomerDraft !== true) {
    throw new HeldActionError('CUSTOMER_RELEASE_NOT_READY');
  }
  const formSourceKey = requiredText(source.formSourceKey, 'form_source_key', /^F:[0-9]+:[0-9]+$/);
  const customerEmail = email(source.customerEmail);
  const customerName = requiredText(source.customerName, 'customer_name', null, 120);
  const trackerUrl = validateCustomerTrackerUrl(source.trackerUrl);
  const dispatchKey = customerDispatchKey(formSourceKey, source.dispatchRevision ?? 1);
  const htmlBody = `<p>Hi ${escaped(customerName)},</p><p>Thank you for reaching out to Coca-Cola and submitting your Arby's work request. We're working with the team on the next steps.</p><p><a href="${escaped(trackerUrl)}">Follow your project progress here</a>. You can open this link at any time for the latest available update.</p><p>If you have any questions, please reply to this email.</p><p>Cheers,<br>Coca-Cola Arby's Operations</p>`;
  return Object.freeze({kind: 'customer', dispatchKey, entityId: formSourceKey,
    receiptSha256, subject: "Thank you for your Arby's work request", htmlBody,
    to: [customerEmail], requiredLinks: [trackerUrl]});
}

export async function intentDigest(intent) {
  const payload = JSON.stringify({kind: intent.kind, dispatchKey: intent.dispatchKey,
    entityId: intent.entityId, receiptSha256: intent.receiptSha256,
    subject: intent.subject, htmlBody: intent.htmlBody, to: intent.to});
  const bytes = new TextEncoder().encode(payload);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
