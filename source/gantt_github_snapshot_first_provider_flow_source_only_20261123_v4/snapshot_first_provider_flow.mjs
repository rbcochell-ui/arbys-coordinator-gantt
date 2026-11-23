/**
 * One-click, unsent snapshot-first provider route for the parent adapter's
 * atomic providerFlow injection. No token or tenant config is bundled.
 */
import {buildProviderDraft, canonicalSalesforceId, email,
  providerDispatchKey} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {createProviderSnapshotResolver, MAX_SOURCE_AGE_MS} from
  '../gantt_github_provider_snapshot_resolver_source_only_20261122_v1/provider_snapshot_resolver.mjs';
import {GanttReleaseReader, GANTT_RELEASE_KEY} from './release_reader.mjs';

const DAY_MS = 24 * 60 * 60_000;
const PREVIEW_WINDOW_MS = 15 * 60_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
const DATE = /^\d{4}-\d\d-\d\d$/u;
const PREINSTALL = new Set(['Pending Readiness', 'Pending Scheduled Date']);
const OBSERVED = new Set(['absent', 'draft_occupied',
  'draft_status_unverified', 'legacy_occupied',
  'claim_outcome_unverified', 'sent_recorded_unverified',
  'sent', 'sent_with_changes']);
const WRITER_RESULTS = new Set(['draft', 'recipient_review_required',
  'draft_review_required', 'source_changed_review_required',
  'legacy_draft_review_required',
  'draft_status_unverified', 'legacy_occupied',
  'claim_outcome_unverified', 'sent_recorded_unverified',
  'sent', 'sent_with_changes', 'unresolved',
  'not_started']);

export class SnapshotFlowHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SnapshotFlowHeldError';
    this.code = code;
  }
}
function fail(code) { throw new SnapshotFlowHeldError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function sha256Bytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 ||
      bytes.byteLength > 4_000_000 || !globalThis.crypto?.subtle?.digest) {
    fail('ENCRYPTED_PAYLOAD_BYTES_UNVERIFIED');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sha256Text(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}
function utcMs(value, code) {
  if (typeof value !== 'string' || !UTC.test(value)) fail(code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !==
      value.slice(0, 19)) fail(code);
  return ms;
}
function exactDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function selectedJson(html, id) {
  const marker = `<script type="application/json" id="${id}">`;
  const first = html.indexOf(marker);
  if (first < 0 || html.indexOf(marker, first + marker.length) >= 0) {
    fail('SNAPSHOT_EMBEDDED_SOURCE_UNVERIFIED');
  }
  const start = first + marker.length;
  const end = html.indexOf('</script>', start);
  if (end <= start || end - start > 800_000) {
    fail('SNAPSHOT_EMBEDDED_SOURCE_UNVERIFIED');
  }
  try { return JSON.parse(html.slice(start, end)); }
  catch { fail('SNAPSHOT_EMBEDDED_SOURCE_UNVERIFIED'); }
}
function chartedWo(snapshot, id) {
  let found = null;
  for (const project of snapshot.projects) {
    for (const oneCase of project.cases) {
      for (const wo of oneCase.workOrders) {
        if (wo.id !== id) continue;
        if (found) fail('SNAPSHOT_WO_NOT_UNIQUE');
        found = wo;
      }
    }
  }
  if (!found) fail('SNAPSHOT_WO_NOT_CHARTED');
  return found;
}
function actorOf(raw) {
  if (!object(raw) || !GUID.test(raw.id ?? '') ||
      typeof raw.address !== 'string') fail('COORDINATOR_IDENTITY_UNVERIFIED');
  let address;
  try { address = email(raw.address); }
  catch { fail('COORDINATOR_IDENTITY_UNVERIFIED'); }
  if (address !== raw.address) fail('COORDINATOR_IDENTITY_UNVERIFIED');
  return Object.freeze({id: raw.id.toLowerCase(), address});
}
function exactNativeWoId(value) {
  const id = canonicalSalesforceId(value);
  if (!id.startsWith('0WO')) fail('NATIVE_WO_ID_INVALID');
  return id;
}
function roleEmail(value) {
  try { return email(value); }
  catch { fail('SNAPSHOT_RECIPIENT_PAIR_UNVERIFIED'); }
}
function currentSelection(selectionPort, token, id) {
  if (selectionPort.isCurrent(token) !== true || token.id !== id) {
    fail('SELECTION_CHANGED_BEFORE_DRAFT');
  }
}
function selectionToken(selectionPort, id) {
  const token = selectionPort.capture(id);
  if (!object(token) || token.kind !== 'provider' || token.id !== id ||
      !Number.isSafeInteger(token.epoch) || token.epoch < 0) {
    fail('SELECTION_TOKEN_UNVERIFIED');
  }
  return Object.freeze({kind: 'provider', id, epoch: token.epoch});
}
function releaseBinding(row, chart) {
  const f = row.fields;
  return JSON.stringify([row.listId, row.siteId, row.id, row.etag,
    row.modifiedBy, row.modifiedAt, ...[
      'ReleaseKey', 'ReleaseState', 'DecryptedHtmlSha256',
      'EncryptedPayloadSha256', 'SnapshotAsOfDate', 'OverlayObservedAtUtc',
      'SourceReportSha256', 'ApprovedAtUtc', 'ValidUntilUtc',
      'ApprovedByOid', 'EncryptedPayloadUrl',
    ].map(name => f[name]), chart.encryptedPayloadSha256,
    chart.encryptedPayloadUrl]);
}
function validateRelease(row, chart, ownerOids, nowMs) {
  if (!object(row) || !object(row.fields) || !object(chart) ||
      typeof chart.html !== 'string' ||
      !SHA.test(chart.encryptedPayloadSha256 ?? '') ||
      row.fields.ReleaseKey !== GANTT_RELEASE_KEY ||
      row.fields.ReleaseState !== 'Approved' ||
      !SHA.test(row.fields.DecryptedHtmlSha256 ?? '') ||
      row.fields.EncryptedPayloadSha256 !== chart.encryptedPayloadSha256 ||
      row.fields.EncryptedPayloadUrl !== row.payloadUrl ||
      chart.encryptedPayloadUrl !== row.payloadUrl ||
      !SHA.test(row.fields.SourceReportSha256 ?? '') ||
      !exactDate(row.fields.SnapshotAsOfDate) ||
      !GUID.test(row.fields.ApprovedByOid ?? '') ||
      !ownerOids.includes(row.fields.ApprovedByOid.toLowerCase()) ||
      row.modifiedBy !== row.fields.ApprovedByOid.toLowerCase()) {
    fail('GANTT_RELEASE_NOT_OWNER_APPROVED');
  }
  const overlayMs = utcMs(row.fields.OverlayObservedAtUtc,
    'GANTT_RELEASE_TIME_INVALID');
  const approvedMs = utcMs(row.fields.ApprovedAtUtc,
    'GANTT_RELEASE_TIME_INVALID');
  const untilMs = utcMs(row.fields.ValidUntilUtc,
    'GANTT_RELEASE_TIME_INVALID');
  const modifiedMs = utcMs(row.modifiedAt,
    'GANTT_RELEASE_TIME_INVALID');
  if (overlayMs > approvedMs || approvedMs > nowMs + 60_000 ||
      modifiedMs < approvedMs || modifiedMs > nowMs + 60_000 ||
      untilMs <= approvedMs || untilMs > approvedMs + DAY_MS ||
      untilMs > overlayMs + MAX_SOURCE_AGE_MS) {
    fail('GANTT_RELEASE_TIME_INVALID');
  }
  if (nowMs >= untilMs || nowMs < overlayMs - 60_000) {
    fail('GANTT_RELEASE_EXPIRED');
  }
  return {overlayMs, untilMs};
}
function sourceFacts(html, id) {
  const snapshot = selectedJson(html, 'snapshotData');
  const overlay = selectedJson(html, 'providerVisitSourceOverlay');
  const wo = chartedWo(snapshot, id);
  const row = overlay.rows[id];
  if (!object(row) || typeof row.status !== 'string') {
    fail('SNAPSHOT_PHASE_UNVERIFIED');
  }
  return {snapshot, overlay, wo, datedPhase: row.status,
    scopeClass: classifyVisitScope(wo.serviceType)};
}
export function classifyVisitScope(serviceType) {
  if (typeof serviceType !== 'string' || !serviceType.trim()) return 'unknown';
  const label = serviceType.normalize('NFKC').toLowerCase()
    .replace(/[\u2010-\u2015]/gu, '-').replace(/[_/]+/gu, ' ')
    .replace(/\s+/gu, ' ');
  if (/\b(?:survey|line[ -]*run|run[ -]*lines|fire[ -]*up)\b/iu.test(label) ||
      /\bfilter[ -]*only\b/iu.test(label) ||
      (/\bwater[ -]*filter\b/iu.test(label) &&
        !/\bfountain\b/iu.test(label))) {
    return 'known_other';
  }
  if (/\bfountain\b/iu.test(label) ||
      (/\bdispenser\b/iu.test(label) &&
        !/\bnon[ -]*dispenser\b/iu.test(label))) {
    return 'fountain';
  }
  return 'unknown';
}
function pairFor(source, facts) {
  if (source.recipientSuggestion === 'none' &&
      Array.isArray(source.to) && source.to.length === 0) {
    return Object.freeze({manager: null, planner: null,
      to: Object.freeze([])});
  }
  if (source.recipientSuggestion !== 'exact_saved_file_pair' ||
      !object(facts.wo.providerContactCandidate) ||
      facts.wo.providerContactCandidate.state !== 'two_source_file_candidate') {
    fail('SNAPSHOT_RECIPIENT_SUGGESTION_UNVERIFIED');
  }
  const manager = roleEmail(facts.wo.providerContactCandidate.installManagerEmail);
  const planner = roleEmail(facts.wo.providerContactCandidate.plannerEmail);
  const unique = [...new Set([manager, planner])];
  if (JSON.stringify(unique) !== JSON.stringify(source.to)) {
    fail('SNAPSHOT_RECIPIENT_PAIR_UNVERIFIED');
  }
  return Object.freeze({manager, planner, to: Object.freeze(unique)});
}
async function providerPreviewBinding(c, join, pair) {
  return Object.freeze({
    nativeWoId: c.source.id,
    releaseSourceSha256: await sha256Text(JSON.stringify([
      c.binding, c.source, c.facts.datedPhase, c.facts.scopeClass])),
    protectedJoinSha256: await sha256Text(join.binding),
    to: Object.freeze([...pair.to]), cc: Object.freeze([]),
    validUntilMs: join.validUntilMs,
  });
}
function requireProviderPreviewBinding(value, id, nowMs) {
  const keys = ['nativeWoId', 'releaseSourceSha256',
    'protectedJoinSha256', 'to', 'cc', 'validUntilMs'];
  if (!object(value) || Object.keys(value).length !== keys.length ||
      keys.some(name => !Object.hasOwn(value, name)) ||
      value.nativeWoId !== id ||
      !SHA.test(value.releaseSourceSha256 ?? '') ||
      !SHA.test(value.protectedJoinSha256 ?? '') ||
      !Array.isArray(value.to) || ![1, 2].includes(value.to.length) ||
      value.to.some(address => typeof address !== 'string' ||
        !address || address.length > 254) ||
      new Set(value.to).size !== value.to.length ||
      !Array.isArray(value.cc) || value.cc.length !== 0 ||
      !Number.isSafeInteger(value.validUntilMs)) {
    fail('PROVIDER_PREVIEW_BINDING_INVALID');
  }
  if (!Number.isFinite(nowMs) || nowMs >= value.validUntilMs) {
    fail('PROVIDER_PREVIEW_EXPIRED');
  }
  return value;
}
function compareProviderPreviewBinding(expected, current) {
  if (JSON.stringify(expected.to) !== JSON.stringify(current.to) ||
      JSON.stringify(expected.cc) !== JSON.stringify(current.cc)) {
    fail('PROVIDER_PREVIEW_RECIPIENTS_CHANGED');
  }
  if (expected.releaseSourceSha256 !== current.releaseSourceSha256) {
    fail('PROVIDER_PREVIEW_RELEASE_SOURCE_CHANGED');
  }
  if (expected.protectedJoinSha256 !== current.protectedJoinSha256) {
    fail('PROVIDER_PREVIEW_PROTECTED_JOIN_CHANGED');
  }
  if (current.validUntilMs < expected.validUntilMs) {
    fail('PROVIDER_PREVIEW_WINDOW_CHANGED');
  }
}
function numericIdentity(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value) ||
      /^0+$/u.test(value)) return null;
  return value.replace(/^0+(?=[0-9])/u, '');
}
function serviceTypeCode(value) {
  return typeof value === 'string' ?
    /^([A-Z0-9]{1,3})(?:\s*-\s*|$)/iu.exec(value)?.[1]?.toUpperCase() ?? null :
    null;
}
function exactJoinReceipt(result, c, pair, nowMs) {
  const wo = c.facts.wo;
  const overlayWo = c.facts.overlay.rows?.[c.source.id];
  const chartAcn = numericIdentity(wo.acn);
  const chartStore = numericIdentity(wo.woStore);
  const chartServiceCode = serviceTypeCode(wo.serviceType);
  const protectedAcn = numericIdentity(result?.outletAcn);
  const protectedStore = numericIdentity(result?.storeNumber);
  if (!object(result) || result.nativeWoId !== c.source.id ||
      !chartAcn || !chartStore || chartAcn !== protectedAcn ||
      chartStore !== protectedStore ||
      c.source.visitKind !== 'Installation' ||
      result.normalizedVisitKind !== 'Install' ||
      result.workOrderType !== wo.type ||
      result.workOrderType !== overlayWo?.workOrderType ||
      !chartServiceCode ||
      chartServiceCode !== serviceTypeCode(overlayWo?.serviceType) ||
      result.serviceTypeCode !== chartServiceCode ||
      result.agentCode !== c.source.agentCode ||
      result.agentCode !== wo.assignedSpAgentCode ||
      result.woNumber !== c.source.woNumber ||
      result.woNumber !== wo.number ||
      result.workOrderStatus !== c.facts.datedPhase ||
      result.recipientReviewRequired !== false ||
      !Array.isArray(result.to) || ![1, 2].includes(result.to.length) ||
      JSON.stringify(result.to) !== JSON.stringify(pair.to) ||
      !SHA.test(result.digest ?? '') ||
      typeof result.etagsJson !== 'string' ||
      !Number.isFinite(result.validUntilMs) ||
      result.validUntilMs <= nowMs) {
    fail('PROTECTED_PROVIDER_JOIN_MISMATCH');
  }
  let etags;
  try { etags = JSON.parse(result.etagsJson); }
  catch { fail('PROTECTED_PROVIDER_JOIN_MISMATCH'); }
  if (!object(etags) || !object(etags.wo) || !object(etags.contact) ||
      !/^[1-9][0-9]*$/u.test(etags.wo.itemId ?? '') ||
      !/^[1-9][0-9]*$/u.test(etags.contact.itemId ?? '') ||
      typeof etags.wo.etag !== 'string' || !etags.wo.etag ||
      typeof etags.contact.etag !== 'string' || !etags.contact.etag) {
    fail('PROTECTED_PROVIDER_JOIN_MISMATCH');
  }
  const protectedObserved = utcMs(result.observedAtUtc,
    'PROTECTED_WO_OBSERVATION_INVALID');
  const chartObserved = utcMs(c.source.sourceAsOfUtc,
    'PROTECTED_WO_OBSERVATION_INVALID');
  // SharePoint's DateTime field is minute precision. One minute accommodates
  // that rounding, but an older protected WO cannot authorize chart contacts.
  if (protectedObserved + 60_000 < chartObserved) {
    fail('PROTECTED_WO_OLDER_THAN_CHART');
  }
  return Object.freeze({binding: JSON.stringify([result.digest,
    result.etagsJson, result.observedAtUtc]),
    validUntilMs: Math.min(c.validUntilMs, result.validUntilMs)});
}
function eligible(source, facts) {
  if (source.eligibility !== 'preinstall_snapshot_candidate' ||
      source.draftSuggestionAllowed !== true ||
      source.chartStatusMatchesOverlay !== true ||
      !PREINSTALL.has(facts.datedPhase)) {
    fail(`SNAPSHOT_${String(source.eligibility).toUpperCase()}`);
  }
  if (facts.scopeClass === 'known_other') {
    fail('VISIT_SCOPE_EXCLUDED');
  }
  // The protected WO reader currently attests Install only. A code-8 chart
  // visit cannot become a first draft until its Relocation classification is
  // independently represented and reviewed in that protected source.
  if (source.visitKind === 'Relocation') {
    fail('PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED');
  }
  if (typeof source.woNumber !== 'string' ||
      typeof source.agentCode !== 'string' ||
      !['native_report', 'bridge_only'].includes(source.sourceDetailCoverage)) {
    fail('SNAPSHOT_IDENTITY_UNVERIFIED');
  }
}
export function buildSnapshotProviderContent(source, pair) {
  const base = buildProviderDraft({woNumber: source.woNumber,
    agentCode: source.agentCode, to: []});
  let htmlBody = base.htmlBody;
  if (source.visitKind === 'Relocation') {
    htmlBody = htmlBody.replace('installation work order', 'relocation work order')
      .replace('for this installation', 'for this relocation');
  }
  return Object.freeze({...base, htmlBody, to: pair.to});
}
function writerResult(result) {
  if (!object(result) || !WRITER_RESULTS.has(result.status)) {
    fail('SNAPSHOT_WRITER_RESULT_UNVERIFIED');
  }
  return result;
}
function occupiedActionPreview(id, key, state) {
  return Object.freeze({kind: 'provider', id, dispatchKey: key,
    status: state.status, storeNumber: null, to: Object.freeze([]),
    cc: Object.freeze([]), recipientReviewRequired: true,
    webLink: null, validUntilUtc: null});
}
function occupiedDatedPreview(id, state) {
  return Object.freeze({kind: 'provider', id, canDraft: false,
    sourceAvailable: false, existingStatus: state.status,
    reasonCode: 'DATED_SOURCE_UNAVAILABLE',
    thirstyUrl: `https://hubit.my.salesforce.com/lightning/r/WorkOrder/${id}/view`,
    isCurrentThirstyState: false});
}

/**
 * `preview`, `draft`, and `checkSent` are the parent adapter's atomic route.
 * `snapshotPreview` is read-only dated context even while actions are held.
 * Outlook is the attended current-phase, date, scope, and recipient review.
 */
export function createSnapshotFirstProviderFlow({enabled = false,
    releaseReader = null, loadAuthenticatedChart = null,
    ownerOids = null, getActor = null, selectionPort = null,
    actionPort = null, exactJoinPort = null,
    now = () => Date.now()} = {}) {
  if (typeof now !== 'function') throw new TypeError('Clock function required');
  const sourceConfigured = releaseReader instanceof GanttReleaseReader &&
    typeof loadAuthenticatedChart === 'function' &&
    Array.isArray(ownerOids) && ownerOids.length > 0 &&
    ownerOids.every(id => typeof id === 'string' && GUID.test(id));
  if (enabled === true && (!sourceConfigured ||
      typeof exactJoinPort?.resolve !== 'function' ||
      typeof getActor !== 'function' ||
      typeof selectionPort?.capture !== 'function' ||
      typeof selectionPort?.isCurrent !== 'function' ||
      typeof selectionPort?.ensureReady !== 'function' ||
      ['observe', 'resume', 'createFirstDraft', 'checkSent']
        .some(name => typeof actionPort?.[name] !== 'function'))) {
    throw new TypeError('Complete snapshot source, selection and shared action port required');
  }
  const owners = sourceConfigured ? ownerOids.map(id => id.toLowerCase()) : [];
  const inFlight = new Set();

  async function readSource(nativeWoId) {
    if (!sourceConfigured) fail('SNAPSHOT_SOURCE_UNCONFIGURED');
    const id = exactNativeWoId(nativeWoId);
    const started = now();
    const [release, loadedChart] = await Promise.all([
      releaseReader.read(), loadAuthenticatedChart(),
    ]);
    if (!object(loadedChart)) fail('AUTHENTICATED_CHART_UNVERIFIED');
    const chart = Object.freeze({html: loadedChart.html,
      encryptedPayloadUrl: loadedChart.encryptedPayloadUrl,
      encryptedPayloadSha256: await sha256Bytes(loadedChart.encryptedPayloadBytes)});
    const current = now();
    if (!Number.isFinite(started) || !Number.isFinite(current) ||
        current < started || current - started > 2 * 60_000) {
      fail('SNAPSHOT_SOURCE_READ_TOO_SLOW');
    }
    const {overlayMs, untilMs} = validateRelease(release, chart, owners, current);
    const resolver = await createProviderSnapshotResolver({html: chart.html,
      approvedHtmlSha256: release.fields.DecryptedHtmlSha256});
    const resolved = resolver.resolve(id, current);
    const facts = sourceFacts(chart.html, id);
    const source = Object.freeze({...resolved, scopeClass: facts.scopeClass});
    if (facts.snapshot.asOfDate !== release.fields.SnapshotAsOfDate ||
        facts.overlay.observedAtUtc !== release.fields.OverlayObservedAtUtc ||
        facts.overlay.sourceSha256 !== release.fields.SourceReportSha256 ||
        source.chartSnapshotAsOfDate !== facts.snapshot.asOfDate ||
        source.sourceAsOfUtc !== facts.overlay.observedAtUtc) {
      fail('GANTT_RELEASE_EMBEDDED_SOURCE_MISMATCH');
    }
    return Object.freeze({release, source, facts,
      binding: releaseBinding(release, chart),
      validUntilMs: Math.min(current + PREVIEW_WINDOW_MS,
        untilMs, overlayMs + MAX_SOURCE_AGE_MS)});
  }

  async function actor() { return actorOf(await getActor()); }
  async function joined(c, pair, user) {
    if (typeof exactJoinPort?.resolve !== 'function') {
      fail('PROTECTED_PROVIDER_JOIN_UNCONFIGURED');
    }
    const result = await exactJoinPort.resolve(c.source.id, user);
    return exactJoinReceipt(result, c, pair, now());
  }
  async function observe(key, user) {
    const state = await actionPort.observe(key, user);
    if (!object(state) || !OBSERVED.has(state.status) ||
        (state.dispatchKey && state.dispatchKey !== key)) {
      fail('SNAPSHOT_ACTION_STATE_UNVERIFIED');
    }
    return state;
  }

  return Object.freeze({
    enabled: enabled === true,
    async snapshotPreview(nativeWoId) {
      const id = exactNativeWoId(nativeWoId);
      if (enabled === true) {
        const existing = await observe(providerDispatchKey(id), await actor());
        if (existing.status !== 'absent') {
          return occupiedDatedPreview(id, existing);
        }
      }
      let c;
      try { c = await readSource(id); }
      catch (error) {
        // A key may become occupied while the dated source is being read.
        // The read-only panel then shows the existing action state instead.
        if (enabled !== true) throw error;
        const state = await observe(providerDispatchKey(id), await actor());
        if (state.status === 'absent') throw error;
        return occupiedDatedPreview(id, state);
      }
      const scopeExcluded = c.source.eligibility ===
        'preinstall_snapshot_candidate' && c.facts.scopeClass === 'known_other';
      const relocationHeld = c.source.eligibility ===
        'preinstall_snapshot_candidate' && c.source.visitKind === 'Relocation';
      let joinReasonCode = null;
      let recipientsVerified = false;
      if (c.source.eligibility === 'preinstall_snapshot_candidate' &&
          !scopeExcluded && !relocationHeld) {
        try {
          eligible(c.source, c.facts);
          const pair = pairFor(c.source, c.facts);
          await joined(c, pair, await actor());
          recipientsVerified = true;
        } catch (error) {
          joinReasonCode = /^[A-Z0-9_]{3,80}$/u.test(error?.code ?? '') ?
            error.code : 'PROTECTED_PROVIDER_JOIN_UNVERIFIED';
        }
      }
      return Object.freeze({kind: 'provider', id: c.source.id,
        eligibility: scopeExcluded ? 'scope_excluded' :
          relocationHeld ? 'relocation_review' :
            joinReasonCode ? 'linkage_held' : c.source.eligibility,
        reasonCode: scopeExcluded ? 'VISIT_SCOPE_EXCLUDED' :
          relocationHeld ? 'PROTECTED_RELOCATION_CLASSIFICATION_UNREVIEWED' :
            joinReasonCode ?? c.source.reasonCode,
        scopeClass: c.facts.scopeClass,
        sourceAsOfUtc: c.source.sourceAsOfUtc,
        chartSnapshotAsOfDate: c.source.chartSnapshotAsOfDate,
        datedPhase: c.facts.datedPhase,
        thirstyUrl: c.source.thirstyUrl,
        woNumber: c.source.woNumber, agentCode: c.source.agentCode,
        storeNumber: c.source.storeNumber,
        recipientSuggestion: recipientsVerified ?
          c.source.recipientSuggestion : 'none',
        to: recipientsVerified ? c.source.to : Object.freeze([]),
        cc: Object.freeze([]),
        canDraft: false, isCurrentThirstyState: false});
    },
    async preview(nativeWoId) {
      if (enabled !== true) fail('SNAPSHOT_PROVIDER_DRAFTS_DISABLED');
      const id = exactNativeWoId(nativeWoId);
      const selection = selectionToken(selectionPort, id);
      const user = await actor();
      const key = providerDispatchKey(id);
      const existing = await observe(key, user);
      currentSelection(selectionPort, selection, id);
      if (existing.status !== 'absent') {
        return occupiedActionPreview(id, key, existing);
      }
      const c = await readSource(id);
      eligible(c.source, c.facts);
      const pair = pairFor(c.source, c.facts);
      const join = await joined(c, pair, user);
      // An eligible parent result must not arm the button before its dated
      // source, scope warning and Thirsty link are visible in the parent.
      await selectionPort.ensureReady(c.source.id);
      currentSelection(selectionPort, selection, id);
      const state = await observe(key, user);
      currentSelection(selectionPort, selection, id);
      if (state.status !== 'absent') {
        return occupiedActionPreview(id, key, state);
      }
      const binding = await providerPreviewBinding(c, join, pair);
      currentSelection(selectionPort, selection, id);
      return Object.freeze({kind: 'provider', id: c.source.id,
        dispatchKey: key, status: 'eligible', storeNumber: c.source.storeNumber,
        scopeReviewRequired: c.facts.scopeClass !== 'fountain',
        to: c.source.to, cc: [],
        recipientReviewRequired: true, webLink: null,
        validUntilUtc: new Date(join.validUntilMs).toISOString(),
        binding});
    },
    async draft(nativeWoId, previewBinding) {
      if (enabled !== true) fail('SNAPSHOT_PROVIDER_DRAFTS_DISABLED');
      const id = exactNativeWoId(nativeWoId);
      if (inFlight.has(id)) fail('SNAPSHOT_DRAFT_ALREADY_IN_PROGRESS');
      inFlight.add(id);
      try {
        const selection = selectionToken(selectionPort, id);
        currentSelection(selectionPort, selection, id);
        const user = await actor();
        const key = providerDispatchKey(id);
        const before = await observe(key, user);
        if (before.status !== 'absent') {
          currentSelection(selectionPort, selection, id);
          if (previewBinding != null) {
            fail('PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
          }
          const resumed = writerResult(await actionPort.resume(key, user));
          currentSelection(selectionPort, selection, id);
          return resumed;
        }
        const expectedPreview = requireProviderPreviewBinding(
          previewBinding, id, now());
        const first = await readSource(id);
        eligible(first.source, first.facts);
        const pair = pairFor(first.source, first.facts);
        const firstJoin = await joined(first, pair, user);
        compareProviderPreviewBinding(expectedPreview,
          await providerPreviewBinding(first, firstJoin, pair));
        await selectionPort.ensureReady(id);
        currentSelection(selectionPort, selection, id);
        // This is an unsent Outlook draft. The coordinator checks current
        // Thirsty phase/date/scope and recipients in Outlook before Send.
        // No second modal or confirmation click is required here.
        const latest = await readSource(id);
        eligible(latest.source, latest.facts);
        const latestPair = pairFor(latest.source, latest.facts);
        const latestJoin = await joined(latest, latestPair, user);
        if (latestJoin.binding !== firstJoin.binding) {
          fail('PROTECTED_PROVIDER_JOIN_CHANGED');
        }
        if (latest.binding !== first.binding ||
            latest.facts.datedPhase !== first.facts.datedPhase) {
          fail('GANTT_RELEASE_CHANGED_BEFORE_CLAIM');
        }
        compareProviderPreviewBinding(expectedPreview,
          await providerPreviewBinding(latest, latestJoin, latestPair));
        const latestActor = await actor();
        if (latestActor.id !== user.id ||
            latestActor.address !== user.address) fail('COORDINATOR_CHANGED');
        currentSelection(selectionPort, selection, id);
        requireProviderPreviewBinding(expectedPreview, id, now());
        const raced = await observe(key, user);
        if (raced.status !== 'absent') {
          currentSelection(selectionPort, selection, id);
          fail('PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
        }
        requireProviderPreviewBinding(expectedPreview, id, now());
        const content = buildSnapshotProviderContent(first.source, pair);
        let afterClaimCalls = 0;
        const verifySourceAfterClaim = async () => {
          if (++afterClaimCalls !== 1) fail('POSTCLAIM_RECHECK_REPEATED');
          currentSelection(selectionPort, selection, id);
          const post = await readSource(id);
          eligible(post.source, post.facts);
          const postPair = pairFor(post.source, post.facts);
          const postJoin = await joined(post, postPair, user);
          if (postJoin.binding !== firstJoin.binding) {
            fail('PROTECTED_PROVIDER_JOIN_CHANGED');
          }
          const postActor = await actor();
          if (postActor.id !== user.id || postActor.address !== user.address) {
            fail('COORDINATOR_CHANGED');
          }
          if (post.binding !== first.binding ||
              post.facts.datedPhase !== first.facts.datedPhase) {
            fail('GANTT_RELEASE_CHANGED_AFTER_CLAIM');
          }
          compareProviderPreviewBinding(expectedPreview,
            await providerPreviewBinding(post, postJoin, postPair));
          requireProviderPreviewBinding(expectedPreview, id, now());
          return Object.freeze({releaseItemId: post.release.id,
            releaseETag: post.release.etag,
            decryptedHtmlSha256: post.release.fields.DecryptedHtmlSha256,
            exactJoinBinding: postJoin.binding,
            validUntilUtc: new Date(Math.min(expectedPreview.validUntilMs,
              firstJoin.validUntilMs,
              latestJoin.validUntilMs,
              postJoin.validUntilMs)).toISOString()});
        };
        const result = await actionPort.createFirstDraft(Object.freeze({
          dispatchKey: key, nativeWoId: id, actor: user,
          release: first.release, source: first.source,
          scopeClass: first.facts.scopeClass,
          recipientSuggestion: first.source.recipientSuggestion,
          datedPhase: first.facts.datedPhase, content,
          exactJoinBinding: firstJoin.binding,
          previewValidUntilMs: expectedPreview.validUntilMs,
          verifySourceAfterClaim,
        }));
        if (afterClaimCalls === 0) {
          if (result?.reusedExistingClaim === true ||
              result?.status === 'legacy_occupied') {
            // The eligible preview observed an absent key. A newly occupied
            // key must be reviewed through a fresh occupied preview.
            fail('PROVIDER_CLAIM_CHANGED_SINCE_PREVIEW');
          }
          fail('POSTCLAIM_RECHECK_MISSING');
        }
        if (afterClaimCalls !== 1 || result?.reusedExistingClaim === true) {
          fail('POSTCLAIM_RECHECK_MISSING');
        }
        currentSelection(selectionPort, selection, id);
        return writerResult(result);
      } finally { inFlight.delete(id); }
    },
    async checkSent(nativeWoId) {
      if (enabled !== true) fail('SNAPSHOT_PROVIDER_DRAFTS_DISABLED');
      const id = exactNativeWoId(nativeWoId);
      const user = await actor();
      return writerResult(await actionPort.checkSent(providerDispatchKey(id), user));
    },
  });
}
