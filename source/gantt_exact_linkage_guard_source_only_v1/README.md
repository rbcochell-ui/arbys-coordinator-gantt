# Arby's exact FORM, Case, work-order, and provider linkage guard v1

**State: source only.** This folder contains no customer or provider records, connection, token, network call, Outlook action, List write, send action, or publication step. It does not change the existing Gantt builder or the current GitHub page.

## Decision boundary

`evaluateSelectedLinkage` evaluates one selected **18-character native Work Order ID**. The reviewed Case's signed FORM source key anchors the project; the WO's native Case ID must be that Case. The display WO number, store number, address, and project code never establish parentage. Multiple WOs and multiple Cases may belong to one FORM project.

After the native parent check, the guard corroborates the location and suggests provider contacts:

| Source condition | Required corroboration | Result on mismatch |
| --- | --- | --- |
| Customer supplied a numeric FORM store | FORM store = native WO store; native Case ACN = native WO ACN; one exact **store + ACN + assigned agent** row in the linkage file | Held. A matching address cannot override a store or ACN conflict. |
| Customer did not supply a numeric FORM store | Native WO store is present; complete FORM and Thirsty service street, unit, city, state, and ZIP5 match exactly after simple text normalization; Case and WO ACN agree; one exact **address + ACN + agent** linkage row; no second FORM project shares that address and ACN | Held on any missing, conflicting, or ambiguous input. |
| Native WO store is missing | No automatic fallback, regardless of whether the FORM store or addresses are present | Held as `WO_STORE_MISSING` for separate source review. |

The assigned agent is parsed from the actual Thirsty `CODE - Name` field or the upstream `CODE_Name` variant and checked against a separate agent-code field when supplied. A single linkage row must have both role emails. The separate SP contact directory must agree on one unique contact pair for that agent. Duplicate matching linkage rows or conflicting directory pairs hold the suggestion.

The result is either `candidate` or `held`. A candidate has `sendAllowed: false`: it is a saved-source recipient suggestion for a coordinator to review against current Thirsty phase, service date, parts need, assigned provider, and contacts. This guard never sends email. When Store+ACN agrees but FORM and service addresses differ, it reports `FORM_SERVICE_ADDRESS_DIFFERS` as a review flag. The dated source review found many such differences; address is not an override of the primary match.

## Why this is separate

The prior 34-WO chart used the signed FORM Case link and native WO-to-Case relationship for project membership. Its location fields were display and review clues. The older provider-contact fallback was triggered when the **WO** store was missing, including a record where the **customer** had supplied a numeric FORM store. That is different from Ryan's requested customer-missing-store rule. This module keeps those conditions distinct and holds the former case. It does not retrofit or claim release of an existing action.

The 34-WO read-only audit found 29 WOs with both FORM and WO stores populated and agreeing, five WOs with missing WO store, and no mismatched native ID, WO number, Case number, ACN, store, or assigned agent in the saved native details. Full FORM and Thirsty addresses differed on 24 of 34, so a location-only join is unsuitable. A later all-time Case census added one WO, yielding a 35-WO saved chart. These are dated source observations, not current Thirsty facts or proof of complete customer request coverage.

## Integration requirements

- Supply `linkedFormSourceKey` from the independently reviewed native Case link, `nativeCaseId` and `nativeWorkOrderId` as validated Salesforce 18-character IDs, and `customerAcn` from an independently reviewed current native Case field. Do not infer these from a chart row's nesting or a customer address.
- Preserve ACNs and store numbers as strings. Feed the service unit or suite as `street2` or `line2` on both address sources; an unmatched suite holds the address fallback. The normalizer changes case and trivial punctuation and compares ZIP5. It does not geocode, abbreviate street names, or guess near matches.
- Supply hash-pinned, dated linkage and SP directory rows. This module checks selected-row agreement, not file provenance, live contact roles, source freshness, access policy, or dispatch uniqueness. Those must be separate release gates before connecting a draft button.
- Pass only a selected native WO ID to this guard. Treat `held` and thrown integrity errors as no action. Never use the display WO number as an action key.

Run the synthetic, no-network checks from this folder:

```powershell
node --test .\exact_linkage_guard.test.mjs
```

The fixtures cover 29 agreeing store/ACN records, multiple WO and Case children, missing FORM store, missing WO store, exact address and suite mismatch, duplicate location/contact candidates, agent and ACN conflict, and invalid native WO selection. No real customer row, address, or email is in the tests.
