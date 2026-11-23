/**
 * Held combined Pages composition. This file is an overlay for the reviewed
 * provider v2 site; it leaves provider preview and draft code unchanged.
 * No tenant, List, recipient, or customer capability is checked in.
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
import {SITE_URL} from
  '../../github_gantt_graph_actions_lean_source_only_20261122_v3/contract.mjs';
import {GanttReleaseReader} from
  '../../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs';
import {validateCustomerBinding} from
  '../../gantt_github_customer_draft_port_source_only_20261123_v2/customer_port.mjs';
import {prepareCustomerOnlyParentRuntime} from
  '../../gantt_github_customer_draft_port_source_only_20261123_v2/customer_parent_runtime.mjs';
import {validateProviderOnlyConfig} from './compose_site.mjs';
import {ProviderOnlyActions} from './provider_only_actions.mjs';
import {createProviderOnlyParentAdapter} from
  './provider_only_parent_adapter.mjs';
import {createProtectedCohortPolicy} from './protected_cohort.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ENCRYPTED_PAYLOAD_URL = `${GANTT_APP_URL}data/gantt.enc.json`;

export class CombinedSiteHeldError extends Error {
  constructor(code) { super(code); this.name = 'CombinedSiteHeldError';
    this.code = code; }
}
function fail(code) { throw new CombinedSiteHeldError(code); }
function sameOids(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    new Set(a.map(value => String(value).toLowerCase())).size === a.length &&
    a.every(value => b.some(other =>
      String(other).toLowerCase() === String(value).toLowerCase()));
}
function sameList(a, b) {
  return GUID.test(a ?? '') && GUID.test(b ?? '') &&
    a.toLowerCase() === b.toLowerCase();
}

/** At least one route may be active; customer does not depend on provider. */
export function validateCombinedConfig(config) {
  if (config?.enabled !== true || config.auth?.enabled !== true ||
      config.encryptedPayloadUrl !== ENCRYPTED_PAYLOAD_URL) {
    fail('COMBINED_SITE_DISABLED');
  }
  let auth;
  try { auth = validateAuthConfig(config.auth); }
  catch { fail('COMBINED_AUTH_NOT_RELEASED'); }
  const providerEnabled = config.providerRouteEnabled === true;
  const customerEnabled = config.customerBinding?.enabled === true;
  if (!providerEnabled && !customerEnabled) fail('COMBINED_ROUTES_HELD');
  if (providerEnabled) {
    try { validateProviderOnlyConfig(config); }
    catch { fail('COMBINED_PROVIDER_BINDING_MISMATCH'); }
    if (!sameList(config.sharedStoreLists?.claims,
      config.lean.lists.claims) ||
      !sameList(config.sharedStoreLists?.receipts,
        config.lean.lists.receipts)) {
      fail('COMBINED_SHARED_STORE_MISMATCH');
    }
  }
  if (customerEnabled) {
    let customer;
    try { customer = validateCustomerBinding(config.customerBinding,
      config.sharedStoreLists); }
    catch { fail('COMBINED_CUSTOMER_BINDING_MISMATCH'); }
    const lean = customer.lean;
    if (lean.tenantId?.toLowerCase() !== auth.tenantId ||
        lean.clientId?.toLowerCase() !== auth.clientId ||
        !sameOids(lean.coordinatorOids, auth.coordinatorOids) ||
        lean.siteId !== (providerEnabled ? config.lean.siteId :
          config.customerBinding.legacyInventory?.siteId)) {
      fail('COMBINED_IDENTITY_MISMATCH');
    }
  }
  return Object.freeze({providerEnabled, customerEnabled});
}

function providerLegacyRecovery({config, graph, now, loadLegacyFenceProof}) {
  if (config.legacyOwner?.enabled !== true) return null;
  let loadMigrationProof;
  try { loadMigrationProof = createDerivedLegacyProofReader(
    config.legacyOwner.reviewedConfig); }
  catch { fail('PROVIDER_LEGACY_RECOVERY_PROOF_MISSING'); }
  const ownerAdapter = createSignedOwnerRoute({graph,
    makeStore: bound => new ClaimReceiptStore({graph: bound,
      config: config.lean, now}),
    loadLegacyFenceProof, loadMigrationProof,
    config: config.legacyOwner.reviewedConfig, now});
  return new LegacyOwnerRecovery({adapter: ownerAdapter,
    postSentReceipt: createLegacySentGraphPort({graph,
      siteId: config.lean.siteId,
      receiptsListId: config.lean.lists.receipts}), now});
}

function combinedAdapter(provider, customer, {providerEnabled,
    customerEnabled}) {
  const held = () => fail('ROUTE_HELD');
  return Object.freeze({
    enabled: true,
    async signInFromClick() {
      if (providerEnabled) await provider.signInFromClick();
      if (customerEnabled) await customer.signInFromClick();
    },
    preview(kind, id) {
      if (kind === 'provider' && providerEnabled) return provider.preview(kind, id);
      if (kind === 'customer' && customerEnabled) return customer.preview(kind, id);
      return held();
    },
    createOrOpenProviderDraft(id, binding) {
      return providerEnabled ? provider.createOrOpenProviderDraft(id, binding) : held();
    },
    createOrOpenCustomerDraft(id) {
      return customerEnabled ? customer.createOrOpenCustomerDraft(id) : held();
    },
    verifySentBySelection(kind, id) {
      if (kind === 'provider' && providerEnabled) {
        return provider.verifySentBySelection(kind, id);
      }
      if (kind === 'customer' && customerEnabled) {
        return customer.verifySentBySelection(kind, id);
      }
      return held();
    },
  });
}

/** One MSAL instance and one delegated Graph client for both routes. */
export async function prepareCombinedSite({config, chart = null,
    selectionPort, allowedCustomerKeys = [],
    fetchImpl = globalThis.fetch,
    msalFactory = createPublicClientApplication,
    now = () => Date.now(),
    customerLegacyOwnerRecovery = null} = {}) {
  if (config?.enabled !== true) {
    return Object.freeze({adapter: createProviderOnlyParentAdapter({enabled: false}),
      providerEnabled: false, customerEnabled: false, panel: null});
  }
  const routes = validateCombinedConfig(config);
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') {
    fail('COMBINED_SITE_DEPENDENCIES_INCOMPLETE');
  }
  const auth = await prepareMsalTokenProvider({authConfig: config.auth,
    createPublicClientApplication: msalFactory});
  const graph = new GraphClient({tokenProvider: auth.tokenProvider,
    fetchImpl});
  let provider = createProviderOnlyParentAdapter({enabled: false});
  if (routes.providerEnabled) {
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
    const legacyOwnerRecovery = providerLegacyRecovery({config, graph, now,
      loadLegacyFenceProof});
    const actions = new ProviderOnlyActions({config: config.lean, graph, now,
      loadLegacyFenceProof, legacyOwnerRecovery, cohortPolicy});
    provider = createProviderOnlyParentAdapter({enabled: true,
      actions, signIn: () => auth.signInFromClick(), now});
  }
  const customer = routes.customerEnabled ?
    prepareCustomerOnlyParentRuntime({binding: config.customerBinding,
      graph, selectionPort, allowedCustomerKeys,
      sharedStoreLists: config.sharedStoreLists, now,
      legacyOwnerRecovery: customerLegacyOwnerRecovery,
      signInFromClick: routes.providerEnabled ?
        () => {} : () => auth.signInFromClick()}) : null;
  return Object.freeze({adapter: combinedAdapter(provider, customer, routes),
    providerEnabled: routes.providerEnabled,
    customerEnabled: routes.customerEnabled, panel: null});
}
