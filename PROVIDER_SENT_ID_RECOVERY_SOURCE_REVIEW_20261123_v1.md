# Provider snapshot Sent ID recovery — local source review

This records the provider source stage before the combined held bundle was
repinned. See `COMBINED_SENT_RECOVERY_HELD_REVIEW_20261123_v1.md` for the final
local artifact and verification receipts.

**Scope:** The snapshot provider writer only. This branch combines the lean
Sent Items scan from the local recovery branch with a provider-specific
fallback. It is a held source change; no cloud List, Outlook, or GitHub write
was made.

When the original draft immutable ID returns 404, the draft owner searches
only their Sent Items for the unique opaque Claim correlation header. The
shared Graph client uses a five-minute pre-Claim lookback, at most 20 complete
pages of 25 items, and rejects duplicate or incomplete results. The provider
writer then reads the one candidate and checks its exact ID and header,
`isDraft=false`, Sent Items folder, sent time, Internet message ID, audience,
subject, body, and all six required myCoke links before storing a Sent
receipt. An alternate Sent ID already in a receipt is only a mailbox-read
hint. Another coordinator cannot verify the owner's mailbox or reopen a
draft link.

No candidate, an incomplete scan, a mailbox error, or a forged receipt leaves
the key occupied and does not create a replacement draft. There is no Send
action or `Mail.Send` scope.

## Local checks

- Provider writer tests: 39/39 pass, including changed-ID receipt and
  re-entry, missing/ambiguous scan, wrong candidate, forged alternate ID,
  nonowner isolation, and no second Claim or draft.
- Shared lean Graph tests: 16/16 pass, including 5-minute UTC rollover,
  inclusive boundary, paging, duplicate header, and partial/redirected scan.
- Integrated site tests: 13/13 pass after `npm ci`; Vite build passes.
- `git diff --check` passes.

The Vite build changes the app bundle hash because it imports this provider
source. The existing pinned root artifact and `HELD_BUILD_MANIFEST.json`
still describe the pre-provider build. Rebuild and repin the disabled root
artifact after this source branch is merged; the current
`verify-held-candidate.mjs` intentionally fails against the new `dist`.

## Required live canary before activation

Use one authorized synthetic provider draft, send it manually through Outlook,
and verify that the owner can read the Sent Items copy with the custom header
through Microsoft Graph, record one Sent receipt, and cannot create another
first draft. If Outlook or Graph omits the header or the bounded scan cannot
complete, keep the action unresolved and the shared Claim occupied.
