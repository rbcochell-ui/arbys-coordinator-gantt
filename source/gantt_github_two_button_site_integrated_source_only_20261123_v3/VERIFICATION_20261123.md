# V3 PR-checkout source-only verification — 2026-11-23

**Historical record, superseded.** The source, test counts, imported provider
route, and built asset named below describe an earlier local candidate. Use
`VERIFICATION_20261123_REBUILT_v2.md` and the root
`HELD_BUILD_MANIFEST.json` for the current held candidate. This record does
not establish a live Pages or Outlook result.

This is a local, disabled composition candidate in the Draft PR checkout. Its
source may be visible in the PR, but it has not been deployed to Pages or
enabled for tenant use, nor exercised against protected Case/FORM sources,
Microsoft Graph, SharePoint, or Outlook. The checked-in
`integration_config.mjs` remains `enabled:false`.

## Local checks

- Site V3 `npm test`: **26/26 passed**. Every named PR V2 site-composition
  and return-check test remains present; V3 adds protected-linkage,
  recipient-copy, and unverified-Sent cases.
- Provider V5 `npm test`: **13/13 passed**, including V5 → PR V4 parent-adapter
  handling of an occupied, unverified Sent row without creating a draft.
- Exact-linkage guard and linkage adapter: **27/27 passed** with invented data.
- Reviewed PR provider V4 `npm test`: **45/45 passed** separately. Its writer
  and parent adapter are imported by V3/V5 and were not edited here.
- Reviewed PR lean Graph V3 `npm test`: **83/83 passed** separately. Its signed
  inventory and optional owner recovery are preserved in V3 composition.
- Site V3 `npm run build`: Vite production build passed; `dist/data` is absent.
- Site V3 `npm run smoke`: isolated Edge smoke passed with a temporary invented
  runtime and no external requests. The fake runtime was removed from `dist`.
- Changed source/tests scan: 10 email-shaped strings, all
  `@example.invalid`; zero seven- or eight-digit numeric literals.

## SHA-256 of V3 files and built output

These hashes are from this **sanitized PR checkout**, after the legacy fence
compatibility change and fresh local build. `dist/` is ignored and is not part
of this PR.

| File | SHA-256 |
| --- | --- |
| `src/compose_site.mjs` | `71D5DE729F509B3C3074BB4F58A2EBC03D593A61E060C7B4141FD792FF3EE4CD` |
| `site/actions/integration_config.mjs` | `10E14107B6E3FACE7B4529720D8087CA010975AE4E55F6B98BA6EE753DF817EF` |
| `site/actions/ui_controller.mjs` | `E4C5F1F478B31BBE04BC81613F128270C3449BC1EDB5BA9612E88DEBD965EE9F` |
| `site/actions/dated_provider_review_panel.mjs` | `37B52A8AF4F639D79F909F4BBCD5FCC55F20CE776096E1AF328231A18138AFCE` |
| `tests/protected_linkage_port.test.mjs` | `186454E1C1974A40CC516613B310B7CE2C78B4795C0FA52A0D71D29AB0F1E96B` |
| `tests/dated_provider_panel.test.mjs` | `A5EC169C074FC16FD742A5070B4BB581951350093FD327E41930B8230EF59671` |
| `tests/return_sent_check.test.mjs` | `BA800991E5D62AC021893DED6184555C164B7606E345B28566629F69A5232C9A` |
| `tests/site_composition.test.mjs` | `C3828623EE7C7E6395138821884C0F2AA59DDD116C4003DFE0F2646EFB410D62` |
| `README.md` | `145935D20E45837ADD7F9FDFBF8352397B76B4B5989AD17DB18D38F2D18210B1` |
| `package.json` | `03F04A5B67ECE42EB7B74A29AD08C1BD251139CFDE66DAF25F9560170520C358` |
| `package-lock.json` | `0AF45DFD3FB8D1F48672D5E011BBFD4B8F381BBB89EA3B7BB175A88D6E219A25` |
| `dist/index.html` | `4094592267508D36CCE77A21DC54755597844A2A65AEB8BEF86ADC3A40B11D2D` |
| `dist/assets/app-Damm0Bsi.js` | `6ED0564EA4B99ED74206BCD5E7B9A33B1A7FA1130387490FE47235389E44BB5E` |

## Pinned PR-context dependencies

| File | SHA-256 |
| --- | --- |
| `../gantt_github_snapshot_first_provider_flow_source_only_v5/snapshot_first_provider_flow.mjs` | `27BA0630BCE7586A01471FF1E84453D112872D5960195FB3EB0465287E497AC0` |
| `../gantt_github_snapshot_first_provider_flow_source_only_v5/tests/linkage_flow.test.mjs` | `4AF83B65AD2BB712FD4D8558287EADC0442FAE5252067F1CAA3229E7E5623C48` |
| `../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/release_reader.mjs` | `9C8E0F2B397069E53AEFB1F0376268451CD8CD0602A0D0B8D9FE1FAAABF8E9A3` |
| `../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/snapshot_provider_writer.mjs` | `8E3F459024DBC7AB7F6192FCF7EB542D47A45D425B7D4376E09F04BC6809941B` |
| `../gantt_github_snapshot_first_provider_flow_source_only_20261123_v4/snapshot_parent_adapter.mjs` | `C09925963B123D70330833114F7049EC53E0404275F88F76A838160421FEE4C5` |
| `../github_gantt_graph_actions_lean_source_only_20261122_v3/actions.mjs` | `3D04B3D34CEDF9572568F0832118E3F67668B22A63D18CA9D959AD4B69D0DC26` |
| `../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_team_inventory_fence.mjs` | `C8F924EFE479980B3ECF991F2B1E0A41EDC569BAB1BD0B62B512D11149329A77` |
| `../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_owner_recovery.mjs` | `6D1B344A20561FD971F92B4A9E6FEC5E48139F07A78E07DDA88ACCD367EA9248` |
| `../gantt_linkage_read_adapter_source_only_v1/linkage_read_adapter.mjs` | `7AEC449BF4B36EA0E0665E3621F71B21E1FBD8CEE321AF008258329A94FB54F0` |
| `../gantt_exact_linkage_guard_source_only_v1/exact_linkage_guard.mjs` | `57183387CA15803D4AC7D6109418FF375C8A479097215711FC0D929A647AA2FE` |

## Held release requirements

1. The checked-in site supplies no protected Case/FORM packet or owner-approval
   reader. V5 holds provider preview/draft until both distinct, protected,
   current readers are injected. It never constructs evidence from chart data.
2. An active config needs the signed historical inventory pins. The PR V2
   owner inventory loader and optional owner recovery are preserved. A missing
   or invalid inventory cannot arm a first draft. An occupied shared Sent row
   remains unverified and cannot arm another draft.
3. Protected packet provenance, owner approval, ACLs, freshness, native
   WO/Case/FORM coverage, live signed inventory, Entra registration, Graph
   permissions, List schemas/ACLs, CSP changes, and mailbox canaries still need
   separate tenant readback before enablement or publication.
