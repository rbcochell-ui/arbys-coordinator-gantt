/**
 * Read-only provider preview from an already authenticated and decrypted
 * v18.10-style Gantt. The caller must supply an owner-approved HTML digest.
 * This module has no Graph, Outlook, SharePoint, or network dependency.
 */
export const SNAPSHOT_SCHEMA = 'arbys-local-exact-form-project-preview/v16';
export const OVERLAY_SCHEMA = 'ArbysProviderVisitSourceOverlay/v2';
export const MAX_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;

const SHA256 = /^[0-9a-f]{64}$/u;
const WO_ID = /^0WO[A-Za-z0-9]{15}$/u;
const AGENT_CODE = /^[A-Z][A-Z0-9]{0,9}$/u;
const WO_NUMBER = /^[0-9]{5,12}$/u;
const DIGITS = /^[0-9]+$/u;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const PREINSTALL = new Set(['Pending Readiness', 'Pending Scheduled Date']);
const INSTALL_CODES = new Set(['A', 'B', 'C', 'D', '3', '9', '8']);
const TERMINAL = /(?:^|[\s-])(?:hld|hold|held|closed|complete|completed|cancel|cancelled|canceled|terminated)(?:$|[\s-])/iu;
const BLOCKED_SP = /^(?:HLD|CMP|CNL|CNC|CLS)(?:\b|\s|-)/iu;
const THIRSTY_WO_BASE = 'https://hubit.my.salesforce.com/lightning/r/WorkOrder/';

export class SnapshotResolverError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SnapshotResolverError';
    this.code = code;
  }
}

function fail(code) { throw new SnapshotResolverError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function utcMillis(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}
function salesforceId(value) {
  if (typeof value !== 'string' || !WO_ID.test(value)) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(value[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return value.slice(15) === suffix;
}
function embeddedJson(html, id) {
  // The approved v18.10 HTML uses this exact marker. The release digest binds
  // the marker and JSON bytes before any field is trusted.
  const marker = `<script type="application/json" id="${id}">`;
  const first = html.indexOf(marker);
  if (first < 0 || html.indexOf(marker, first + marker.length) >= 0) {
    fail('EMBEDDED_SOURCE_NOT_SINGLETON');
  }
  const start = first + marker.length;
  const end = html.indexOf('</script>', start);
  if (end <= start || end - start > 800_000) fail('EMBEDDED_SOURCE_INVALID');
  try { return JSON.parse(html.slice(start, end)); }
  catch { fail('EMBEDDED_SOURCE_INVALID'); }
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('SOURCE_CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function codeFromService(value) {
  return typeof value === 'string'
    ? /^([A-Z0-9]{1,3})(?:\s*-\s*|$)/iu.exec(value)?.[1]?.toUpperCase() ?? null
    : null;
}
function visitKind(wo, row) {
  if (row.activityType !== 'Installation') return null;
  const code = codeFromService(wo.serviceType);
  if (wo.type === 'Installation' && INSTALL_CODES.has(code)) {
    return {kind: code === '8' ? 'Relocation' : 'Installation', typeReview: false};
  }
  if (wo.type === 'Relocation' && code === '8') {
    return {kind: 'Relocation', typeReview: false};
  }
  // Older charts classify code-8 relocation as Other. It is visible for
  // review, but Other alone cannot release a parts-before-install draft.
  if (wo.type === 'Other' && code === '8') {
    return {kind: 'Relocation', typeReview: true};
  }
  return null;
}
function locationPart(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/\s+/gu, ' ') : '';
}
function zip5(value) {
  const match = /^([0-9]{5})(?:-[0-9]{4})?$/u.exec(String(value ?? '').trim());
  return match?.[1] ?? '';
}
function matchingLocation(a, b) {
  if (!object(a) || !object(b)) return false;
  const left = [locationPart(a.street), locationPart(a.city),
    locationPart(a.state), zip5(a.zip)];
  const right = [locationPart(b.street), locationPart(b.city),
    locationPart(b.state), zip5(b.zip)];
  return left.every((part, index) => part && part === right[index]);
}
function validEmail(value) {
  return typeof value === 'string' && value === value.trim() &&
    value.length <= 254 && EMAIL.test(value);
}
function contactSuggestion(project, wo) {
  const c = wo.providerContactCandidate;
  if (!object(c) || c.state !== 'two_source_file_candidate' ||
      !validEmail(c.installManagerEmail) || !validEmail(c.plannerEmail) ||
      !DIGITS.test(wo.acn ?? '')) return null;
  let matchMethod;
  if (c.matchMethod === undefined) {
    if (c.storeNumberStillMissing !== undefined ||
        !DIGITS.test(wo.woStore ?? '')) return null;
    matchMethod = 'exact_store_acn_agent';
  } else if (c.matchMethod === 'exact_address_acn_agent') {
    if (c.storeNumberStillMissing !== true || wo.woStore !== null ||
        !matchingLocation(project.formAddress, wo.thirstyServiceAddress)) return null;
    matchMethod = c.matchMethod;
  } else return null;
  const pair = [c.installManagerEmail.toLowerCase(), c.plannerEmail.toLowerCase()];
  return Object.freeze({
    to: Object.freeze([...new Set(pair)]),
    rolesShareMailbox: pair[0] === pair[1],
    matchMethod,
  });
}
function nativeDetailMatches(wo) {
  if (wo.nativeFields === undefined) return {matches: true, coverage: 'bridge_only'};
  const n = wo.nativeFields;
  if (!object(n) || n['Work Order ID'] !== wo.id.slice(0, 15) ||
      n['Work Order Number'] !== wo.number ||
      typeof n['Assigned SP - Name'] !== 'string' ||
      !n['Assigned SP - Name'].startsWith(`${wo.assignedSpAgentCode} - `)) {
    return {matches: false, coverage: 'native_report_mismatch'};
  }
  return {matches: true, coverage: 'native_report'};
}

/**
 * `approvedHtmlSha256` must come from a protected owner-approved Release row,
 * not from this HTML or its self-declared manifest. Authentication, release
 * lookup, duplicate Claims/Receipts, and Graph draft creation remain outside.
 */
export async function createProviderSnapshotResolver({html, approvedHtmlSha256,
    maxSourceAgeMs = MAX_SOURCE_AGE_MS} = {}) {
  if (typeof html !== 'string' || !/^<!doctype html>/iu.test(html) ||
      new TextEncoder().encode(html).length > 1_000_000) fail('CHART_HTML_INVALID');
  if (typeof approvedHtmlSha256 !== 'string' ||
      !SHA256.test(approvedHtmlSha256)) fail('APPROVED_HTML_DIGEST_REQUIRED');
  if (!Number.isInteger(maxSourceAgeMs) || maxSourceAgeMs <= 0 ||
      maxSourceAgeMs > MAX_SOURCE_AGE_MS) fail('SOURCE_AGE_POLICY_INVALID');
  if (await sha256(html) !== approvedHtmlSha256) fail('CHART_NOT_OWNER_APPROVED');

  const snapshot = embeddedJson(html, 'snapshotData');
  const overlay = embeddedJson(html, 'providerVisitSourceOverlay');
  if (!object(snapshot) || snapshot.schema !== SNAPSHOT_SCHEMA ||
      !exactDate(snapshot.asOfDate) || !Array.isArray(snapshot.projects) ||
      snapshot.projects.length > 100 || !object(snapshot.counts) ||
      !Number.isInteger(snapshot.counts.nativeWorkOrders) ||
      snapshot.counts.nativeWorkOrders < 1 ||
      snapshot.counts.nativeWorkOrders > 500 ||
      !object(overlay) || overlay.schema !== OVERLAY_SCHEMA ||
      !object(overlay.rows) || !Number.isInteger(overlay.sourceRows) ||
      overlay.sourceRows < 1 || !SHA256.test(overlay.sourceSha256 ?? '') ||
      !/^00O[A-Za-z0-9]{15}$/u.test(overlay.reportId ?? '') ||
      !Number.isFinite(utcMillis(overlay.observedAtUtc))) {
    fail('EMBEDDED_SOURCE_SCHEMA_INVALID');
  }
  if (Date.parse(`${snapshot.asOfDate}T00:00:00Z`) >
      utcMillis(overlay.observedAtUtc) + 24 * 60 * 60 * 1000) {
    fail('SOURCE_DATES_CONTRADICT');
  }

  const charted = new Map();
  for (const project of snapshot.projects) {
    if (!object(project) || !Array.isArray(project.cases)) {
      fail('CHART_PROJECT_INVALID');
    }
    for (const oneCase of project.cases) {
      if (!object(oneCase) || !Array.isArray(oneCase.workOrders)) {
        fail('CHART_CASE_INVALID');
      }
      for (const wo of oneCase.workOrders) {
        if (!object(wo) || !salesforceId(wo.id)) fail('CHART_WO_ID_INVALID');
        if (charted.has(wo.id)) fail('CHART_WO_NOT_UNIQUE');
        charted.set(wo.id, {project, wo});
      }
    }
  }
  if (charted.size !== snapshot.counts.nativeWorkOrders ||
      Object.keys(overlay.rows).length !== charted.size ||
      Object.keys(overlay.rows).some(id => !charted.has(id) ||
        !object(overlay.rows[id]))) fail('OVERLAY_COHORT_MISMATCH');

  const sourceAsOfMs = utcMillis(overlay.observedAtUtc);
  const selectionIds = [...charted.values()]
    .filter(({wo}) => wo.type === 'Installation' || wo.type === 'Relocation')
    .map(({wo}) => wo.id);
  return Object.freeze({
    metadata: Object.freeze({
      chartSnapshotAsOfDate: snapshot.asOfDate,
      sourceAsOfUtc: overlay.observedAtUtc,
      chartedWorkOrders: charted.size,
      chartedInstallationOrRelocation: selectionIds.length,
      sourceReportRows: overlay.sourceRows,
    }),
    chartedProviderSelectionIds: () => Object.freeze([...selectionIds]),
    resolve(nativeWoId, nowMs = Date.now()) {
      if (!salesforceId(nativeWoId)) fail('NATIVE_WO_ID_INVALID');
      const found = charted.get(nativeWoId);
      if (!found) fail('WO_NOT_CHARTED');
      if (!Number.isFinite(nowMs)) fail('CLOCK_INVALID');
      const {project, wo} = found;
      const row = overlay.rows[nativeWoId];
      const kind = visitKind(wo, row);
      const native = nativeDetailMatches(wo);
      const agentValid = AGENT_CODE.test(wo.assignedSpAgentCode ?? '');
      const numberValid = WO_NUMBER.test(wo.number ?? '');
      const identityMatches = agentValid && numberValid && native.matches &&
        row.nativeWorkOrderId === nativeWoId.slice(0, 15) &&
        row.workOrderNumber === wo.number &&
        row.workOrderType === wo.type && row.serviceType === wo.serviceType &&
        row.activityType === 'Installation';
      const chartStatusMatchesOverlay = wo.status === row.status;
      const sourceAgeMs = nowMs - sourceAsOfMs;
      const sourceStale = sourceAgeMs < -60_000 ||
        sourceAgeMs > maxSourceAgeMs;
      const terminalOrHeld = typeof row.status !== 'string' ||
        TERMINAL.test(row.status) || row.hold !== '0' ||
        typeof row.spStatus !== 'string' || BLOCKED_SP.test(row.spStatus.trim());
      let eligibility;
      let reasonCode;
      if (!identityMatches) {
        eligibility = 'identity_review'; reasonCode = 'WO_IDENTITY_MISMATCH';
      } else if (!kind) {
        eligibility = 'not_install_or_relocation';
        reasonCode = 'VISIT_KIND_UNVERIFIED';
      } else if (terminalOrHeld) {
        eligibility = 'completed_or_held';
        reasonCode = 'WO_TERMINAL_OR_HELD';
      } else if (sourceStale) {
        eligibility = 'source_stale'; reasonCode = 'DATED_SOURCE_EXPIRED';
      } else if (!chartStatusMatchesOverlay) {
        eligibility = 'stale_chart_review';
        reasonCode = 'CHART_STATUS_DIFFERS_FROM_OVERLAY';
      } else if (kind.typeReview || !PREINSTALL.has(row.status)) {
        eligibility = 'phase_review';
        reasonCode = 'PARTS_NEED_PHASE_REVIEW';
      } else {
        eligibility = 'preinstall_snapshot_candidate';
        reasonCode = 'DATED_PREINSTALL_CANDIDATE';
      }
      const suggestion = eligibility === 'preinstall_snapshot_candidate'
        ? contactSuggestion(project, wo) : null;
      return Object.freeze({
        kind: 'provider', id: nativeWoId,
        visitKind: kind?.kind ?? null,
        woNumber: numberValid ? wo.number : null,
        agentCode: agentValid ? wo.assignedSpAgentCode : null,
        storeNumber: typeof wo.woStore === 'string' && DIGITS.test(wo.woStore)
          ? wo.woStore : null,
        sourceAsOfUtc: overlay.observedAtUtc,
        chartSnapshotAsOfDate: snapshot.asOfDate,
        thirstyUrl: `${THIRSTY_WO_BASE}${encodeURIComponent(nativeWoId)}/view`,
        sourceDetailCoverage: native.coverage,
        chartStatusMatchesOverlay,
        eligibility, reasonCode,
        draftSuggestionAllowed: eligibility === 'preinstall_snapshot_candidate',
        to: suggestion?.to ?? Object.freeze([]), cc: Object.freeze([]),
        recipientSuggestion: suggestion ? 'exact_saved_file_pair' : 'none',
        recipientMatchMethod: suggestion?.matchMethod ?? null,
        rolesShareMailbox: suggestion?.rolesShareMailbox ?? false,
        recipientReviewRequired: true,
        manualCurrentThirstyReviewRequired: true,
      });
    },
  });
}
