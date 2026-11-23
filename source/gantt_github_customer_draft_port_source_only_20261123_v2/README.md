# Arby's Gantt customer draft port — held source-only v2

This package isolates the **customer tracker draft button** from provider
activation. It reuses the reviewed lean Graph V3 customer Release resolver,
shared unique Claim/Receipt writer, and attended Sent Items check. It makes no
Power Apps or Power Automate call. `held_config.mjs` is disabled and contains no
tenant, app, List, customer email, private tracker URL, or capability key.
Nothing here is deployed or able to send email.

## Exact route

1. The encrypted Gantt selects an allowlisted exact `FormSourceKey`. The port
   requires that same current key for preview, draft, and Check Sent. Selection
   supplies **only an ID**; it never supplies a recipient or tracking URL.
2. Under the signed-in coordinator's delegated Graph account, lean V3 reads
   the restricted `Arbys Customer Draft Releases` singleton by that key. A
   current owner-issued `Ready` row supplies the approved recipient and the
   **full private project URL**. The row must have a current release receipt,
   supported release kind, exact canonical HTML copy, and a fresh review
   window. The existing 17-field List is read only. The preview carries an
   opaque binding of the exact Release digest, ETag, recipient, tracker URL
   SHA-256 marker, FORM key, and expiry. It never exposes the full tracker URL.
3. At click, the action rereads the Release and compares it to that displayed
   binding **before** a physical unique `customer-tracker:<FormSourceKey>`
   Claim is created in
   the same shared Claims List used by provider drafts. Its source row and the
   signed historical inventory are rechecked before one Graph
   `POST /me/messages` creates an **unsent** editable Outlook draft. The
   Draft receipt stores only the tracker URL's SHA-256 marker. The full URL
   stays in the restricted Release and the owner's Outlook draft. A changed
   recipient or tracker holds before the Claim and Outlook POST. A change
   after Claim also holds before the POST.
4. A repeat click can reopen the original mailbox's draft. Another
   coordinator or an uncertain Claim cannot create a second first draft.
   The original draft owner can run the attended Check Sent; only an actual
   matching Sent Items message creates the shared Sent receipt. A shared Sent
   row alone is displayed as unverified to other coordinators. There is no
   `Mail.Send` permission or Send API route.

The actual FORM answer used for this project is the designated end-of-form
`Primary_Contact.Email`. That is the customer contact Ryan selected for an
editable draft; it is **not proof of who clicked Submit**. A fresh read-only
header audit on November 23 found 126 FORM export headers and no explicit
submitter email header. The protected pilot candidate receipt names
`Primary_Contact.Name` and `Primary_Contact.Email`, records
`originalSubmitterIdentityProved=false`, and has no completed recipient
review. Ryan's approval of Manish as a draft recipient does not establish
that Manish completed the FORM. Ryan subsequently chose to prefill the FORM
Primary Contact as a **suggested** Outlook To for each reviewed project;
Tony or Harmony must verify the intended customer before Send. The held
release process still needs a fresh owner-issued Ready Release and receipt
that pin the exact FORM key, `Primary_Contact.Email` candidate, and private
tracker link.

## Integration contract

The overlay folder is a held combined-site candidate for the reviewed
provider v2 Pages shell. Copy this package beside provider v2 in a source
review branch, then copy overlay/src/combined_compose.mjs to provider src
and the four overlay/site files to their matching provider site paths.
The provider source algorithms remain unchanged. The overlay uses one MSAL
session and one delegated Graph client, validates that both routes name the
same physical unique Claims and Receipts Lists, and gives the customer
button its own Release preview and click. The provider button still
requires its bound WO/contact preview. The checked-in combined config
disables both routes and contains no live IDs or recipient data.
The customer-facing control is labeled "Create or reopen customer milestone
draft"; its unique link still comes only from that project's protected
Release, not from the chart HTML.

The UI shows the customer recipient as an owner-approved Release value.
It warns that the address does not prove who clicked the FORM Submit button.
An eligible customer preview must contain exactly one recipient, no Cc,
a current review window, its exact Release binding, and no recipient-review
flag before the button arms. An eligible preview cannot silently become an
occupied draft from another tab; refresh is required. An existing occupied
draft can reopen without a new first draft;
its recipient must be checked in Outlook. A provider preview without its
bound native WO ID cannot arm its button. The local rendered test exercises
both paths and actually clicks the customer button with invented data.

`prepareCustomerOnlyParentRuntime(...)` returns the existing Gantt V2 parent
control interface. Its provider operations are held stubs, so the customer
button can be prepared without provider activation. The lower-level
`prepareCustomerPort(...)` returns `preview(kind,id)`, `customerDraft(id,binding)`,
and `checkCustomerSent(id)` for a combined deployment. Both take the current
frame bridge's `getSelection()` and the parsed allowlist from the owner-reviewed
encrypted chart. The chart is a UI selector, not the authorization source.
The restricted Release, List permissions, and shared Claim are the data and
duplicate gates.

Both preparation functions require `sharedStoreLists: {claims, receipts}`
supplied from the independently reviewed provider/coordination deployment
binding. These IDs must equal the customer lean config's Claims and Receipts
IDs. The provider's `lean.lists.customerReleases` can remain null and its
button can remain Off. This runtime equality check reduces accidental split
ledgers; effective List identity, uniqueness, and permissions still require
live readback before activation. The parent runtime also requires an attended
Entra `signInFromClick` callback and a delegated Graph client; the held config
constructs neither.

Active preparation reads the current page's CSP meta tag directly from the
document; it does not accept a caller-supplied CSP string.
`assertCurrentCustomerCsp` holds unless `connect-src` permits the exact
`login.microsoftonline.com` and `graph.microsoft.com` origins and `frame-src`
permits the Microsoft login origin. The current two-button site source has
`connect-src 'self'` and `frame-src 'self' about:`, so an active customer
runtime is blocked until the shell is changed and a signed-in browser network
test succeeds. A response header can impose a stricter policy than the meta
tag, so this check alone does not prove token acquisition or renewal works.

The CSP warning above describes the older two-button shell. The combined
overlay supplies the required Microsoft origins, and the invented-data Edge
smoke intercepts authority, login-frame, and Graph calls. A stricter HTTP
response header and actual tenant behavior remain live activation checks.

This source-only package includes a hash-pinned copy of the 15 lean V3 `.mjs`
modules and one V2 parent adapter. Fourteen files still byte-match Draft
PR #2. The customer-only actions module and V2 parent adapter have local v2
preview-binding patches with their original and new hashes recorded in
`vendor/VENDOR_PIN.json`; they require independent review before merging.
That PR branch contains newer customer Sent and historical-fence code than
the original workspace's V3 folder. A future Pages build must use only one
reviewed copy of that core and verify the pinned bytes.
Do not place the protected Release row or full capability URL in
the public repository, tests, query parameters of the Gantt URL, or logs.

## Activation gates

- Company Application SSO must accept the Pages origin and register the exact
  redirect. Verify named coordinators with delegated `User.Read`,
  `Mail.ReadWrite`, and `Lists.SelectedOperations.Selected`; no `Mail.Send`.
- Update the held site's CSP for Graph and Microsoft login, then verify
  active-mode token acquisition and renewal in a real signed-in browser.
- Provision and read back the restricted Gantt Releases inventory List and
  the **same physical** unique Claims and Receipts Lists used by provider.
  Verify effective Ryan/Owners/Tony/Harmony access, selected app grants,
  sharing links, unique columns, and current List identity. The November 23
  08:35 UTC read found these three Lists absent.
- Reconcile the occupied pilot customer `DraftReady` row and its existing
  unsent Outlook draft into a shared Claim/Draft receipt before any first
  draft. Keep old writers Off; a Boolean migration flag is insufficient.
- Owner-review each project's FORM contact, encrypted tracker, signed-out
  full-link result, and current source before a `Ready` Release. At the dated
  audit, only one of 40 Gantt projects had an approved tracker and Release.
- Apply Ryan's suggested-recipient policy: use `Primary_Contact.Email` as the
  proposed Outlook To, never call it the proven FORM submitter, and require
  Tony or Harmony to verify the customer before Send.
- Require a freshly owner-issued Ready Release and release receipt that pin
  the exact FORM key, `Primary_Contact.Email` source field and proposed value,
  and private tracker link for that project.
  The dated pilot candidate still says recipient review is pending.
- Run attended live canaries: exact selected key, two-coordinator Claim race,
  original draft reopen, full private URL in the editable Outlook draft,
  manual Send, original mailbox Sent Items receipt, changed recipient/body,
  and re-entry after the page is closed. Keep the source held if the mailbox
  message is missing or ambiguous.

Run `npm test` here. With reviewed provider v2 in a sibling folder, run
`npm run smoke:combined`; from a separate checkout set ARBYS_PROVIDER_V2_ROOT
to the exact provider v2 package path. This smoke stages a temporary merged
build, serves an invented encrypted chart on loopback, checks that the
checked-in buttons stay disabled, and clicks both invented active routes.
Then run the pinned lean V3 suite (83 invented-data tests at this source
revision) and the provider v2 suite. These are not tenant or mailbox evidence.
