/**
 * Source-only adapter for V4's initial, latest, and postclaim source reads.
 * It has no Graph client, claim writer, Outlook action, or network request.
 */
import {evaluateSelectedLinkage, exactAddressKey} from
  '../gantt_exact_linkage_guard_source_only_v1/exact_linkage_guard.mjs';

export const EVIDENCE_SCHEMA = 'ArbysReviewedLinkageEvidence/v1';
export const APPROVAL_SCHEMA = 'ArbysLinkageOwnerApproval/v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
const SHA = /^[0-9a-f]{64}$/u;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PREINSTALL = new Set(['Pending Readiness', 'Pending Scheduled Date']);

export class LinkageReadHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LinkageReadHeldError';
    this.code = code;
  }
}
function fail(code) { throw new LinkageReadHeldError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function utcMs(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : NaN;
}
function digits(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value.trim())) return null;
  const result = value.trim().replace(/^0+(?=[0-9])/u, '');
  return result === '0' ? null : result;
}
function sameSet(a, b) {
  return a.length === b.length && new Set(a).size === a.length &&
    new Set(b).size === b.length && a.every(value => b.includes(value));
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle?.digest) fail('CRYPTO_UNAVAILABLE');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function evidencePacket(evidenceJson) {
  if (typeof evidenceJson !== 'string' || !evidenceJson ||
      new TextEncoder().encode(evidenceJson).length > 4_000_000) {
    fail('EVIDENCE_ABSENT');
  }
  let packet;
  try { packet = JSON.parse(evidenceJson); }
  catch { fail('EVIDENCE_INVALID'); }
  if (!object(packet) || packet.schema !== EVIDENCE_SCHEMA ||
      !Number.isFinite(utcMs(packet.observedAtUtc)) ||
      !Array.isArray(packet.projects) || !Array.isArray(packet.linkageRows) ||
      !Array.isArray(packet.directoryRows)) {
    fail('EVIDENCE_INVALID');
  }
  return packet;
}

function approvalTime(approval, digest, observedAtUtc, ownerOids, nowMs) {
  if (!object(approval) || approval.schema !== APPROVAL_SCHEMA ||
      approval.payloadSha256 !== digest || !SHA.test(digest) ||
      approval.observedAtUtc !== observedAtUtc ||
      typeof approval.etag !== 'string' || !approval.etag ||
      !GUID.test(approval.approvedByOid ?? '') ||
      !Array.isArray(ownerOids) || !ownerOids.some(oid =>
        typeof oid === 'string' &&
        oid.toLowerCase() === approval.approvedByOid.toLowerCase()) ||
      typeof approval.modifiedByOid !== 'string' ||
      approval.modifiedByOid.toLowerCase() !==
        approval.approvedByOid.toLowerCase()) {
    fail('OWNER_APPROVAL_UNVERIFIED');
  }
  const observed = utcMs(observedAtUtc);
  const approved = utcMs(approval.approvedAtUtc);
  const modified = utcMs(approval.modifiedAtUtc);
  const until = utcMs(approval.validUntilUtc);
  if (![observed, approved, modified, until, nowMs].every(Number.isFinite) ||
      approved < observed || modified < approved ||
      approved > nowMs + 60_000 || modified > nowMs + 60_000 ||
      until <= approved || until > observed + MAX_AGE_MS ||
      nowMs < observed - 60_000 || nowMs >= until) {
    fail('LINKAGE_EVIDENCE_EXPIRED');
  }
  return until;
}

function chartIndex(snapshot, selectedNativeWorkOrderId) {
  if (!object(snapshot) || !Array.isArray(snapshot.projects)) {
    fail('CHART_LINKAGE_COHORT_INVALID');
  }
  const projectKeys = [];
  const caseIds = [];
  const workOrderIds = [];
  const edges = [];
  let found = null;
  for (const project of snapshot.projects) {
    if (!object(project) || !Array.isArray(project.cases)) {
      fail('CHART_LINKAGE_COHORT_INVALID');
    }
    projectKeys.push(project.caseKey);
    for (const oneCase of project.cases) {
      if (!object(oneCase) || !Array.isArray(oneCase.workOrders)) {
        fail('CHART_LINKAGE_COHORT_INVALID');
      }
      caseIds.push(oneCase.id);
      for (const wo of oneCase.workOrders) {
        workOrderIds.push(wo?.id);
        edges.push(JSON.stringify([project.caseKey, oneCase.id, wo?.id]));
        if (wo?.id === selectedNativeWorkOrderId) {
          if (found) fail('CHART_WO_NOT_UNIQUE');
          found = {project, oneCase, wo};
        }
      }
    }
  }
  if (!found || !sameSet(projectKeys, projectKeys) ||
      !sameSet(caseIds, caseIds) || !sameSet(workOrderIds, workOrderIds) ||
      !sameSet(edges, edges)) {
    fail('CHART_LINKAGE_COHORT_INVALID');
  }
  return {...found, projectKeys, caseIds, workOrderIds, edges};
}

function packetIndex(packet, selectedNativeWorkOrderId) {
  const projectKeys = [];
  const caseIds = [];
  const workOrderIds = [];
  const edges = [];
  let found = null;
  for (const project of packet.projects) {
    if (!object(project) || !Array.isArray(project.cases)) {
      fail('EVIDENCE_INVALID');
    }
    projectKeys.push(project.formSourceKey);
    for (const oneCase of project.cases) {
      if (!object(oneCase) || !Array.isArray(oneCase.workOrders)) {
        fail('EVIDENCE_INVALID');
      }
      caseIds.push(oneCase.nativeCaseId);
      for (const wo of oneCase.workOrders) {
        workOrderIds.push(wo?.nativeWorkOrderId);
        edges.push(JSON.stringify([project.formSourceKey,
          oneCase.nativeCaseId, wo?.nativeWorkOrderId]));
        if (wo?.nativeWorkOrderId === selectedNativeWorkOrderId) {
          if (found) fail('EVIDENCE_WO_NOT_UNIQUE');
          found = {project, oneCase, wo};
        }
      }
    }
  }
  if (!found) fail('EVIDENCE_WO_ABSENT');
  return {...found, projectKeys, caseIds, workOrderIds, edges};
}

function sameBaseAddress(left, right) {
  const base = value => object(value) ? {
    street: value.street, city: value.city, state: value.state, zip: value.zip,
  } : null;
  const a = exactAddressKey(base(left));
  const b = exactAddressKey(base(right));
  return a !== null && a === b;
}

function hasExplicitUnitField(value) {
  if (!object(value)) return false;
  if (Object.hasOwn(value, 'street2')) {
    return typeof value.street2 === 'string';
  }
  return Object.hasOwn(value, 'line2') && typeof value.line2 === 'string';
}

function sameFullAddress(left, right) {
  if (!hasExplicitUnitField(left) || !hasExplicitUnitField(right)) {
    return false;
  }
  const a = exactAddressKey(left);
  const b = exactAddressKey(right);
  return a !== null && a === b;
}

function exactPair(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((value, index) =>
      typeof value === 'string' && value === b[index]);
}

/**
 * Call on *each* V4 readSource result: initial, latest, and postclaim.
 * `ownerApproval` must come from a separate protected owner-controlled read.
 */
export async function verifyLinkageAtRead({v4Read, evidenceJson,
    ownerApproval, approvedOwnerOids, selectedNativeWorkOrderId,
    nowMs = Date.now()} = {}) {
  if (!object(v4Read) || !object(v4Read.source) ||
      !object(v4Read.facts) || !object(v4Read.facts.snapshot) ||
      !object(v4Read.facts.overlay) || typeof v4Read.binding !== 'string' ||
      !v4Read.binding || !Number.isFinite(v4Read.validUntilMs) ||
      !Number.isFinite(nowMs) ||
      v4Read.source.id !== selectedNativeWorkOrderId ||
      v4Read.source.eligibility !== 'preinstall_snapshot_candidate' ||
      v4Read.source.draftSuggestionAllowed !== true ||
      v4Read.source.chartStatusMatchesOverlay !== true ||
      !PREINSTALL.has(v4Read.facts.datedPhase) ||
      v4Read.facts.scopeClass === 'known_other' ||
      v4Read.facts.overlay.observedAtUtc !== v4Read.source.sourceAsOfUtc ||
      nowMs >= v4Read.validUntilMs) {
    fail('V4_SOURCE_NOT_ELIGIBLE');
  }
  const packet = evidencePacket(evidenceJson);
  if (utcMs(packet.observedAtUtc) <
      utcMs(v4Read.facts.overlay.observedAtUtc)) {
    fail('LINKAGE_EVIDENCE_OLDER_THAN_V4');
  }
  const digest = await sha256(evidenceJson);
  const evidenceUntilMs = approvalTime(ownerApproval, digest,
    packet.observedAtUtc, approvedOwnerOids, nowMs);
  const chart = chartIndex(v4Read.facts.snapshot, selectedNativeWorkOrderId);
  const approved = packetIndex(packet, selectedNativeWorkOrderId);
  const missingFormStore = digits(approved.project.formStoreNumber) === null;
  const addressAgrees = missingFormStore ? sameFullAddress : sameBaseAddress;
  if (missingFormStore &&
      (!addressAgrees(chart.project.formAddress,
        approved.project.formAddress) ||
       !addressAgrees(chart.wo.thirstyServiceAddress,
         approved.wo.serviceAddress))) {
    fail('CHART_FALLBACK_ADDRESS_UNVERIFIED');
  }
  if (!sameSet(chart.projectKeys, approved.projectKeys) ||
      !sameSet(chart.caseIds, approved.caseIds) ||
      !sameSet(chart.workOrderIds, approved.workOrderIds) ||
      !sameSet(chart.edges, approved.edges) ||
      chart.project.caseKey !== approved.project.formSourceKey ||
      chart.oneCase.id !== approved.oneCase.nativeCaseId ||
      chart.wo.id !== approved.wo.nativeWorkOrderId ||
      v4Read.facts.wo?.id !== chart.wo.id ||
      chart.wo.number !== approved.wo.workOrderNumber ||
      digits(chart.wo.acn) !== digits(approved.wo.outletAcn) ||
      digits(chart.wo.woStore) !== digits(approved.wo.storeNumber) ||
      digits(chart.project.formStore) !==
        digits(approved.project.formStoreNumber) ||
      chart.wo.assignedSpAgentCode !== approved.wo.assignedSpAgentCode ||
      !addressAgrees(chart.project.formAddress,
        approved.project.formAddress) ||
      !addressAgrees(chart.wo.thirstyServiceAddress,
        approved.wo.serviceAddress) ||
      (object(chart.wo.nativeFields) &&
        chart.wo.nativeFields['Assigned SP - Name'] !==
          approved.wo.assignedSpName)) {
    fail('CHART_LINKAGE_EVIDENCE_MISMATCH');
  }
  let decision;
  try {
    decision = evaluateSelectedLinkage({projects: packet.projects,
      linkageRows: packet.linkageRows,
      directoryRows: packet.directoryRows,
      selectedNativeWorkOrderId});
  } catch {
    fail('LINKAGE_INPUT_INVALID');
  }
  if (decision.state !== 'candidate') {
    fail(`LINKAGE_${decision.reasonCode}`);
  }
  if (v4Read.source.recipientSuggestion !== 'exact_saved_file_pair' ||
      !exactPair(v4Read.source.to, decision.recipientSuggestion)) {
    fail('DATED_RECIPIENT_MISMATCH');
  }
  const binding = JSON.stringify([v4Read.binding, ownerApproval.etag,
    digest, ownerApproval.approvedAtUtc, ownerApproval.validUntilUtc,
    selectedNativeWorkOrderId, decision.nativeCaseId,
    decision.formSourceKey, decision.matchMethod,
    decision.recipientSuggestion]);
  return Object.freeze({
    nativeWorkOrderId: selectedNativeWorkOrderId,
    nativeCaseId: decision.nativeCaseId,
    formSourceKey: decision.formSourceKey,
    matchMethod: decision.matchMethod,
    recipientSuggestion: decision.recipientSuggestion,
    reviewFlags: decision.reviewFlags,
    binding, datedPhase: v4Read.facts.datedPhase,
    validUntilMs: Math.min(v4Read.validUntilMs, evidenceUntilMs),
    sendAllowed: false,
  });
}

/** Compare initial↔latest and initial↔postclaim before any first-draft write. */
export function assertSameLinkage(first, later) {
  if (!object(first) || !object(later) ||
      first.binding !== later.binding ||
      first.nativeWorkOrderId !== later.nativeWorkOrderId ||
      first.nativeCaseId !== later.nativeCaseId ||
      first.formSourceKey !== later.formSourceKey ||
      first.datedPhase !== later.datedPhase ||
      !exactPair(first.recipientSuggestion, later.recipientSuggestion)) {
    fail('LINKAGE_CHANGED_DURING_DRAFT');
  }
}

/**
 * Inject this port beside V4's existing eligible/pairFor checks. Its readers
 * must perform new, uncached reads of two separate protected sources on every
 * call. This module deliberately does not implement or grant those reads.
 */
export function createLinkageVerificationPort({readCurrentEvidenceJson,
    readOwnerApproval, approvedOwnerOids, clock = Date.now} = {}) {
  if (typeof readCurrentEvidenceJson !== 'function' ||
      typeof readOwnerApproval !== 'function' ||
      typeof clock !== 'function' ||
      !Array.isArray(approvedOwnerOids) ||
      approvedOwnerOids.length === 0) {
    throw new TypeError('Fresh evidence and owner approval readers required');
  }
  return Object.freeze({
    async verify(v4Read, selectedNativeWorkOrderId) {
      const started = clock();
      if (!Number.isFinite(started)) fail('LINKAGE_CLOCK_INVALID');
      const [evidenceJson, ownerApproval] = await Promise.all([
        readCurrentEvidenceJson(selectedNativeWorkOrderId),
        readOwnerApproval(selectedNativeWorkOrderId),
      ]);
      const current = clock();
      if (!Number.isFinite(current) || current < started ||
          current - started > 2 * 60_000) {
        fail('LINKAGE_SOURCE_READ_TOO_SLOW');
      }
      return verifyLinkageAtRead({v4Read, evidenceJson, ownerApproval,
        approvedOwnerOids, selectedNativeWorkOrderId, nowMs: current});
    },
    assertSame: assertSameLinkage,
  });
}
