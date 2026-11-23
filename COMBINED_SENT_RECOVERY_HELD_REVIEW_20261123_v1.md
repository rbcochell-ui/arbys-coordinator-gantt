# Combined Outlook Sent recovery — held Gantt candidate

**Local status:** Based on Draft PR #2 head `fe737ba`. The lean/customer
recovery, its five-minute bounded Graph scan, and the separate provider
snapshot recovery are now in one local branch. No push, cloud write, mailbox
read, draft, or email was made by this build. GitHub Pages is unchanged.

## Behavior in source

The draft owner first reads the saved immutable Outlook ID. If it returns
404, the shared Graph client scans only that owner's Sent Items from five
minutes before the Claim, at most 20 complete pages of 25 messages, for one
exact opaque correlation header. A duplicate header, incomplete scan, Graph
error, or missing item stays unresolved with the unique Claim occupied.
The writer reads a candidate again and verifies its ID, header, Sent Items
folder, `isDraft=false`, sent timestamp, Internet message ID, recipients,
subject, body, and required links before recording one Sent receipt. A
stored alternate Sent ID is only a hint; another coordinator cannot treat
the shared row as mailbox proof. No replacement draft or Send path is added.

## Held root artifact

The production Vite build has been repinned at the repository root. The
encrypted chart is unchanged from the preceding PR head, and the manifest's
`baseCommit` still names its original published Gantt commit `01052b5`.
All five action
buttons and runtime integration flags remain disabled and unbound. The CSP
allows no Microsoft Graph or Entra network destination (`connect-src 'self'`),
and the bundled app contains no `Mail.Send` scope or real pilot details.

Canonical SHA-256 values (line endings normalized as in the verifier):

| File | SHA-256 |
| --- | --- |
| `index.html` | `270408704f90f8ddf9999f1a821f1615c088e4d9e5a4d9ce80838401eea81e5b` |
| `assets/app-DwrCy-NK.js` | `e53c18b3c9c149eedb7a8397f43e5457bb211a5d32666f48ddefc5863a7c9177` |
| `assets/Configuration-B1Fwyfg7.js` | `881266e02f43dccd2248429b64c24037975728c5348c9a39fd35ee79b466c57e` |
| `assets/redirect-Ck1ZdWvy.js` | `aad76963f46e86e1d4cec6d369343ae24a25e1e8301cd6de81819cf027f8ef4e` |
| `auth/redirect.html` | `a437c7d91a122bbe320077ab9ecd610b4f72a3087db1ad2c66e7b181f3e1e09c` |
| `data/gantt.enc.json` | `a7719f606cfbada0cf31187c18ada8548d4b42024653c26888367e1f7ed8c84c` |

## Local verification

- Provider writer tests: 39/39 passed.
- Shared lean Graph tests: 16/16 passed.
- Integrated site tests: 13/13 passed; Vite production build passed.
- Provider dated-panel and integrated-site headless Edge smokes passed with
  invented loopback fixtures and no external requests.
- `node scripts/verify-held-candidate.mjs` passed against the repinned root
  and rebuilt `dist`: unchanged ciphertext, disabled controls/configuration,
  strict CSP, and no bundled send scope, private key, literal pilot email,
  or complete dispatch key.
- Staged privacy scan passed across all eight changed files: no complete
  dispatch key, private capability, literal nonfixture email, or executable
  `Mail.Send` scope. `git diff --cached --check` passed, and the working tree
  matched the staged files.

## Live release boundary

This held bundle cannot sign in or create a draft. Before activation, use one
authorized synthetic mailbox canary. Create one draft through the action,
send it manually in Outlook, and verify that Graph returns the custom header
on its paged Sent Items listing. Confirm one owner-verified Sent receipt and
that the occupied key blocks another first draft. If the header is absent or
the scan cannot complete, leave the action unresolved; do not fall back to
subject matching.
