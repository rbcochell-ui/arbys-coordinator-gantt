# Offline legacy migration admission gate

This folder contains only a guarded wrapper. The V3 migration implementation,
its two pilot bindings, and restricted evidence remain outside this Gantt
source tree. The browser entry and action runtime have no import path to this
folder. A separately reviewed, attended offline runner must inject the exact
V3 migration API through `createGuardedLegacyMigration` and use only the
returned preparation, proof, and one-shot import functions.

The wrapper parses the directly observed Outlook HTML with the same strict
anchor rules as the owner reopen adapter. It checks that declared links are
present in the actual HTML during planning and every import observation. A
customer draft may have edited HTML; V3 binds that observed HTML hash in its
Draft Receipt. The saved Release template still needs its exact tracker
anchor. Unsupported Graph HTML holds the import until both contracts are
reviewed together.

This source does not run a migration or change any cloud state.

## Held Gantt integration

The disabled browser composition injects `LegacyOwnerRecovery` only when a
separately reviewed `legacyOwner.enabled` binding and an owner-restricted
migration-proof reader are both supplied. The checked-in binding is `null`.
Customer actions use the Lean Claim/Receipt store; provider actions use the
Snapshot writer. Both preserve the occupied key on failed proof and open only
the original owner's verified immutable Outlook draft. The optional Check Sent
port can append one exact `|Sent` receipt in the selected Receipts List after
the same immutable item is proven in Sent Items. It never sends mail or creates
a replacement draft.

An uncertain Sent receipt POST or readback latches that dispatch key in the
current runtime before the POST port is invoked. Later Check Sent calls inspect
for the exact persisted receipt and cannot issue another POST from that
runtime, including when two calls overlap. This latch is **not durable across
reloads, tabs, or devices**. The physical unique `ReceiptKey` prevents two
persisted rows, but it does not itself prove whether an uncertain write
occurred. A durable cross-session reconciliation gate, with an exact receipt
readback after an uncertain outcome, is required before the legacy Sent write
route can be released live.

Before any live enablement, the release config must pin the independently
reviewed original restricted row ETag and canonical full-field SHA-256 for
each pilot, plus V3 migration plan, Claim, and Draft Receipt readbacks. The
owner-restricted proof reader, signed complete inventory, selected-List grants,
and original mailbox items must be verified in the tenant. Then run attended
owner and nonowner browser canaries and a same-immutable-ID Sent receipt canary.
The original V3 migration implementation and its pilot bindings remain outside
the browser source; an attended offline runner must use this wrapper.
