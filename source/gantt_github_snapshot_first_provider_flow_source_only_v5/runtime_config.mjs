/** Source-only V5 configuration. No tenant, mailbox, or protected source is wired. */
export const RUNTIME_CONFIG = Object.freeze({enabled: false,
  providerSnapshotEnabled: null, siteId: null, releaseListId: null,
  claimsListId: null, receiptsListId: null, ownerOids: null,
  releaseOwnerOids: null, coordinatorOids: null,
  encryptedPayloadUrl: null,
  occupiedPilotClaimsMigrated: null,
  emptyToDraftCanaryPassed: null,
  actorProvider: null, actionPort: null,
  linkagePort: null, currentCaseFormEvidenceReader: null,
  ownerLinkageApprovalReader: null});
