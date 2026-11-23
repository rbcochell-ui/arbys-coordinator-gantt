# Outlook Sent recovery — held Gantt candidate v2

**Status:** Source-only Draft PR candidate. The public GitHub Pages site is unchanged. The five action controls remain disabled, and the Entra tenant/client and SharePoint List IDs are unbound. This supersedes the v1 packet's build hashes and list-header canary wording; v1 remains as the prior review record.

## Change and evidence

The Sent recovery inventory now asks Microsoft Graph's Sent Items **List messages** operation only for `id` and `sentDateTime`. For each of at most 20 complete pages of 25 entries after the Claim's five-minute lookback, it uses **Get message** with `$select=id,internetMessageHeaders` to inspect the exact opaque draft correlation header. A missing header response, changed ID, failed read, duplicate correlation, incomplete page, or redirected next link leaves the action unresolved and its unique Claim occupied. The sole matching message still receives the existing full mailbox read and Sent Items, non-draft, timestamp, Internet message ID, recipients, subject, body, and required-link checks before a Sent receipt can be written. Neither button has a Graph Send path.

This follows Microsoft's explicit [Get message header example](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0). The [List messages documentation](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0) supports selecting collection properties but does not explicitly demonstrate `internetMessageHeaders` on a collection. The prior candidate depended on that collection behavior. The new bounded per-message reads may be slow or throttled in a busy mailbox; an incomplete scan remains unresolved. A live tenant canary must still prove that an Outlook UI send retains the custom draft header and that the granted app can read it.

## Held build

The Vite production build was repinned at the repository root. The encrypted chart is byte-identical to the prior candidate. The root manifest canonicalizes line endings and binds these SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `index.html` | `962a4684271f4888c404a1fb7f485b1694214ad295912ca8af9ce36388a2c5cc` |
| `assets/app-CfZrTyWg.js` | `37bb6901c2b58ad1ee12e6066132bdb400a3e4da4c1b13c6e85a9a4b18fbf331` |
| `data/gantt.enc.json` | `a7719f606cfbada0cf31187c18ada8548d4b42024653c26888367e1f7ed8c84c` |

The other asset hashes are unchanged in `HELD_BUILD_MANIFEST.json`. The held verifier confirmed disabled controls/configuration, strict `connect-src 'self'`, unchanged ciphertext, no `Mail.Send`, complete private capability, nonfixture literal email, or complete dispatch key in the shipped bundle. The production build contains no direct Microsoft Graph or Entra connection route while held.

## Verification

- Shared Graph tests: **17/17**, including paged metadata + individual-header reads, missing headers, duplicate correlation, UTC boundary, and redirected/partial scan.
- Provider writer tests: **39/39**; integrated Gantt tests: **13/13**.
- Vite production build and isolated headless browser smoke passed. The smoke exercises both invented draft gestures, an occupied key, and return-to-Gantt Sent check with no external requests.
- `node scripts/verify-held-candidate.mjs` and `git diff --check` passed. An independent reviewer found no false-Sent or duplicate-draft path in this patch.

## Activation boundary

The page writes a Sent receipt only when the draft owner returns to the signed-in Gantt or clicks **Check Sent**. A static Pages tab cannot log a send while closed; the unique Claim prevents a second first draft in that interval. The exact app registration and delegated grants, selected SharePoint Lists, pilot-key migration, protected deployment controls, current Thirsty/contact review, and live Outlook draft/Sent canary remain outstanding. Do not enable the buttons or represent this build as a live mail workflow.
