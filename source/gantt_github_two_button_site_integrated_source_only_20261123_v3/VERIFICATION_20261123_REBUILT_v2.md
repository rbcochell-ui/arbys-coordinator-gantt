# Held two-button Gantt candidate: rebuilt verification

Observed 2026-11-23, 21:09 UTC in the Draft PR checkout. This records a local,
disabled candidate. It is not a live Pages, tenant sign-in, SharePoint, or
Outlook receipt, and it does not authorize enabling either draft button.

## Source and behavior checked

- The integrated site imports the snapshot-first provider V4 route and lean
  customer V3 route. Provider first drafts require the exact protected WO and
  verified contact join. Customer first drafts require the reviewed Release
  binding. Both use the same unique Claim and receipt store.
- A provider preview binds the displayed recipient pair and source versions to
  the click. If another tab occupies the key after that preview, the old click
  holds; a fresh occupied preview can reopen the existing draft. A preview
  that expires during legacy work or Graph token acquisition makes no Claim.
- The customer click binds the displayed suggested recipient and tracker
  marker. A changed Release, recipient, link, or expired preview holds before
  Claim or Outlook. Expiry during Graph token acquisition also makes no Claim.
- The provider template retains all six reviewed myCoke links. A verified
  manager/planner shared mailbox is addressed once. The current site contains
  no Send control or `Mail.Send` scope; an Outlook draft requires human review.

## Local checks

| Check | Result |
| --- | --- |
| Snapshot provider V4 `npm test` | 70/70 passed |
| Integrated site V3 `npm test` | 38/38 passed |
| Lean Graph V3 `npm test` | 86/86 passed |
| Customer port V2 `npm test` | 19/19 passed |
| Snapshot provider V4 `npm run smoke` | Isolated Edge dated-panel smoke passed; zero external requests |
| Integrated site V3 `npm run smoke` | Isolated Edge held build and temporary fake runtime passed; zero external requests |
| Root `node scripts/rebuild-held-candidate.mjs` | Fresh Vite production build passed; five root files pinned |
| Root `node scripts/verify-held-candidate.mjs` | Passed disabled controls/config, strict CSP, unchanged chart ciphertext, no bundled Send scope or private pilot details |
| Root `node scripts/verify-public-tree.mjs` | Passed 237 repository files; no unreviewed email, source ID, tracker key, or credential literal |
| `git diff --check` | Exit 0; only Windows line-ending conversion notices |

The rebuilt root app asset is `assets/app-DppXxOCC.js`, with canonical SHA-256
`0f29c35a5c527cf3353547765f59f7d315f5b13c698715d873dece4808b89014`.
The exact root asset and page hashes are in `HELD_BUILD_MANIFEST.json`. The
encrypted chart asset remains at SHA-256
`a7719f606cfbada0cf31187c18ada8548d4b42024653c26888367e1f7ed8c84c`.
The checked-in runtime configuration is disabled and unbound. The root page's
Content Security Policy still blocks Graph and Entra network calls.

## Release boundary

No cloud List, mailbox, or Pages action ran during this verification, and no
email was sent. The live `main` Gantt remains read-only. The Draft PR has no
hosted check result in this record. Before activation, the team still needs
the company SSO/security route, verified restricted Claims/Receipts/Gantt
Release Lists and effective coordinator access, a complete signed historical
draft-key inventory and occupied-key migration, fresh approved Thirsty and
provider/customer source rows, reviewed private customer URLs, a permitted
Graph CSP, and attended draft/Sent Items canaries. The existing pilot source
and daily customer refresh remain separately gated.
