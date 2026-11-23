import {HeldActionError} from './vendor/lean_v3/contract.mjs';
import {createV2ParentAdapter} from './vendor/snapshot_parent_adapter.mjs';
import {prepareCustomerPort} from './customer_port.mjs';

// The existing Gantt controls expect both methods. These stubs leave the
// provider button held while the customer button runs independently.
const heldProviderFlow = Object.freeze({
  preview() { throw new HeldActionError('PROVIDER_ROUTE_HELD'); },
  draft() { throw new HeldActionError('PROVIDER_ROUTE_HELD'); },
  checkSent() { throw new HeldActionError('PROVIDER_ROUTE_HELD'); },
});

/**
 * Exact customer action in the existing V2 parent-control shape. The checked
 * in config returns a disabled runtime before MSAL, Graph, or List access.
 * Sign-in must be a user-click callback from the deployment's Entra SPA.
 */
export function prepareCustomerOnlyParentRuntime({binding, graph,
    selectionPort, allowedCustomerKeys, sharedStoreLists,
    signInFromClick, now, randomUUID, domParserClass,
    legacyOwnerRecovery} = {}) {
  if (binding?.enabled !== true) {
    return createV2ParentAdapter({enabled: false});
  }
  if (typeof signInFromClick !== 'function') {
    throw new TypeError('Attended Entra sign-in callback is required');
  }
  const actions = prepareCustomerPort({binding, graph, selectionPort,
    allowedCustomerKeys, sharedStoreLists, now, randomUUID,
    domParserClass, legacyOwnerRecovery});
  return createV2ParentAdapter({enabled: true, actions,
    providerFlow: heldProviderFlow, signIn: signInFromClick});
}
