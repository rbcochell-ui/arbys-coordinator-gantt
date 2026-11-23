# Held GitHub Gantt provider-only route v2 (Nov 23)

This versioned source is a narrower first button for the Arby's coordinator
Gantt. It does not use Power Platform or require a complete FORM→Case→WO
packet. The encrypted GitHub Pages chart supplies only an exact native Thirsty
Work Order ID selected by a coordinator. It is **not** the authority for the
recipient, work-order phase, or duplicate state.

## What the button would do after release

1. Sign an approved coordinator into the company Entra SPA with delegated
   `User.Read`, `Lists.SelectedOperations.Selected`, and `Mail.ReadWrite`.
   There is no `Mail.Send` scope or Send button in this app.
2. Before a protected source preview, read the **owner-approved Gantt
   Release singleton** and match its decrypted HTML and ciphertext SHA-256
   values to the exact chart opened in this tab. The approved chart's
   `actionRoutes.providerAllowedNativeWorkOrderIds` is the pilot cohort.
   The action method checks that cohort again at draft click and on every
   bound source reread. A public chart change, revocation, Release ETag
   change, expired approval, or unlisted WO holds the button. The checked-in
   integration config has the cohort mode disabled and contains no real IDs.
3. Read exactly one current row by native WO ID from the restricted
   `Arbys Provider Parts WO Action Source` List. Require its WO number,
   Assigned SP agent code, approved install status, non-held state, and
   source observation within 24 hours. The protected reader's source
   revision and ETag guards remain in force.
4. Join exactly one reviewed contact row by agent code, outlet ACN, and store
   number from the restricted `Arbys Provider Parts Verified Contacts` List.
   Require two distinct, current install-manager and planner email addresses.
   A missing, stale, or shared-mailbox pair **holds** this route; there is no
   blank-To fallback. Coordinators can still edit recipients in Outlook.
   Before the draft button arms, a second protected read displays the WO
   number, Assigned SP agent code, saved WO status, source-observed
   UTC time, store number, and both To addresses. The preview binds the
   protected source digest, both List ETags, release fingerprint, agent,
   status, and ordered recipient pair to the next click. Any change holds
   and requires a new preview. An occupied draft can be reopened when the
   same current preview still succeeds; **Check Sent** remains available
   for reconciliation if the source has changed.
   This is a saved-source preview, up to 24 hours old. The coordinator must
   check the live Thirsty phase, assigned agent, date, and scope before Send.
5. Check the owner-signed historical provider-draft inventory, then use a
   SharePoint-enforced unique `provider-parts:<native WO ID>` Claim. Reread
   the protected WO/contact source and historical inventory after that Claim.
   Create one editable **unsent** Outlook draft with the six exact myCoke
   product links and material numbers. Read the draft back before recording
   the Draft receipt.
6. On the coordinator's return or explicit **Check Sent Items**, inspect the
   original mailbox's actual Sent Items and append a shared Sent receipt.
   Until that verification, the Claim remains occupied so another person
   cannot create a second first draft. Closing the browser cannot log a send
   instantly; this is attended eventual confirmation.

The customer tracker draft button is visible but inert in this variant. Its
FORM submitter address and **full unique private tracker URL** remain in the
separate protected customer release path; this provider-only route does not
infer them from the chart. The published customer tracker still needs its own
reviewed daily Thirsty refresh.

## Current state and release gates

The checked-in `site/actions/integration_config.mjs` is disabled and has no
tenant, app, List, account, recipient, or capability-link values. No cloud
List, draft, email, or Pages artifact is changed by this directory. The
source reuses the existing protected WO/Contacts reader and Claims/Receipts
writer; it does **not** require a Customer Release List. It retains the
separate owner-signed **Gantt Release List historical inventory fence** so
the already existing pilot drafts cannot be silently duplicated. Until that
fence is provisioned and signed, the provider button must remain disabled.

The v2 action layer treats the existing protected Gantt Release row's approval
of the **exact decrypted chart** as approval of its embedded pilot selection.
No new List field is needed. Before activating this contract, the Release
owner must explicitly approve that selection for the provider pilot and
read back the exact row, `ReleaseKey` unique index, all required Release
fields, effective ACLs, owner editor identity, Approved state, and validity
window. Ryan and Arby's Owners must be the only people allowed to alter the
Release row. If that row or its access cannot be verified, the button stays
Off. The chart selection check alone is never authorization. This is an
attended browser action guard; it is not a server-enforced authorization
boundary against a coordinator who already has direct Graph write access.
The selected List grants and effective SharePoint permissions therefore
remain part of the activation gate.

Delegated selected access is the intersection of the app grant and each
signed-in person's SharePoint rights. The provider path needs selected app
`read` and Tony/Harmony human Read on WO Action Source, Verified Contacts,
and Gantt Releases. The shared Claims and Receipts need selected app `write`
plus reviewed human rights sufficient for unique Claim and append-only
receipt operations. Verify those rights, item-level tamper protection, and
read/write canaries separately as Ryan, Tony, and Harmony. A grant to the SPA
alone will not make a Ryan/Owners-only List readable to Tony or Harmony.
If the human write role permits altering earlier Claims or Receipts, hold
activation until a reviewed item-level policy protects those records.
The SSO request must name all five selected Lists before any grant.

The protected reader validates the saved Assigned SP agent code and source
revision but does not read raw Thirsty Assigned SP itself. A live source-row
approval must compare assignment, status, hold, and observation timestamp
against a fresh Thirsty readback before activation. A stale saved WO row
cannot arm a preview even if an older draft already occupies the Claim.

Before activation, verify company Entra registration and consent for the
GitHub Pages origin, exact selected List grants and effective ACLs, the
Claims/Receipts unique indexes and actor permissions, current source row and
contact pair, signed historical inventory/migration including old pilot
drafts, a two-coordinator same-key race, an unsent Outlook canary, a Sent
Items canary, CSP for Microsoft sign-in and Graph, the rebuilt Pages bytes,
and a signed-out URL test. The parent CSP permits only the configured same
origin, `login.microsoftonline.com` for MSAL authority calls and frames, and
`graph.microsoft.com` for Graph calls. The local active-mode browser smoke
intercepts those Microsoft requests without reaching the network. A real
sign-in and delegated Graph canary are still required. Verify the Gantt
Release List title, key, owner
set, unique index, and signed inventory against the exact deployed List. The
old pilot WO remains occupied until its draft
is reconciled or migrated. Do not turn on a provider action through a config
flip alone.

This is source only. The current operating WO Source row was found stale in a
read-only pilot reconciliation, and an existing provider draft occupies its
key. This package does not refresh that row, reconcile the draft, alter
SharePoint, publish Pages, or send mail. A refreshed, reviewed source row and
occupied-draft readback remain release gates.

The existing protected WO reader currently accepts `NormalizedVisitKind =
Install` and an explicit approved type/code/status allowlist. Relocation
visits need their own reviewed source classification before this button can
arm for them.

## Local verification

Run `npm ci`, `npm test`, `npm run build`, and `npm run smoke` in this folder.
These exercise synthetic source gates, build the held static site, render it
at desktop and mobile widths, and verify the active-mode CSP permits only
mocked authority, login-frame, and Graph calls. They are not live Entra,
SharePoint, Thirsty, Outlook, or GitHub Pages canaries.
