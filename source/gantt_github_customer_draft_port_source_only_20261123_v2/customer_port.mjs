/**
 * Held, customer-only adapter for the existing lean Graph customer action.
 * The chart identifies an exact FORM key. The restricted Release row, unique
 * shared Claim, and original mailbox remain the authoritative gates.
 * This module has no Power Platform route and never sends email.
 */
import {LeanGanttActions} from
  './vendor/lean_v3/actions.mjs';
import {assertActiveConfig, canonicalFormSourceKey, HeldActionError,
  SITE_URL} from
  './vendor/lean_v3/contract.mjs';
import {createReleaseInventoryLoader} from
  './vendor/lean_v3/legacy_team_inventory_fence.mjs';
import {assertCurrentCustomerCsp} from './customer_csp.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_RELEASE_TITLE = 'Arbys Customer Draft Releases';

function fail(code) { throw new HeldActionError(code); }
function sameIds(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    new Set(a.map(value => String(value).toLowerCase())).size === a.length &&
    a.every(value => b.some(other =>
      String(other).toLowerCase() === String(value).toLowerCase()));
}
function noCapability(value) {
  const raw = JSON.stringify(value);
  if (raw.includes('?p=p_') || raw.includes('#k=')) {
    fail('CUSTOMER_CAPABILITY_IN_ACTION_RESULT');
  }
  return value;
}

/**
 * A separate customer action must bind to the very same physical Claim and
 * Receipt Lists as the provider action. The historical pilot Release List is
 * also the current customer Release source. No real ID is checked into this
 * package; this only validates a proposed runtime binding.
 */
export function validateCustomerBinding(binding, sharedStoreLists) {
  if (binding?.enabled !== true) fail('CUSTOMER_PORT_DISABLED');
  const lean = assertActiveConfig(binding.lean, 'customer');
  const inventory = binding.legacyInventory;
  const ids = [lean.lists.customerReleases, lean.lists.claims,
    lean.lists.receipts, inventory?.releaseListId];
  if (lean.providerEnabled !== false ||
      !GUID.test(sharedStoreLists?.claims ?? '') ||
      !GUID.test(sharedStoreLists?.receipts ?? '') ||
      sharedStoreLists.claims.toLowerCase() !==
        lean.lists.claims.toLowerCase() ||
      sharedStoreLists.receipts.toLowerCase() !==
        lean.lists.receipts.toLowerCase() ||
      inventory?.siteId !== lean.siteId ||
      inventory?.siteUrl !== SITE_URL ||
      inventory?.expectedPilotLists?.customer?.toLowerCase() !==
        lean.lists.customerReleases.toLowerCase() ||
      !Array.isArray(inventory?.expectedSources) ||
      !inventory.expectedSources.some(source =>
        source?.listId?.toLowerCase() ===
          lean.lists.customerReleases.toLowerCase() &&
        source?.title === CUSTOMER_RELEASE_TITLE) ||
      !sameIds(inventory?.ownerOids, lean.releaseOwnerOids) ||
      !ids.every(id => GUID.test(id ?? '')) ||
      new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
    fail('CUSTOMER_SHARED_BINDING_MISMATCH');
  }
  return binding;
}

/**
 * Selection is only a UI eligibility gate; it never supplies a recipient or
 * URL. A click captures its selected FORM key once. A later chart selection
 * change cannot change the recipient of that already captured action.
 */
export function createSelectedCustomerPort({actions, selectionPort,
    allowedCustomerKeys}) {
  if (!actions || typeof actions.preview !== 'function' ||
      typeof actions.customerDraft !== 'function' ||
      typeof actions.checkCustomerSent !== 'function' ||
      typeof selectionPort?.getSelection !== 'function' ||
      !Array.isArray(allowedCustomerKeys) ||
      allowedCustomerKeys.length < 1 || allowedCustomerKeys.length > 50 ||
      new Set(allowedCustomerKeys).size !== allowedCustomerKeys.length) {
    throw new TypeError('Exact customer selection port is required');
  }
  const allowed = new Set(allowedCustomerKeys.map(canonicalFormSourceKey));
  function selected(key) {
    const id = canonicalFormSourceKey(key);
    const current = selectionPort.getSelection();
    if (!allowed.has(id) || current?.kind !== 'customer' ||
        current.id !== id) fail('CUSTOMER_SELECTION_NOT_CURRENT');
    return id;
  }
  return Object.freeze({
    enabled: true,
    async preview(kind, key) {
      if (kind !== 'customer') fail('CUSTOMER_ACTION_KIND_INVALID');
      const id = selected(key);
      const result = await actions.preview('customer', id);
      selected(id);
      return noCapability(result);
    },
    async customerDraft(key, binding) {
      const id = selected(key);
      return noCapability(await actions.customerDraft(id, binding));
    },
    async checkCustomerSent(key) {
      const id = selected(key);
      return noCapability(await actions.checkCustomerSent(id));
    },
  });
}

/**
 * Prepare the production customer algorithm without needing the provider
 * source, provider button, or provider-specific release to be active. The
 * checked-in binding returns a disabled port before touching Graph/MSAL.
 */
export function prepareCustomerPort({binding, graph, selectionPort,
    allowedCustomerKeys, sharedStoreLists,
    now = () => Date.now(),
    randomUUID, domParserClass, legacyOwnerRecovery = null} = {}) {
  if (binding?.enabled !== true) {
    const disabled = () => fail('CUSTOMER_PORT_DISABLED');
    return Object.freeze({enabled: false, preview: disabled,
      customerDraft: disabled, checkCustomerSent: disabled});
  }
  validateCustomerBinding(binding, sharedStoreLists);
  assertCurrentCustomerCsp();
  if (typeof graph?.bindAccount !== 'function' ||
      typeof now !== 'function') fail('CUSTOMER_GRAPH_UNBOUND');
  // The signed inventory prevents an older pilot draft from becoming a new
  // first draft. Missing or stale proof holds before any Outlook POST.
  const loadLegacyFenceProof = createReleaseInventoryLoader(
    binding.legacyInventory, now);
  const options = {config: binding.lean, graph, now,
    loadLegacyFenceProof, legacyOwnerRecovery};
  if (randomUUID !== undefined) options.randomUUID = randomUUID;
  if (domParserClass !== undefined) options.domParserClass = domParserClass;
  const actions = new LeanGanttActions(options);
  return createSelectedCustomerPort({actions, selectionPort,
    allowedCustomerKeys});
}
