# Arby's coordinator timeline

This repository serves the encrypted Arby's coordinator Gantt. A complete private link, including its fragment key, is required to view the chart. The plaintext chart and its key are not committed. The existing encrypted `data/gantt.enc.json` is unchanged in this candidate.

The coordinator bar now shows separate provider parts and customer tracker draft controls, plus sign-in, source refresh, and Sent Items check controls. **All five controls are checked in disabled.** The source includes a bounded Sent Items check when an authorized coordinator returns from Outlook or reopens an occupied draft selection. If Outlook changes the draft's immutable ID on Send, the owner-only check searches at most 20 complete pages of 25 Sent Items from five minutes before the Claim, requires one exact opaque correlation header, and verifies the candidate in the owner's mailbox before recording Sent. A shared Sent record remains labeled unverified until that owner check succeeds; the unique Claim stays occupied meanwhile. That code cannot run in this held build. The chart remains read-only, and Thirsty remains the book of record for work-order changes. This version does not sign in, call Microsoft Graph, create an Outlook draft, or send email.

The viewer remains a public GitHub Pages site. Anyone with a complete private chart link can view the decrypted chart; `noindex` is only a request to search engines. The page keeps the existing restrictive Content Security Policy, including `connect-src 'self'`, so a future configuration change alone cannot enable Graph or Entra calls.

The held source also checks a complete, owner-signed inventory of historical draft keys before and after a new unique Claim. An occupied key stays held, including the two existing pilot drafts. The inventory reader rejects incomplete or expired proof, changed Release ETags, and a stale proof replay before an Outlook draft POST. This is source-only: no signed inventory, tenant grants, or live coordinator canary is installed. Proof expiry uses the browser clock, and a historical writer could add a key while Outlook obtains a token. Historical writers must be durably retired or checked live before release; a signed Off snapshot alone can become stale if an old writer is restarted.

For a new provider draft, the source now independently reads the protected work-order and verified-contact Lists under the coordinator's account. It requires the selected work-order ID and number, agent, store, ACN, visit kind, work-order type, service code, status, and both distinct recipient addresses to match the dated chart. It repeats the protected read after the unique Claim and holds before Outlook if the source changes. A missing store number and a relocation visit remain held for review. The operating work-order source must be refreshed from Thirsty, and Tony and Harmony's effective read access to both protected Lists must be verified before activation. If a post-Claim check fails, the Claim remains occupied without a draft until an owner reconciles it; that safe recovery procedure and durable recording of the protected source versions remain live-release work.

## Rebuild and verify this held candidate

The staged v2 site source and its three source dependencies are vendored under `source/`. The production Vite output is pinned at the repository root, where GitHub Pages serves it. From `source/gantt_github_two_button_site_integrated_source_only_20261123_v2`, run:

```text
npm ci
npm test
npm run build
npm run smoke
```

Then run `node scripts/verify-held-candidate.mjs` from the repository root. The verifier checks the pinned root files, unchanged encrypted chart asset, disabled runtime configuration, disabled buttons, restrictive CSP, and rebuilt output when `dist/` is present. `HELD_BUILD_MANIFEST.json` records the exact candidate hashes. The smoke uses only an invented encrypted chart on loopback and makes no external requests.

The vendored snapshot provider has its own regression suite. Run `npm ci`, `npm test`, and `npm run smoke` from `source/gantt_github_snapshot_first_provider_flow_source_only_20261123_v4` to exercise the unique Claim, editable draft, Sent receipt, concurrent-Claim recovery, and dated panel with invented data.

This candidate is a local review branch. Enabling the buttons requires a separate reviewed release with Entra app registration, delegated access, restricted Lists, a fresh owner-approved Gantt Release, a signed complete historical-key inventory, migrated occupied draft keys, and tenant/mailbox canaries. A synthetic Outlook UI send must prove the custom correlation header survives in the Sent Items listing and that the bounded owner check records exactly one Sent receipt. The source package's [integration README](source/gantt_github_two_button_site_integrated_source_only_20261123_v2/README.md) lists the other gates in detail.
