/**
 * The protected Gantt Release row attests the exact decrypted chart bytes.
 * Its approved actionRoutes selection is the pilot cohort. Chart markup alone
 * cannot grant a provider draft, and a public config flip cannot add an ID.
 */
import {canonicalSalesforceId} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {GANTT_RELEASE_FIELDS, GANTT_RELEASE_KEY} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs';
import {parseSelectionConfig} from '../site/selection_config.mjs';

const SHA = /^[0-9a-f]{64}$/u;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/u;
const DAY_MS = 24 * 60 * 60_000;
const PREVIEW_MS = 15 * 60_000;

export class ProviderCohortHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProviderCohortHeldError';
    this.code = code;
  }
}
function held(code) { throw new ProviderCohortHeldError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function utcMs(value) {
  if (typeof value !== 'string' || !UTC.test(value)) {
    held('PROVIDER_COHORT_TIME_UNVERIFIED');
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    held('PROVIDER_COHORT_TIME_UNVERIFIED');
  }
  return ms;
}
async function sha256(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 ||
      bytes.byteLength > 4_000_000 || !globalThis.crypto?.subtle?.digest) {
    held('PROVIDER_COHORT_HASH_UNAVAILABLE');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * This policy is called by the action methods with delegated Graph access.
 * The Release List's exact schema, singleton key and read consistency are
 * checked by GanttReleaseReader before readRelease returns a row.
 */
export async function createProtectedCohortPolicy({chart, readRelease,
    siteId, releaseListId, ownerOids, payloadUrl,
    now = () => Date.now()} = {}) {
  if (!object(chart) || typeof chart.html !== 'string' ||
      chart.html.length < 1 || chart.html.length > 800_000 ||
      !(chart.encryptedPayloadBytes instanceof Uint8Array) ||
      chart.encryptedPayloadUrl !== payloadUrl ||
      typeof readRelease !== 'function' ||
      typeof siteId !== 'string' || !GUID.test(releaseListId ?? '') ||
      !Array.isArray(ownerOids) || !ownerOids.length ||
      ownerOids.some(id => !GUID.test(id ?? '')) ||
      typeof payloadUrl !== 'string' || typeof now !== 'function') {
    held('PROVIDER_COHORT_CONFIG_UNVERIFIED');
  }
  let selection;
  try { selection = parseSelectionConfig(chart.html); }
  catch { held('PROVIDER_COHORT_SELECTION_UNVERIFIED'); }
  if (!selection.providerIds.length) held('PROVIDER_COHORT_EMPTY');
  const allowed = new Set(selection.providerIds);
  const owners = new Set(ownerOids.map(id => id.toLowerCase()));
  if (owners.size !== ownerOids.length) {
    held('PROVIDER_COHORT_CONFIG_UNVERIFIED');
  }
  const htmlSha = await sha256(new TextEncoder().encode(chart.html));
  const encryptedSha = await sha256(chart.encryptedPayloadBytes);

  async function assertAllowed(nativeWoId, graph, expectedReleaseBinding = null) {
    let exactId;
    try { exactId = canonicalSalesforceId(nativeWoId); }
    catch { held('PROVIDER_COHORT_ID_INVALID'); }
    if (!exactId.startsWith('0WO') || !allowed.has(exactId)) {
      held('PROVIDER_NOT_IN_APPROVED_COHORT');
    }
    if (typeof graph?.request !== 'function') {
      held('PROVIDER_COHORT_GRAPH_UNAVAILABLE');
    }
    let row;
    try { row = await readRelease(graph); }
    catch { held('PROVIDER_COHORT_READ_UNCERTAIN'); }
    const f = row?.fields;
    if (!object(row) || !object(f) || row.siteId !== siteId ||
        row.listId?.toLowerCase() !== releaseListId.toLowerCase() ||
        row.payloadUrl !== payloadUrl ||
        !/^[1-9][0-9]*$/u.test(String(row.id ?? '')) ||
        typeof row.etag !== 'string' || !row.etag ||
        !GUID.test(row.modifiedBy ?? '') ||
        f.ReleaseKey !== GANTT_RELEASE_KEY ||
        f.ReleaseState !== 'Approved' ||
        f.DecryptedHtmlSha256 !== htmlSha ||
        f.EncryptedPayloadSha256 !== encryptedSha ||
        f.EncryptedPayloadUrl !== payloadUrl ||
        !SHA.test(f.SourceReportSha256 ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(f.SnapshotAsOfDate ?? '') ||
        !GUID.test(f.ApprovedByOid ?? '') ||
        !owners.has(f.ApprovedByOid.toLowerCase()) ||
        row.modifiedBy.toLowerCase() !== f.ApprovedByOid.toLowerCase() ||
        GANTT_RELEASE_FIELDS.some(name => typeof f[name] !== 'string')) {
      held('PROVIDER_COHORT_NOT_OWNER_APPROVED');
    }
    const current = now();
    const overlay = utcMs(f.OverlayObservedAtUtc);
    const approved = utcMs(f.ApprovedAtUtc);
    const until = utcMs(f.ValidUntilUtc);
    const modified = utcMs(row.modifiedAt);
    if (!Number.isFinite(current) || overlay > approved ||
        approved > current + 60_000 || modified < approved ||
        modified > current + 60_000 || until <= approved ||
        until > approved + DAY_MS || until > overlay + DAY_MS ||
        current < overlay - 60_000 || current >= until) {
      held('PROVIDER_COHORT_EXPIRED');
    }
    const releaseBinding = await sha256(new TextEncoder().encode(JSON.stringify([
      row.siteId, row.listId.toLowerCase(), String(row.id), row.etag,
      row.modifiedBy.toLowerCase(), row.modifiedAt,
      ...GANTT_RELEASE_FIELDS.map(name => f[name]), htmlSha, encryptedSha,
    ])));
    if (expectedReleaseBinding !== null &&
        releaseBinding !== expectedReleaseBinding) {
      held('PROVIDER_COHORT_CHANGED_SINCE_PREVIEW');
    }
    return Object.freeze({nativeWoId: exactId, releaseBinding,
      validUntilMs: Math.min(until, current + PREVIEW_MS)});
  }

  return Object.freeze({assertAllowed});
}
