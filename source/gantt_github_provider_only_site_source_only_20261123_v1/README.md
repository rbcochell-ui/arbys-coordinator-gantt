# Held GitHub Gantt provider-only route (Nov 23)

This versioned source is a narrower first button for the Arby's coordinator
Gantt. It does not use Power Platform or require a complete FORM→Case→WO
packet. The encrypted GitHub Pages chart supplies only an exact native Thirsty
Work Order ID selected by a coordinator. It is **not** the authority for the
recipient, work-order phase, or duplicate state.

## What the button would do after release

1. Sign an approved coordinator into the company Entra SPA with delegated
   `User.Read`, `Lists.SelectedOperations.Selected`, and `Mail.ReadWrite`.
   There is no `Mail.Send` scope or Send button in this app.
2. Read exactly one current row by native WO ID from the restricted
   `Arbys Provider Parts WO Action Source` List. Require its WO number,
   Assigned SP agent code, approved install status, non-held state, and
   source observation within 24 hours. The protected reader's source
   revision and ETag guards remain in force.
3. Join exactly one reviewed contact row by agent code, outlet ACN, and store
   number from the restricted `Arbys Provider Parts Verified Contacts` List.
   Require two distinct, current install-manager and planner email addresses.
   A missing, stale, or shared-mailbox pair **holds** this route; there is no
   blank-To fallback. Coordinators can still edit recipients in Outlook.
   Before the draft button arms, a second protected read displays the WO
   number, Assigned SP agent code, saved WO status, source-observed
   UTC time, store number, and both To addresses. An occupied draft can only
   be reopened from this page when that same current preview succeeds.
   This is a saved-source preview, up to 24 hours old. The coordinator must
   check the live Thirsty phase, assigned agent, date, and scope before Send.
4. Check the owner-signed historical provider-draft inventory, then use a
   SharePoint-enforced unique `provider-parts:<native WO ID>` Claim. Reread
   the protected WO/contact source and historical inventory after that Claim.
   Create one editable **unsent** Outlook draft with the six exact myCoke
   product links and material numbers. Read the draft back before recording
   the Draft receipt.
5. On the coordinator's return or explicit **Check Sent Items**, inspect the
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

The public chart's selection allowlist is a user-interface check, not a
server-side pilot cohort boundary. The attended pilot therefore needs an
owner-controlled WO Source population limited to approved pilot work orders,
or a separately reviewed action-layer allowlist. The current protected reader
validates the saved Assigned SP agent code and source revision but does not
read raw Thirsty Assigned SP itself; the live source-row approval must compare
that assignment against a fresh Thirsty readback before activation.

Before activation, verify company Entra registration and consent for the
GitHub Pages origin, exact selected List grants and effective ACLs, the
Claims/Receipts unique indexes and actor permissions, current source row and
contact pair, signed historical inventory/migration including old pilot
drafts, a two-coordinator same-key race, an unsent Outlook canary, a Sent
Items canary, CSP for Microsoft sign-in and Graph, the rebuilt Pages bytes,
and a signed-out URL test. Verify the Gantt Release List title, key, owner
set, unique index, and signed inventory against the exact deployed List. The
old pilot WO remains occupied until its draft
is reconciled or migrated. Do not turn on a provider action through a config
flip alone.

The existing protected WO reader currently accepts `NormalizedVisitKind =
Install` and an explicit approved type/code/status allowlist. Relocation
visits need their own reviewed source classification before this button can
arm for them.

## Local verification

Run `npm ci`, `npm test`, `npm run build`, and `npm run smoke` in this folder.
These exercise synthetic source gates, build the held static site, and render
it in a local browser at desktop and mobile widths. They are not live Entra,
SharePoint, Thirsty, Outlook, or GitHub Pages canaries.
