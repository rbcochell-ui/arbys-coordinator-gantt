/**
 * Held provider-only GitHub Pages composition. A current, protected WO row
 * and a distinct two-role contact row authorize the unsent draft; the chart
 * merely supplies the exact selected native WO ID.
 */
import {GANTT_APP_URL, validateAuthConfig} from './auth_config.mjs';
import {createPublicClientApplication} from './browser_msal_factory.mjs';
import {prepareMsalTokenProvider} from './msal_token_provider.mjs';
import {GraphClient} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/graph.mjs';
import {ClaimReceiptStore} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/claim_receipt_store.mjs';
import {createReleaseInventoryLoader} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_team_inventory_fence.mjs';
import {LegacyOwnerRecovery} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_owner_recovery.mjs';
import {createDerivedLegacyProofReader} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_migration_proof.mjs';
import {createLegacySentGraphPort} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_sent_graph_port.mjs';
import {createSignedOwnerRoute} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/signed_owner_route.mjs';
import {assertActiveConfig, SITE_URL} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {GanttReleaseReader, GANTT_RELEASE_KEY, GANTT_RELEASE_TITLE} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs';
import {ProviderOnlyActions} from './provider_only_actions.mjs';
import {createProviderOnlyParentAdapter} from
  './provider_only_parent_adapter.mjs';
import {createProtectedCohortPolicy} from './protected_cohort.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SOURCE_LIST_NAMES = Object.freeze([
  'woSource', 'verifiedContacts', 'claims', 'receipts',
]);
const ENCRYPTED_PAYLOAD_URL = `${GANTT_APP_URL}data/gantt.enc.json`;

export class ProviderOnlySiteHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProviderOnlySiteHeldError';
    this.code = code;
  }
}
function fail(code) { throw new ProviderOnlySiteHeldError(code); }
function sameOids(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length &&
    new Set(a.map(value => String(value).toLowerCase())).size === a.length &&
    a.every(value => b.some(other =>
      String(other).toLowerCase() === String(value).toLowerCase()));
}

/** No customer Release or FORM Case packet is required by this mode. */
export function validateProviderOnlyConfig(config) {
  if (config?.enabled !== true || config.auth?.enabled !== true ||
      config.lean?.enabled !== true) fail('PROVIDER_SITE_DISABLED');
  let auth;
  try { auth = validateAuthConfig(config.auth); }
  catch { fail('PROVIDER_AUTH_NOT_RELEASED'); }
  try { assertActiveConfig(config.lean, 'provider'); }
  catch { fail('PROVIDER_SOURCE_NOT_RELEASED'); }
  const lean = config.lean;
  const ids = SOURCE_LIST_NAMES.map(name => lean.lists?.[name]);
  if (lean.providerEnabled !== true || lean.customerEnabled !== false ||
      lean.emptyToDraftCanaryPassed !== false ||
      config.encryptedPayloadUrl !== ENCRYPTED_PAYLOAD_URL ||
      lean.lists?.customerReleases != null ||
      lean.tenantId?.toLowerCase() !== auth.tenantId ||
      lean.clientId?.toLowerCase() !== auth.clientId ||
      !sameOids(lean.coordinatorOids, auth.coordinatorOids) ||
      !ids.every(id => GUID.test(id ?? '')) ||
      new Set(ids.map(id => id.toLowerCase())).size !== ids.length ||
      config.legacyInventory?.siteId !== lean.siteId ||
      config.legacyInventory?.siteUrl !== SITE_URL ||
      config.legacyInventory?.releaseListTitle !== GANTT_RELEASE_TITLE ||
      config.legacyInventory?.releaseKey !== GANTT_RELEASE_KEY ||
      !sameOids(config.legacyInventory?.ownerOids,
        lean.releaseOwnerOids) ||
      config.cohort?.enabled !== true ||
      config.cohort?.mode !== 'approved-chart-selection-v2' ||
      config.cohort?.releaseListId?.toLowerCase() !==
        config.legacyInventory?.releaseListId?.toLowerCase() ||
      !GUID.test(config.legacyInventory?.releaseListId ?? '') ||
      ids.some(id => id.toLowerCase() ===
        config.legacyInventory.releaseListId.toLowerCase())) {
    fail('PROVIDER_SITE_BINDING_MISMATCH');
  }
  if (config.legacyOwner?.enabled === true &&
      (config.legacyOwner.reviewedConfig?.siteId !== lean.siteId ||
        config.legacyOwner.reviewedConfig?.siteUrl !== SITE_URL ||
        config.legacyOwner.reviewedConfig?.newLists?.claims?.toLowerCase() !==
          lean.lists.claims.toLowerCase() ||
        config.legacyOwner.reviewedConfig?.newLists?.receipts?.toLowerCase() !==
          lean.lists.receipts.toLowerCase())) {
    fail('PROVIDER_LEGACY_OWNER_BINDING_MISMATCH');
  }
  return Object.freeze({auth});
}

export async function prepareProviderOnlySite({config,
    chart = null,
    fetchImpl = globalThis.fetch,
    msalFactory = createPublicClientApplication,
    now = () => Date.now()} = {}) {
  if (config?.enabled !== true) {
    return Object.freeze({adapter: createProviderOnlyParentAdapter({enabled: false}),
      panel: null});
  }
  validateProviderOnlyConfig(config);
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') {
    fail('PROVIDER_SITE_DEPENDENCIES_INCOMPLETE');
  }
  const auth = await prepareMsalTokenProvider({authConfig: config.auth,
    createPublicClientApplication: msalFactory});
  const graph = new GraphClient({tokenProvider: auth.tokenProvider,
    fetchImpl});
  const cohortPolicy = await createProtectedCohortPolicy({chart,
    siteId: config.lean.siteId,
    releaseListId: config.cohort.releaseListId,
    ownerOids: config.lean.releaseOwnerOids,
    payloadUrl: config.encryptedPayloadUrl, now,
    readRelease: boundGraph => new GanttReleaseReader({graph: boundGraph,
      siteId: config.lean.siteId, listId: config.cohort.releaseListId,
      siteUrl: SITE_URL, payloadUrl: config.encryptedPayloadUrl}).read(),
  });
  const loadLegacyFenceProof = createReleaseInventoryLoader(
    config.legacyInventory, now);
  let legacyOwnerRecovery = null;
  if (config.legacyOwner?.enabled === true) {
    let loadMigrationProof;
    try { loadMigrationProof = createDerivedLegacyProofReader(
      config.legacyOwner.reviewedConfig); }
    catch { fail('PROVIDER_LEGACY_RECOVERY_PROOF_MISSING'); }
    const ownerAdapter = createSignedOwnerRoute({graph,
      makeStore: bound => new ClaimReceiptStore({graph: bound,
        config: config.lean, now}),
      loadLegacyFenceProof, loadMigrationProof,
      config: config.legacyOwner.reviewedConfig, now});
    legacyOwnerRecovery = new LegacyOwnerRecovery({adapter: ownerAdapter,
      postSentReceipt: createLegacySentGraphPort({graph,
        siteId: config.lean.siteId,
        receiptsListId: config.lean.lists.receipts}), now});
  }
  const actions = new ProviderOnlyActions({config: config.lean, graph, now,
    loadLegacyFenceProof, legacyOwnerRecovery, cohortPolicy});
  return Object.freeze({adapter: createProviderOnlyParentAdapter({enabled: true,
    actions, signIn: () => auth.signInFromClick(), now}), panel: null});
}
