# Reviewed multi-selection builder — source only

`builder.py` accepts a held private Gantt HTML string and a separately reviewed
JSON record. It returns the same private HTML with an exact list of selected
native work orders and FORM project keys. It never writes a file, calls a
service, looks up contacts by agent code, enables a draft, or sends mail.

The input chart must already have `ArbysGanttSelection/v1` with
`actionsEnabled:false`. This builder keeps that value false and changes only
the `actionRoutes` JSON. The decrypted chart, source overlay, and inline script
bytes are preserved. Keep the reviewed input and returned HTML outside any
public Pages directory. A later release requires a new encrypted payload,
script/CSP review where applicable, and an owner-approved Release record bound
to the exact resulting digest.

## Review record

The caller supplies a protected object with exactly these fields:

| Field | Meaning |
| --- | --- |
| `schema` | `ArbysGanttSelectionReview/v2` |
| `sourceHtmlSha256` | Independently reviewed SHA-256 of the held input HTML |
| `sourceReportSha256` | Independently reviewed SHA-256 of its Thirsty report |
| `sourceObservedAtUtc` | The overlay's exact observation time |
| `snapshotAsOfDate` | The chart's dated snapshot date |
| `reviewedAtUtc` | Human review time after the source observation |
| `validUntilUtc` | Time no later than 24 hours after observation |
| `providerNativeWorkOrderIds` | One to 50 exact canonical native IDs, in reviewed order |
| `customerFormSourceKeys` | One to 50 exact FORM keys, in reviewed order |

The module verifies those hashes and times against the input, but the caller
must obtain the source hash and reviewer decision outside this module. A
self-computed hash is useful for a mechanical dry run; it is not owner approval.

Each selected provider work order must be unique in the chart and its full
overlay cohort. Its chart and Thirsty overlay phases must agree on a
pre-install state; WO number, native ID, type, service type, activity type,
hold flag, and provider status must pass. The visit must be an Installation or
an explicitly typed Relocation. The exact WO must carry its own complete
two-role contact candidate, numeric store, ACN, and assigned agent. A shared
agent code elsewhere supplies no recipient. An `Other` visit, filter-only
visit, stale phase, missing pair, or expired overlay stays out of the route.
The current chart's implicit exact Store + ACN + agent candidate format is
accepted only when `matchMethod` and `storeNumberStillMissing` are absent, and
store and ACN are numeric strings. This matches the browser resolver. A fresh
source review still needs to verify the join against the linkage workbook and
current native Thirsty assignment. Address fallback is not part of this first
two-visit source-only scope.

## Current held-source result

The read-only compatibility check on November 23 at 13:21 UTC found one
additional pre-install candidate mechanically eligible with a two-role pair
and bridge-only details. The original pilot candidate is held because its
chart phase differs from the newer Thirsty overlay. This package deliberately
does not patch that source fact or publish either selection. Re-export and
review Thirsty, refresh the chart and overlay together, then review both exact
IDs in a new protected record. The dated overlay used for this check expires
November 23 at 18:43:09 UTC.

## Synthetic checks

Run `python -m unittest discover -s tests -v` from this directory. The tests
use invented Salesforce IDs, FORM keys, and `.invalid` email addresses. They
cover two exact candidates, phase drift, missing/duplicate/noncanonical IDs,
customer keys, a shared agent with no candidate on the second WO, held/Other
visits, digest mismatch, expiry, the disabled action contract, and a Node.js
comparison against the actual provider resolver. They do not exercise a cloud
Release, Outlook, Thirsty, or live recipients.
