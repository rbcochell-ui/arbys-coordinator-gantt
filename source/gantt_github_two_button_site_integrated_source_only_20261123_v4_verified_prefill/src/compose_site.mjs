/**
 * Held two-button composition. Provider uses snapshot V7 atomically; customer
 * uses sanitized lean Graph V3. No MSAL or Graph object is constructed while
 * the checked-in integration config is disabled.
 */
import {GANTT_APP_URL, validateAuthConfig} from './auth_config.mjs';
import {createPublicClientApplication} from './browser_msal_factory.mjs';
import {prepareMsalTokenProvider} from './msal_token_provider.mjs';
import {GraphClient} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/graph.mjs';
import {ProviderSourceResolver} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/provider_source.mjs';
import {LeanGanttActions} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/actions.mjs';
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
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v7_verified_prefill/release_reader.mjs';
import {createSnapshotFirstProviderFlow} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v7_verified_prefill/snapshot_first_provider_flow.mjs';
import {SnapshotProviderActionWriter} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v7_verified_prefill/snapshot_provider_writer.mjs';
import {createV2ParentAdapter} from './snapshot_parent_adapter_v4.mjs';
import {createDatedProviderReviewPanel} from
  '../site/actions/dated_provider_review_panel.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PAYLOAD_URL = `${GANTT_APP_URL}data/gantt.enc.json`;

export class SiteBindingHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SiteBindingHeldError';
    this.code = code;
  }
}
function fail(code) { throw new SiteBindingHeldError(code); }
function sameOidSet(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length &&
    new Set(a.map(value => String(value).toLowerCase())).size === a.length &&
    a.every(value => b.some(other =>
      String(other).toLowerCase() === String(value).toLowerCase()));
}

/** Validate the same actor, List pair, origin and payload across all routes. */
export function validateIntegrationConfig(config) {
  if (config?.enabled !== true ||
      config.auth?.enabled !== true ||
      config.lean?.enabled !== true ||
      config.snapshot?.enabled !== true) fail('SITE_INTEGRATION_DISABLED');
  const auth = validateAuthConfig(config.auth);
  try { assertActiveConfig(config.lean, 'customer'); }
  catch { fail('CUSTOMER_RUNTIME_NOT_RELEASED'); }
  const lean = config.lean;
  // The lean provider writer remains disabled. Its protected WO/Contacts
  // reader is shared with the snapshot-first writer and needs its own exact
  // List and status policy binding before the provider button can be armed.
  try { assertActiveConfig({...lean, providerEnabled: true}, 'provider'); }
  catch { fail('PROVIDER_SOURCE_NOT_RELEASED'); }
  const snapshot = config.snapshot;
  const legacy = config.legacyInventory;
  const ids = [snapshot.lists?.ganttRelease, lean.lists?.customerReleases,
    lean.lists?.woSource, lean.lists?.verifiedContacts,
    lean.lists?.claims, lean.lists?.receipts];
  if (lean.providerEnabled !== false || lean.customerEnabled !== true ||
      snapshot.providerSnapshotEnabled !== true ||
      snapshot.occupiedPilotClaimsMigrated !== true ||
      snapshot.emptyToDraftCanaryPassed !== true ||
      lean.tenantId?.toLowerCase() !== auth.tenantId ||
      lean.clientId?.toLowerCase() !== auth.clientId ||
      lean.siteId !== snapshot.siteId ||
      snapshot.lists?.claims?.toLowerCase() !==
        lean.lists?.claims?.toLowerCase() ||
      snapshot.lists?.receipts?.toLowerCase() !==
        lean.lists?.receipts?.toLowerCase() ||
      !ids.every(value => GUID.test(value ?? '')) ||
      new Set(ids.map(value => value.toLowerCase())).size !== ids.length ||
      !sameOidSet(auth.coordinatorOids, lean.coordinatorOids) ||
      !sameOidSet(auth.coordinatorOids, snapshot.coordinatorOids) ||
      !Array.isArray(snapshot.releaseOwnerOids) ||
      !snapshot.releaseOwnerOids.length ||
      !snapshot.releaseOwnerOids.every(value => GUID.test(value)) ||
      legacy?.siteId !== lean.siteId ||
      legacy.siteUrl !== SITE_URL ||
      legacy.releaseListId?.toLowerCase() !==
        snapshot.lists?.ganttRelease?.toLowerCase() ||
      legacy.releaseListTitle !== GANTT_RELEASE_TITLE ||
      legacy.releaseKey !== GANTT_RELEASE_KEY ||
      !sameOidSet(legacy.ownerOids, snapshot.releaseOwnerOids) ||
      !sameOidSet(legacy.ownerOids, lean.releaseOwnerOids) ||
      config.releaseSiteUrl !== SITE_URL ||
      config.encryptedPayloadUrl !== PAYLOAD_URL ||
      snapshot.encryptedPayloadUrl !== PAYLOAD_URL) {
    fail('SITE_RUNTIME_BINDING_MISMATCH');
  }
  if (config.legacyOwner?.enabled === true &&
      (config.legacyOwner.reviewedConfig?.siteId !== lean.siteId ||
        config.legacyOwner.reviewedConfig?.siteUrl !== SITE_URL ||
        config.legacyOwner.reviewedConfig?.newLists?.claims?.toLowerCase() !==
          lean.lists.claims.toLowerCase() ||
        config.legacyOwner.reviewedConfig?.newLists?.receipts?.toLowerCase() !==
          lean.lists.receipts.toLowerCase())) {
    fail('LEGACY_OWNER_BINDING_MISMATCH');
  }
  return Object.freeze({auth, payloadUrl: PAYLOAD_URL});
}

/** Read the selected native WO and exact agent/store/ACN contact pair afresh. */
export function createProtectedProviderJoinPort({graph, config,
    now = () => Date.now()} = {}) {
  if (typeof graph?.bindAccount !== 'function' || typeof now !== 'function') {
    throw new TypeError('Account-pinnable delegated Graph required');
  }
  return Object.freeze({
    async resolve(nativeWoId, actor) {
      // Pin only after the coordinator signs in. ProviderSourceResolver reads
      // both protected Lists by exact GUID/key and rereads each item/ETag.
      return new ProviderSourceResolver({graph: graph.bindAccount(), config,
        now}).resolve(nativeWoId, actor);
    },
  });
}

export async function prepareIntegratedSite({config, loadAuthenticatedChart,
    panelElements, fetchImpl = globalThis.fetch,
    msalFactory = createPublicClientApplication,
    now = () => Date.now()} = {}) {
  if (config?.enabled !== true) {
    return Object.freeze({adapter: createV2ParentAdapter({enabled: false}),
      panel: null, providerFlow: null});
  }
  validateIntegrationConfig(config);
  if (typeof loadAuthenticatedChart !== 'function' ||
      typeof fetchImpl !== 'function' || typeof now !== 'function') {
    fail('SITE_DEPENDENCIES_INCOMPLETE');
  }
  let loadMigrationProof = null;
  if (config.legacyOwner?.enabled === true) {
    try {
      loadMigrationProof = createDerivedLegacyProofReader(
        config.legacyOwner.reviewedConfig);
    } catch { fail('LEGACY_DERIVED_PROOF_PIN_MISSING'); }
  }
  const auth = await prepareMsalTokenProvider({authConfig: config.auth,
    createPublicClientApplication: msalFactory});
  const graph = new GraphClient({tokenProvider: auth.tokenProvider,
    fetchImpl});
  const exactJoinPort = createProtectedProviderJoinPort({graph,
    config: config.lean, now});
  const loadLegacyFenceProof = createReleaseInventoryLoader(
    config.legacyInventory, now);
  let legacyOwnerRecovery = null;
  if (config.legacyOwner?.enabled === true) {
    const ownerAdapter = createSignedOwnerRoute({graph,
      makeStore: bound => new ClaimReceiptStore({graph: bound,
        config: config.lean, now}),
      loadLegacyFenceProof,
      loadMigrationProof,
      config: config.legacyOwner.reviewedConfig, now});
    legacyOwnerRecovery = new LegacyOwnerRecovery({adapter: ownerAdapter,
      postSentReceipt: createLegacySentGraphPort({graph,
        siteId: config.lean.siteId,
        receiptsListId: config.lean.lists.receipts}), now});
  }
  const customerActions = new LeanGanttActions({config: config.lean,
    graph, now, loadLegacyFenceProof, legacyOwnerRecovery});
  const writer = new SnapshotProviderActionWriter({
    config: config.snapshot, graph, now, loadLegacyFenceProof,
    legacyOwnerRecovery});
  // The Release reader binds the same pinned account for every selected
  // Graph GET. Its row/ETag and served chart are reread before the first POST.
  const releaseGraph = Object.freeze({request: (path, options) =>
    graph.bindAccount().request(path, options)});
  const releaseReader = new GanttReleaseReader({graph: releaseGraph,
    siteId: config.snapshot.siteId,
    listId: config.snapshot.lists.ganttRelease,
    siteUrl: config.releaseSiteUrl,
    payloadUrl: config.encryptedPayloadUrl});
  let providerFlow = null;
  const panel = createDatedProviderReviewPanel({elements: panelElements,
    loadSnapshotPreview: id => providerFlow.snapshotPreview(id)});
  providerFlow = createSnapshotFirstProviderFlow({enabled: true,
    releaseReader, loadAuthenticatedChart,
    ownerOids: config.snapshot.releaseOwnerOids,
    getActor: () => graph.bindAccount().getMe(),
    selectionPort: panel.selectionPort, actionPort: writer,
    exactJoinPort, now});
  const base = createV2ParentAdapter({enabled: true,
    actions: customerActions, providerFlow,
    signIn: () => auth.signInFromClick()});
  const adapter = Object.freeze({...base,
    async signInFromClick() {
      await base.signInFromClick();
      panel.onSignedIn();
    },
  });
  return Object.freeze({adapter, panel, providerFlow});
}
