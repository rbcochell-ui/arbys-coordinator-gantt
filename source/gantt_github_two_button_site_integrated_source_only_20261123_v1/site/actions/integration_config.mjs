/**
 * Held integration binding. No tenant, List, mailbox, recipient, private
 * tracker URL, or encrypted Gantt payload is configured in this site.
 */
import {REDIRECT_URI} from '../../src/auth_config.mjs';

export const INTEGRATION_CONFIG = Object.freeze({
  enabled: false,
  releaseSiteUrl: null,
  encryptedPayloadUrl: null,
  auth: Object.freeze({enabled: false, tenantId: null, clientId: null,
    coordinatorOids: Object.freeze([]), redirectUri: REDIRECT_URI}),
  lean: Object.freeze({
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
    emptyToDraftCanaryPassed: null,
    occupiedPilotClaimsMigrated: false,
    providerEnabled: false, customerEnabled: false,
  }),
  snapshot: Object.freeze({
    enabled: false, providerSnapshotEnabled: false,
    occupiedPilotClaimsMigrated: false,
    emptyToDraftCanaryPassed: null,
    siteId: null,
    lists: Object.freeze({ganttRelease: null, claims: null,
      receipts: null}),
    coordinatorOids: Object.freeze([]),
    releaseOwnerOids: Object.freeze([]),
    encryptedPayloadUrl: null,
  }),
});
