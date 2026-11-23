# Snapshot provider flow V5, source only

This is a versioned copy of V4's snapshot provider flow with the reviewed linkage adapter added. V4 remains unchanged. The shipped `runtime_config.mjs` has `enabled: false`, no tenant configuration, no protected evidence reader, and no action port. No cloud run, draft, or email is performed by this package.

## Additional first-draft checks

V5 retains V4's owner-approved Gantt Release, served ciphertext and HTML digest, dated Thirsty overlay, exact native WO selection, visit scope, recipient pair, actor, occupancy, and postclaim checks. It adds `linkagePort.verify` after V4 eligibility and recipient checks in the read-only dated panel, action preview, first draft read, latest read, and postclaim callback. Initial/latest/postclaim linkage bindings must agree.

V5 validates the complete linkage receipt returned by the port against the selected chart project, checksummed native Case, WO, FORM key, dated phase, reviewed match method, recipients, V4 release binding, approval digest and expiration. An incomplete or inconsistent port result holds `LINKAGE_PORT_RESULT_UNVERIFIED`; matching `undefined` fields cannot authorize a draft.

The linkage port must read a current, independently owner-reviewed Case/FORM/contact packet and a separate protected owner approval each time. The adapter compares the full chart project → native Case → native WO edges, Store+ACN, exact address fallback including suite when the FORM store is missing, raw Assigned SP agent, and the manager/planner pair. Absent or changed evidence holds the action. An occupied action still uses V4's immutable resume and sent-recovery route; it does not create a second draft.

The minimum of V4 and linkage approval expirations is shown in the eligible preview, passed to `actionPort.createFirstDraft` as `linkageValidUntilUtc`, and returned from `verifySourceAfterClaim` as `validUntilUtc`. V4's action writer already checks the callback's `validUntilUtc` before its draft creation step. The callback also returns the stable linkage binding for a future receipt schema. The read-only dated panel shows recipients only for an eligible candidate whose linkage verification passed; excluded visits and held linkage show none.

## Integration boundary

This copy still depends on the V4 `GanttReleaseReader` and the shared source-only contract and resolver. The protected Case/FORM/contact packet and owner approval do not exist in this package. Supplying a chart-derived substitute would defeat the independent check. Deployment requires a separate review of those sources, their read permissions and ETags, the selected-only action port, and its receipt path. The source-only tests use invented rows and fake ports; they cannot send email or call a cloud service.

Run from this folder: `npm test`. The tests cover held configuration and missing evidence, minimum expiry, first/latest/postclaim verification, approval ETag and address drift before claim, agent drift after claim, and duplicate-click recovery.
