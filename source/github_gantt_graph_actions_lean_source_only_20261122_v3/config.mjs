// Deliberately unusable until the company identity and SharePoint owners bind it.
// This file contains no recipient, tracker URL, token, or live List identifier.
export const HELD_CONFIG = Object.freeze({
  enabled: false,
  tenantId: null,
  clientId: null,
  siteId: null,
  lists: Object.freeze({
    woSource: null,
    verifiedContacts: null,
    customerReleases: null,
    claims: null,
    receipts: null,
  }),
  coordinatorOids: Object.freeze([]),
  releaseOwnerOids: Object.freeze([]),
  approvedCustomerReleaseKinds: Object.freeze([]),
  // Optional raw SP statuses must be explicitly reviewed before accepting a
  // populated value. An empty allowlist accepts only an omitted raw projection.
  eligibleRawSpStatuses: Object.freeze([]),
  eligibleWorkOrderStatuses: Object.freeze([]),
  eligibleServiceTypeCodes: Object.freeze([]),
  eligibleWorkOrderTypes: Object.freeze([]),
  emptyToDraftCanaryPassed: null,
  occupiedPilotClaimsMigrated: false,
  providerEnabled: false,
  customerEnabled: false,
});
