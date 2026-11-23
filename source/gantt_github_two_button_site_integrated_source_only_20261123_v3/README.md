# Arby's Gantt two-button integration site — held source-only v3

**Status: source-only, runtime disabled, not deployed to Pages.** This folder packages the
encrypted Gantt parent shell, an exact selection bridge, a proposed Entra SPA
sign-in bridge, the snapshot-first provider V5 route, and sanitized lean Graph
V3 customer route. It makes no Microsoft Graph, SharePoint, or Outlook action call
while its checked-in
`site/actions/integration_config.mjs` has `enabled:false`. Tenant/client/List
IDs, coordinator IDs, real recipients, customer tracker capability URLs,
decryption keys, encrypted chart data, protected linkage readers, and action
ports and signed historical inventory pins are absent. The fixed Pages origin,
SharePoint site URL contract, Thirsty link shape, and six myCoke product URLs
are code-level endpoints, not deployment credentials.

## Bound routes

| Parent control | Source and operation | Boundary |
| --- | --- | --- |
| Select exact WO or FORM project | Decrypted chart in an opaque, sandboxed iframe sends an allowlisted ID to the parent. | Selection never invokes a draft call. A changed, unknown, or reloaded selection clears eligibility. |
| Sign in | MSAL delegated popup using the dedicated `auth/redirect.html` bridge. | No Graph request occurs during disabled startup. The exact redirect still needs registration and a live canary. |
| Create or reopen provider parts draft | Snapshot provider V5 with the V4 Release reader and writer, a separate protected Case/FORM/linkage packet and owner approval, then Graph `POST /me/messages` for an **unsent** draft. | First draft requires one charted native WO, a reviewed native Case → FORM anchor, exact store + ACN + agent corroboration or an exact full-address fallback when the FORM store is absent, fresh owner approval and source rereads, six myCoke links, and a trusted parent click. An occupied key can only resume its existing draft. |
| Create or reopen customer tracker draft | Sanitized lean Graph V3 customer Release and the same physical unique Claim/Receipt Lists. | The shared Draft receipt stores only a SHA-256 marker for the private tracker link. The customer capability and Outlook draft link stay out of team-readable rows. |
| Check Sent Items | Contextual attended provider V5 or customer V3 read of the original mailbox message. | A Sent receipt requires real Sent Items evidence. Returning to the signed-in Gantt checks an exact selected draft once; opening an owned occupied draft selection also checks once. The manual button remains available. Missing draft or uncertain status is held. |

There is **no Send control**, `Mail.Send` scope, or automatic send route. The
coordinator reviews the editable Outlook draft's current Thirsty phase, parts
need, assigned agent, work date, fountain scope, To/Cc, and six links before
sending. A known filter-only, survey, line-run, or fire-up visit is held by
the provider route. An uncertain fountain label receives a strong scope
warning; dated contacts are withheld when linkage is unverified or scope is
excluded. The panel identifies
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
old draft/receipt sources and writers, including existing pilot keys; authorized
coordinators read this team-safe Release row through delegated Graph, without
reading the draft owner's old private Lists. The runtime rereads and binds the
Release ETag after the unique Claim, checks expiry immediately before Outlook
POST, and holds on a missing, changed, or occupied key. The checked-in
`legacyInventory` binding is `null`, so this protection cannot activate without
a reviewed signed receipt. A restarted old writer remains an operational risk
until old writers are durably retired or checked live.

The optional owner-only legacy route reconstructs the V3 migration proof from
the exact saved Claim and Draft Receipt, the direct old Graph item, reviewed
plan pins, and a per-pilot digest in the owner-signed Release inventory. It
needs no fourth proof List. A historical Sent check first reserves a unique
`|SentAttempt` receipt whose digest covers the exact frozen Sent row. A saved
marker without Sent, or an uncertain marker readback, stays occupied for owner
review and cannot authorize another Sent POST after reload.

For new-key drafts with a runtime correlation header, a 404 immutable ID
after Outlook Send can trigger one bounded Sent Items reconciliation from five
minutes before the shared Claim time. Only a unique copy with that exact header
is considered; the full Sent message must pass folder, recipient, body, link,
and Internet message ID checks. An incomplete scan leaves the Claim occupied
and unresolved. Historical V3 pilot drafts lack that header: if their
immutable ID is unavailable, they remain occupied for owner reconciliation.
No path creates another draft as recovery. A shared Sent row is displayed as
unverified until its draft owner confirms it in their mailbox.

`src/compose_site.mjs` injects **all three** snapshot provider operations
(`preview`, `draft`, `checkSent`) into the parent adapter. It never combines a
snapshot preview with lean V3's strict WO/Contacts writer. Lean V3 handles
only the customer action here. The provider V4 writer used by V5 uses lean V3's
sanitized shared-List format: no Draft `DraftWebLink`, hashed Sent subject,
fixed review code, and no raw customer capability. An existing V2 or V3
Claim can occupy the provider key without allowing a second draft.

V5's linkage port requires two **separate injected protected readers**: one
for the current Case/FORM/linkage evidence JSON and one for its owner approval.
The port obtains both afresh for preview and every initial, latest, and
postclaim read. Neither reader is constructed from the encrypted chart or its
selection bridge. If either reader is absent, aliased to the other, or the
same function as the chart loader, the provider flow stays disabled and its
preview/draft actions hold. The chart and customer route can still render in
an invented active composition. The checked-in site supplies neither reader.

## Source layout and local verification

- `site/view.mjs` loads and decrypts the exact served ciphertext in the
  parent, parses the chart's selection-only contract, and arms the iframe.
- `src/chart_loader.mjs` fetches the exact encrypted asset with no credentials
  or redirects, returns its original bytes for the Release hash, and permits
  local loopback HTTP only for isolated tests.
- `src/compose_site.mjs` validates the one actor/List/origin and signed
  historical-inventory binding, prepares MSAL, constructs V5's linkage port
  only from injected protected readers, and composes the two versioned routes.
- `site/actions/dated_provider_review_panel.mjs` displays dated context and
  protects the provider selection epoch. `site/actions/ui_controller.mjs`
  keeps draft actions on trusted parent clicks.
- `site/auth/redirect.html` and `src/redirect-entry.mjs` are the built MSAL
  redirect bridge at the requested exact SPA URL.

Run `npm test`, `npm run build`, and `npm run smoke` from this folder. The
current result is **26/26 unit tests, a production Vite build, and an isolated
Edge smoke pass**. The smoke serves an invented encrypted chart on loopback,
checks the shipped disabled build, then builds a temporary fake-runtime
variant to exercise both draft buttons, return-to-Gantt Sent checks, an
occupied key owned by another coordinator, and manual Check Sent. It verifies
selection alone makes no draft call, invalid selection and iframe reload
clear action eligibility, mobile width, and zero external requests. The fake
variant is removed after the test and is not present in `dist`. Provider V5's
separate invented suite verifies linkage across preflight, rereads and
postclaim, while the V4 writer retains its separate Release/Claim/Outlook
tests. The V3 site tests exercise missing readers, exact invented binding,
and withheld recipient copy.
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
| Legacy fence | Inventory every historical draft/receipt source and old writer with complete page receipts, retire or check the old writers, issue a bounded P-256 signed proof in the restricted Release row, and verify each coordinator's delegated read plus pre/post Claim drift. A signed Off observation alone can go stale if a writer is restarted. |
| Source and chart | Owner must approve a fresh exact ciphertext/decrypted HTML digest row. The deployed encrypted chart must carry reviewed allowlists covering intended eligible native WOs and FORM keys; the old pilot allowlist is too narrow for a team release. The published script hashes and selected chart version must be checked together. |
| Protected linkage | Provide independently reviewed, owner-controlled current Case/FORM rows and store + ACN + provider directory rows through two separate protected readers. Verify native Case ownership of each WO, full address including suite on the FORM-store-absent path, and agent-code contact pairs. Do not manufacture this packet from the chart. Missing native WO store, ambiguity, conflict, stale approval, or absent ACL evidence holds the provider button. No live reader is implemented here. |
| Browser policy | The inherited held CSP currently permits `connect-src 'self'` and `frame-src 'self' about:` only. Before live Graph/MSAL calls, review and test the minimal Microsoft Graph and Entra `connect-src`/`frame-src` allowlist for the actual tenant and token flow. The current CSP deliberately leaves live actions blocked even if a config Boolean is changed. |
| Outlook and operations | Run delegated empty-To, two-role shared mailbox, six-link HTML/readback, immutable-ID, changed draft reopen, cross-user duplicate race, actual Sent Items, and missing-message canaries. A coordinator still checks current Thirsty and edits the Outlook draft before Send. |
| Public origin | Review Pages repository write controls, publication workflow and private-capability handling. GitHub Pages JavaScript is not an authorization boundary; the List unique keys, delegated permissions, owner Release, and mailbox checks carry the workflow guarantees. |
| Build packaging | This source-only folder imports the sibling V5 flow, V4 reader/writer, linkage adapter/guard, and lean V3 folders. A public-repo CI build must vendor/pin those exact reviewed sources or consume a pinned bundle; copying this folder alone will not resolve its imports. Review the built `dist/` and its hashes before any publication. |

No Power Platform runtime is used. This candidate must stay disabled until
these readbacks and canaries are complete and a separate reviewed deployment
version is prepared.
