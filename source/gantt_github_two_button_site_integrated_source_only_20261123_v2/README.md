# Arby's Gantt two-button integration site — held source-only v2

**Status: source-only, disabled, not published.** This folder packages the
encrypted Gantt parent shell, an exact selection bridge, a proposed Entra SPA
sign-in bridge, the snapshot-first provider V4 route, and sanitized lean Graph
V3 customer route. It makes no cloud call while its checked-in
`site/actions/integration_config.mjs` has `enabled:false`. Tenant/client/List
IDs, coordinator IDs, real recipients, customer tracker capability URLs,
decryption keys, and encrypted chart data are absent. The fixed Pages origin,
SharePoint site URL contract, Thirsty link shape, and six myCoke product URLs
are code-level endpoints, not deployment credentials.

## Bound routes

| Parent control | Source and operation | Boundary |
| --- | --- | --- |
| Select exact WO or FORM project | Decrypted chart in an opaque, sandboxed iframe sends an allowlisted ID to the parent. | Selection never invokes a draft call. A changed, unknown, or reloaded selection clears eligibility. |
| Sign in | MSAL delegated popup using the dedicated `auth/redirect.html` bridge. | No Graph request occurs during disabled startup. The exact redirect still needs registration and a live canary. |
| Create or reopen provider parts draft | Snapshot provider V4 Release reader, source resolver, unique Claim/Receipt writer, then Graph `POST /me/messages` for an **unsent** draft. | First draft requires owner-approved fresh Release, one charted native WO, pre-install Installation/Relocation phase, six exact myCoke links, source rereads, and a trusted parent click. An occupied key can only resume its existing draft; it never creates a second draft. |
| Create or reopen customer tracker draft | Sanitized lean Graph V3 customer Release and the same physical unique Claim/Receipt Lists. | The shared Draft receipt stores only a SHA-256 marker for the private tracker link. The customer capability and Outlook draft link stay out of team-readable rows. |
| Check Sent Items | Contextual attended provider V4 or customer V3 read of the original mailbox message. | A Sent receipt requires real Sent Items evidence. Returning to the signed-in Gantt checks an exact selected draft once; opening an owned occupied draft selection also checks once. The manual button remains available. Missing draft or uncertain status is held. |

There is **no Send control**, `Mail.Send` scope, or automatic send route. The
coordinator reviews the editable Outlook draft's current Thirsty phase, parts
need, assigned agent, work date, fountain scope, To/Cc, and six links before
sending. A known filter-only, survey, line-run, or fire-up visit is held by
the provider route. An uncertain fountain label receives a strong scope
warning; dated contact suggestions may leave To blank. The panel identifies
the Gantt snapshot as dated and provides the exact WO Thirsty link. It does
not claim the chart is current. The single provider draft click is the only
pre-Outlook write gesture after normal sign-in and automatic preview.

The return check is a **bounded, read-only mailbox reconciliation**. It runs
only after sign-in for the exact selected draft when the tab returns from
Outlook, or once when the owner selects an occupied draft after reopening the
page. A hidden tab waits until visible; a changed selection discards an old
result. Two focus events do not repeat one return check. If the Gantt is
closed when Outlook sends, the shared Sent receipt is written when the draft
owner next opens that selection or uses Check Sent. Another coordinator cannot
read the owner's mailbox; the unique shared Claim prevents that coordinator
from making a second first draft while the Sent state is unresolved. A
closed GitHub page has no background listener and cannot record the send at
the instant Outlook sends it.

Every first-draft path also reads the same owner-signed historical-key
inventory from the restricted Gantt Release row. The inventory must list all
old draft/receipt sources and writers, including existing pilot keys; authorized coordinators read this
team-safe Release row through delegated Graph, without reading the draft
owner's old private Lists. The runtime rereads and binds the Release ETag after the
unique Claim, checks expiry immediately before Outlook POST, and holds on a
missing, changed, or occupied key. The checked-in `legacyInventory` binding is
`null`, so this protection cannot activate without a reviewed signed receipt.
An old writer restarted during the proof's validity window remains an
operational risk until the old writers are durably retired or checked live.

The optional owner-only legacy route reconstructs the V3 migration proof
from the exact saved Claim and Draft Receipt, the direct old Graph item,
reviewed plan pins, and a per-pilot digest in the owner-signed Release
inventory. It does not need a fourth proof List. A local reference comparison
on November 23 ran the original V3 preparation and this derived reader on
invented provider and customer observations: both proof objects matched
field for field, including the plan SHA-256. This is source validation, not
tenant readback. A historical Sent check first reserves a unique
`|SentAttempt` receipt whose digest covers the exact frozen Sent row. A
saved marker without Sent, or an uncertain marker readback, stays occupied
for owner review and cannot authorize another Sent POST after reload.

For new-key drafts with a runtime correlation header, a 404 immutable ID
after Outlook Send can trigger one bounded Sent Items reconciliation from five
minutes before the shared Claim time. Only a unique copy with that exact header
is considered; the full Sent message must pass the folder, recipient, body,
link, and Internet message ID checks. An incomplete scan leaves the Claim
occupied and unresolved. Historical V3 pilot drafts lack that header: if their
immutable ID is unavailable, they remain occupied for owner reconciliation.
No path creates another draft as recovery.

`src/compose_site.mjs` injects **all three** snapshot provider operations
(`preview`, `draft`, `checkSent`) into the parent adapter. It never combines a
snapshot preview with lean V3's strict WO/Contacts writer. Lean V3 handles
only the customer action here. The provider V4 writer uses lean V3's
sanitized shared-List format: no Draft `DraftWebLink`, hashed Sent subject,
fixed review code, and no raw customer capability. An existing V2 or V3
Claim can occupy the provider key without allowing a second draft.

## Source layout and local verification

- `site/view.mjs` loads and decrypts the exact served ciphertext in the
  parent, parses the chart's selection-only contract, and arms the iframe.
- `src/chart_loader.mjs` fetches the exact encrypted asset with no credentials
  or redirects, returns its original bytes for the Release hash, and permits
  local loopback HTTP only for isolated tests.
- `src/compose_site.mjs` validates the one actor/List/origin binding, prepares
  MSAL, and composes the two versioned runtime routes.
- `site/actions/dated_provider_review_panel.mjs` displays dated context and
  protects the provider selection epoch. `site/actions/ui_controller.mjs`
  keeps draft actions on trusted parent clicks.
- `site/auth/redirect.html` and `src/redirect-entry.mjs` are the built MSAL
  redirect bridge at the requested exact SPA URL.

Run `npm test`, `npm run build`, and `npm run smoke` from this folder. The
current result is **15/15 unit tests, a production Vite build, and an isolated
Edge smoke pass**. The smoke serves an invented encrypted chart on loopback,
checks the shipped disabled build, then builds a temporary fake-runtime
variant to exercise both draft buttons, return-to-Gantt Sent checks, an
occupied key owned by another coordinator, and manual Check Sent. It verifies
selection alone makes no draft call, invalid selection and iframe reload
clear action eligibility, mobile width, and zero external requests. The fake
variant is removed after the test and is not present in `dist`. The vendored
provider V4 suite passes 41/41 tests, including a Claim appearing between the
caller and writer reads, and a rejected draft result that skips post-Claim
verification. Its tests verify Release, Claim, six-link draft,
cross-action privacy, reopening, and Sent behavior using invented data. A shared
Sent row is held as unverified until the draft owner checks their mailbox. Its
separate Edge dated-panel smoke also passes.
These are local tests, not live tenant or mailbox evidence.

The built `dist/` contains an app page, the redirect bridge, and JS assets;
it contains no `data/gantt.enc.json` or private tracker payload. Do not copy
the smoke's temporary invented asset into a publication package.

## Gates before any enablement or publication

| Dependency | Exact gap |
| --- | --- |
| Entra | Register the exact SPA redirect `https://rbcochell-ui.github.io/arbys-coordinator-gantt/auth/redirect.html`; verify delegated `User.Read`, `Lists.SelectedOperations.Selected`, and `Mail.ReadWrite` for named coordinators. Run account switching and popup/redirect canaries. |
| Lists | Provision and independently read back the restricted owner-write Gantt Release List plus customer Release, unique Claims, and unique Receipts Lists. Prove selected grants and effective actor ACLs, including coordinator Add/View with no Edit/Delete where proposed. The Gantt Release schema remains a proposal. |
| Migration and privacy | Reconcile old pilot occupied keys and any V2 shared rows that stored raw Outlook links, subjects, free-text reasons, or customer capability URLs. Lean V3 and provider V4 reject incompatible legacy shapes; no automatic rewrite is included. |
| Legacy fence | Inventory every historical draft/receipt source and old writer with complete page receipts, retire or check the old writers, issue a bounded P-256 signed proof in the restricted Release row, and verify each authorized coordinator's delegated read plus pre/post Claim drift. A signed Off observation alone can go stale if a writer is restarted. |
| Source and chart | Owner must approve a fresh exact ciphertext/decrypted HTML digest row. The deployed encrypted chart must carry reviewed allowlists covering intended eligible native WOs and FORM keys; the old pilot allowlist is too narrow for a team release. The published script hashes and selected chart version must be checked together. |
| Browser policy | The inherited held CSP currently permits `connect-src 'self'` and `frame-src 'self' about:` only. Before live Graph/MSAL calls, review and test the minimal Microsoft Graph and Entra `connect-src`/`frame-src` allowlist for the actual tenant and token flow. The current CSP deliberately leaves live actions blocked even if a config Boolean is changed. |
| Outlook and operations | Run delegated empty-To, two-role shared mailbox, six-link HTML/readback, immutable-ID, changed draft reopen, cross-user duplicate race, actual Sent Items, and missing-message canaries. A coordinator still checks current Thirsty and edits the Outlook draft before Send. |
| Public origin | Review Pages repository write controls, publication workflow and private-capability handling. GitHub Pages JavaScript is not an authorization boundary; the List unique keys, delegated permissions, owner Release, and mailbox checks carry the workflow guarantees. |
| Build packaging | This source-only folder imports the sibling audited provider V4 and lean V3 folders. A public-repo CI build must vendor/pin those exact reviewed sources or consume a pinned bundle; copying this folder alone will not resolve its imports. Review the built `dist/` and its hashes before any publication. |

No Power Platform runtime is used. This candidate must stay disabled until
these readbacks and canaries are complete and a separate reviewed deployment
version is prepared.
