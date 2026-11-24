// A release may pin a SHA-256 commitment for one reviewed native WO. The
// commitment binds its source status and exact two contact roles. It is not
// secret; it is meaningful only when compared with a trusted immutable pin.
const HEX = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u;

function field(value, name, pattern, allowNull = false) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/u.test(value) ||
      (pattern && !pattern.test(value))) throw new TypeError(`Invalid ${name}`);
  return value;
}

export function providerCommitmentPayload(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid provider source');
  }
  const id = field(input.nativeWoId, 'native WO ID', /^0WO[A-Za-z0-9]{15}$/u);
  const manager = field(input.installManagerEmail, 'manager email',
    /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u).toLowerCase();
  const planner = field(input.plannerEmail, 'planner email',
    /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u).toLowerCase();
  if (manager === planner) throw new TypeError('Roles must be distinct');
  const hold = input.hold === false || input.hold === 0 || input.hold === '0'
    ? '0' : input.hold === true || input.hold === 1 || input.hold === '1'
      ? '1' : null;
  if (hold === null) throw new TypeError('Hold is unverified');
  return Object.freeze({
    domain: 'arbys-direct-provider-compose-pin/v2',
    nativeWoId: id,
    workOrderNumber: field(input.workOrderNumber, 'WO number', /^[0-9]{5,12}$/u),
    storeNumber: field(input.storeNumber, 'store', /^[0-9]{1,7}$/u),
    outletAcn: field(input.acn, 'ACN', /^[0-9]{4,12}$/u),
    agentCode: field(input.agentCode, 'agent', /^[A-Z][A-Z0-9]{0,9}$/u),
    assignedSpName: field(input.assignedSpName, 'assigned SP', null),
    workOrderType: field(input.workOrderType, 'WO type', null),
    activityType: field(input.activityType, 'activity type', null),
    status: field(input.status, 'status', null),
    hold,
    spActivityDate: field(input.spActivityDate, 'SP date', null, true),
    sourceObservedAtUtc: field(input.sourceObservedAtUtc, 'source time', UTC),
    sourceValidUntilUtc: field(input.sourceValidUntilUtc, 'source expiry', UTC),
    sourceRowSha256: field(input.sourceRowSha256, 'source digest', HEX),
    contactVerifiedAtUtc: field(input.contactVerifiedAtUtc, 'contact time', UTC),
    contactRecordSha256: field(input.contactRecordSha256, 'contact digest', HEX),
    contactAgentCode: field(input.contactAgentCode, 'contact agent', /^[A-Z][A-Z0-9]{0,9}$/u),
    installManagerEmail: manager,
    plannerEmail: planner,
  });
}

export async function providerCommitment(input) {
  if (!globalThis.crypto?.subtle) throw new Error('Browser cryptography unavailable');
  const canonical = JSON.stringify(providerCommitmentPayload(input));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function exactCommitment(actual, trusted) {
  return typeof actual === 'string' && HEX.test(actual) &&
    typeof trusted === 'string' && HEX.test(trusted) && actual === trusted;
}
