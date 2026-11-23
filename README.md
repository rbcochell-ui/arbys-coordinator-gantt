# Arby's coordinator timeline

This repository serves the encrypted Arby's coordinator Gantt. A complete private link, including its fragment key, is required to view the chart. The plaintext chart and its key are not committed. The existing encrypted `data/gantt.enc.json` is unchanged in this candidate.

The coordinator bar now shows separate provider parts and customer tracker draft controls, plus sign-in, source refresh, and Sent Items check controls. **All five controls are checked in disabled.** The source includes a bounded Sent Items check when an authorized coordinator returns from Outlook or reopens an occupied draft selection. A shared Sent record remains labeled unverified until the draft owner checks the original message in their own mailbox; the unique Claim stays occupied meanwhile. That code cannot run in this held build. The chart remains read-only, and Thirsty remains the book of record for work-order changes. This version does not sign in, call Microsoft Graph, create an Outlook draft, or send email.

The viewer remains a public GitHub Pages site. Anyone with a complete private chart link can view the decrypted chart; `noindex` is only a request to search engines. The page keeps the existing restrictive Content Security Policy, including `connect-src 'self'`, so a future configuration change alone cannot enable Graph or Entra calls.

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

This candidate is a local review branch. Enabling the buttons requires a separate reviewed release with Entra app registration, delegated access, restricted Lists, a fresh owner-approved Gantt Release, migrated occupied draft keys, and tenant/mailbox canaries. The source package's [integration README](source/gantt_github_two_button_site_integrated_source_only_20261123_v2/README.md) lists those gates in detail.
