# Reviewed linkage read adapter, source only

This package adds a fail-closed linkage check to the held provider draft flow. It does not edit that flow, read a cloud source, create a draft, or send email. The fixtures are invented.

## Inputs

`createLinkageVerificationPort` needs two **independent, authenticated, uncached** readers:

1. `readCurrentEvidenceJson(nativeWorkOrderId)` returns the exact JSON bytes of a protected, owner-reviewed `ArbysReviewedLinkageEvidence/v1` packet. The packet carries current FORM project and store/address, signed native Case links and ACN, native WO IDs and fields including the raw combined Assigned SP value, plus original store/ACN/agent contact linkage rows and agent directory rows. It must cover the full charted project, Case, and WO cohort. A chart contact suggestion alone cannot replace these sources.
2. `readOwnerApproval(nativeWorkOrderId)` returns a separate protected `ArbysLinkageOwnerApproval/v1` record with the packet SHA-256, source observation time, approval and modification times, expiration, approving and modifying owner OIDs, and ETag. The caller supplies the authenticated approved owner OID allowlist. The adapter verifies the exact digest, owner, time window, and ETag binding. It cannot establish the cloud ACL itself.

Both readers are called again at every stage. A cached packet, missing source, missing approval, changed digest, or expired approval must hold the action. The reviewed packet's observation time must be at least as recent as the V4 source. The returned binding includes the V4 release binding and approved linkage identity. The adapter returns `sendAllowed: false` even for an eligible draft candidate.

## Use with V4

V4's `readSource` is nested, so it needs a new versioned integration copy with an injected `linkagePort`; this folder does not change V4. Keep V4's `eligible(source, facts)` and `pairFor(source, facts)` checks. Add these checks beside them:

```js
const first = await readSource(id);
eligible(first.source, first.facts);
const pair = pairFor(first.source, first.facts);
const firstLink = await linkagePort.verify(first, id);

const latest = await readSource(id);
eligible(latest.source, latest.facts);
pairFor(latest.source, latest.facts);
const latestLink = await linkagePort.verify(latest, id);
linkagePort.assertSame(firstLink, latestLink);

const post = await readSource(id); // inside verifySourceAfterClaim
eligible(post.source, post.facts);
pairFor(post.source, post.facts);
const postLink = await linkagePort.verify(post, id);
linkagePort.assertSame(firstLink, postLink);
```

The preview path should also call `verify` before offering a first-draft action. The occupied/resume and sent-recovery paths retain their existing immutable action checks. The new linkage guard does not turn a draft into a Send action.

The adapter requires the chart and protected packet to agree on all native project, Case, and WO identifiers and parent-child edges, plus the selected WO's store, ACN, address, work-order number, and assigned agent. It also checks that the current V4 suggestion is exactly the two reviewed contact addresses. When the FORM store is missing, both the chart and protected packet must explicitly carry a string `street2` or `line2` (an empty string is valid), and their complete normalized FORM and service addresses must match including that field. A chart without line2 holds; it cannot silently treat a missing suite as blank. The guard then requires exact FORM/service address, Case/WO ACN, agent, and one unique linkage row. A missing WO store is a separate hold. It never infers an Assigned SP combined value from a separate agent code and name.

The chart snapshot has no independent Case ACN or complete contact source rows. These must come from the reviewed protected packet; making a packet from the chart itself defeats the check. A bridge-only WO without `nativeFields['Assigned SP - Name']` can pass only when the independently reviewed packet contains the raw combined Assigned SP field. Selection remains by the native 18-character WO ID, never the display WO number.

## Local verification

Run `node --test gantt_linkage_read_adapter_source_only_v1/linkage_read_adapter.test.mjs` from the project root. Tests cover repeated initial/latest/postclaim reads, missing and changed approval, exact-address fallback, ambiguous locations, missing WO store, Case conflict, unverified agent, recipient drift, phase/ETag drift, and native selection. The lower-level exact guard has its own invented cohort tests.
