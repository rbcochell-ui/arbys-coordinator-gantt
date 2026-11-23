# Customer Gantt draft port — source-only verification

Observed November 23, 2026. This package has **not** been published, bound to
Coca-Cola identity, granted Graph or SharePoint access, or exercised against a
real mailbox. Checked-in `HELD_CUSTOMER_BINDING.enabled` is false.

## What was checked

| Check | Result |
| --- | --- |
| Adapter, Release-binding and public-tree invented-data tests | `npm test`: 19 passed, 0 failed |
| Reviewed lean Graph V3 suite in Draft PR #2 worktree | 83 passed, 0 failed |
| Existing held Gantt site suite | 26 passed, 0 failed |
| Vendored source copy | 14 files byte-match the PR worktree at commit `d8b92efb7a9a211614574e948003fcaecd2f263c`; the two local customer-binding patches and all 14 unchanged files match `vendor/VENDOR_PIN.json` |
| Private-data static scan | No known live pilot FORM key, native WO ID, customer/provider email, or full capability fragment found in this package |
| Fresh FORM header check | 126 headers; no explicit submitter-email header |
| Active CSP gate | Runtime reads the current document meta, rejects the current site's `connect-src 'self'` / `frame-src 'self' about:` before Graph, and ignores a caller's stale CSP string; an invented active meta passes |
| Release drift regression | Recipient A to B or tracker A to B after preview: 0 Claim writes, 0 Outlook posts; occupied-preview Claim removed or missing binding: 0/0; post-Claim Release drift: 1 Claim, 0 Outlook; unchanged binding reaches one synthetic Outlook boundary |

The pilot FORM contact evidence comes from
`form_contact_candidate_20261119_v1/README.md` and its protected receipt.
That receipt names `Primary_Contact.Name` and `Primary_Contact.Email`, marks
`originalSubmitterIdentityProved=false`, and leaves recipient review pending.
The November 23 read-only `header_summary.py` recheck found no header combining
submitter/respondent/completed-by with email. This supports a primary contact
candidate, not a verified identity for the person who clicked Submit.

The dated November 23 08:35 UTC SharePoint preflight reported the physical
Gantt Release, Claims, and Receipts Lists absent. The customer pilot Release
was already `DraftReady` with an unsent draft. These are dated observations,
not a fresh tenant readback; they are activation blockers until rechecked and
reconciled. The 40-project coverage audit found one approved tracker/Release.

## Release verdict and next step

**Combined source package ready for independent code review; runtime held.** The
smallest independent customer path is the existing V2 parent UI with a held
provider stub, Lean V3's protected customer Release resolver, and the same
physical unique Claims/Receipts Lists as provider v2. It creates only an
editable unsent Outlook draft after an exact selected FORM key, protected
source checks, and a unique Claim. Check Sent verifies the original owner's
mailbox before writing a shared Sent receipt.

The next engineering step is to copy the versioned overlay into the held
provider v2 source branch, then independently review and rerun the combined
build and browser smoke. The next tenant
step is company SSO and selected-List grant approval, provisioning/readback of
the shared Lists, a corrected active CSP with browser token-renewal evidence,
and migration of the occupied pilot draft. Before enabling
the customer button, verify the literal FORM submitter or obtain an explicit
policy decision to use the approved primary contact instead. No customer
message should be sent by this source package.

## Combined overlay check

The temporary merged production build transformed 210 modules with provider
v2 algorithms unchanged. A rendered invented-data Edge test loaded the
encrypted chart, kept every checked-in button disabled, then substituted a
fake active adapter. It held an unreviewed customer recipient and an
unbound provider preview. It armed and clicked the customer button once
from an exact FORM selection with its Release binding, then armed and
clicked the provider button once with its bound WO preview. Three Microsoft
authority, login-frame, and Graph requests were intercepted locally. There
were zero unexpected external calls and zero page errors. No tenant or
mailbox was contacted. The test command is npm run smoke:combined.

The v2 binding fix is source only and still requires independent cold review.
The historical pilot DraftReady row cannot be used for a new first draft
until its existing draft is migrated to the shared Claim and receipt.
