# Held Outlook Sent ID recovery — source review

**Status:** Local held-source branch codex/gantt-sent-recovery-source-20261123, based on Draft PR #2 head fe737ba. The rebuilt GitHub site artifacts are pinned locally with all five action controls disabled. No GitHub push, List write, Outlook read, draft, or email. The public Gantt remains unchanged.

## Why this branch exists

The current action reads a draft by the immutable ID saved at creation. Microsoft documents a route where that same ID retrieves the Sent Items copy after Graph Send, while its general mail overview explicitly names sending a draft as an exception to ID stability. The user will send from the Outlook UI, so a 404 after Send cannot be interpreted as either Sent or unsent without another mailbox observation.

Primary references:

- [Immutable Outlook identifiers](https://learn.microsoft.com/en-us/graph/outlook-immutable-id), especially “Immutable ID with sending mail.”
- [Outlook mail REST overview](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0), which names draft sending as an exception.
- [Message resource](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0), which documents custom x- headers and isDraft, parentFolderId, and internetMessageId.
- [List messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0), which documents folder-specific listing, select, paging, and filter/order rules.

## Bounded behavior

After the draft owner receives a 404 for the saved immutable ID, the source scans only the signed-in user's Sent Items from five minutes before the shared Claim time. This bounded lookback handles a browser clock that runs ahead of the mailbox. The scan rejects any returned message older than that bound, fetches at most twenty pages of 25 metadata rows, and requires a complete scan and exactly one copy carrying the opaque correlation header placed on the original draft. It then reads that exact message and checks the header, Sent Items folder, isDraft=false, sent time, Internet message ID, recipients, body and required links before recording a Sent receipt. A previously recorded alternate Sent ID is used only as a read hint; the same mailbox checks still apply. Another coordinator cannot use a shared row as mailbox proof.

No match, duplicate match, incomplete page scan, malformed response, Graph error, or missing Sent item stays unresolved with the unique Claim occupied. The code never creates a replacement draft or calls Graph Send.

## Verification and live boundary

- Lean action tests: 16/16 pass, including a changed-ID Sent copy, no second draft, duplicate/header/redirect/incomplete scan holds, stored alternate ID readback, an inclusive five-minute boundary, and UTC day rollover.
- Integrated site tests: 13/13 pass after npm ci; Vite production build passes.
- The held site root points to `assets/app-9Oeg0XSI.js`, with SHA-256 `d9903f6fd2204350c2bc8f1d70169ac50504c2f1746e18dac3bc04bcd145ef0f`; its pinned HTML, unchanged encrypted chart, disabled configuration, disabled buttons, strict CSP, and private-data scan pass `node scripts/verify-held-candidate.mjs`.
- `git diff --check` passes.

This does **not** prove Coca-Cola Graph returns custom headers in folder listings or that Outlook UI preserves this header on Send. Before activation, an authorized synthetic mailbox canary must create one draft through the action, send it manually in Outlook, observe the actual Drafts and Sent Items IDs and header, verify one Sent receipt, and verify the occupied key blocks another first draft. If Graph omits headers or the scan cannot complete, the action remains unresolved; do not weaken it to subject-only matching.
