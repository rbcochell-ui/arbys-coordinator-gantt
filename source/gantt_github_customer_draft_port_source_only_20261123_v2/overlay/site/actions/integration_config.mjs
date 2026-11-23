/**
 * Unbound combined build. The public repository contains no tenant,
 * account, List, recipient, tracker capability, or source credentials.
 */
import {REDIRECT_URI} from '../../src/auth_config.mjs';

const HELD_LEAN = Object.freeze({
  enabled: false, tenantId: null, clientId: null, siteId: null,
  lists: Object.freeze({woSource: null, verifiedContacts: null,
    customerReleases: null, claims: null, receipts: null}),
  coordinatorOids: Object.freeze([]),
  releaseOwnerOids: Object.freeze([]),
  approvedCustomerReleaseKinds: Object.freeze([]),
  eligibleRawSpStatuses: Object.freeze([]),
  eligibleWorkOrderStatuses: Object.freeze([]),
  eligibleServiceTypeCodes: Object.freeze([]),
  eligibleWorkOrderTypes: Object.freeze([]),
  emptyToDraftCanaryPassed: false,
  occupiedPilotClaimsMigrated: false,
  providerEnabled: false, customerEnabled: false,
});

export const INTEGRATION_CONFIG = Object.freeze({
  enabled: false,
  providerRouteEnabled: false,
  encryptedPayloadUrl: null,
  auth: Object.freeze({enabled: false, tenantId: null, clientId: null,
    coordinatorOids: Object.freeze([]), redirectUri: REDIRECT_URI}),
  lean: HELD_LEAN,
  legacyInventory: null,
  legacyOwner: null,
  // Activation must bind an owner-approved Release row to the exact chart
  // selection. No pilot IDs or protected List identity ship in this file.
  cohort: Object.freeze({enabled: false,
    mode: null, releaseListId: null}),
  sharedStoreLists: Object.freeze({claims: null, receipts: null}),
  customerBinding: Object.freeze({enabled: false, lean: HELD_LEAN,
    legacyInventory: null}),
});
