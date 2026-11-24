# Suggested provider recipients: held source change

This source change is staged with the provider runtime flags still Off. It
does not publish a page, write a List row, create a draft, or send email.
The approved six-part provider subject and body remain in `contract.mjs`.

For a new installation draft, the protected WO Action Source row and the
dated chart must agree on native WO ID, agent, outlet ACN, store number,
service type, visit kind, status, and service-location street/city/state/ZIP.
The protected Contacts row must use the unique agent+ACN+store `ContactKey`
and agree with that WO row on agent, numeric-equivalent outlet ACN and store,
and exact normalized service address. Leading zeros do not change the numeric
ACN or store identity; an all-zero ACN or store cannot identify a location.
It must have a valid source evidence digest and both role email addresses.
The chart's independent two-workbook candidate must contain the exact same
pair. A contradiction holds before the shared Claim or Outlook draft.

When the protected row has `Verified=false`, an empty `VerifiedAtUtc`, and
`SourceCheckedAtUtc` within 24 hours, both role addresses are **suggested**
in Outlook To. The Gantt preview labels them unverified and requires the
coordinator to confirm the current people and addresses in Outlook before
manually pressing Send. A shared mailbox appears once. The `suggested_pair`
evidence is bound into the existing Claim/Receipt chain, so repeat clicks
reopen the same draft; Check Sent still reads the actual mailbox item.
The dormant lean route also records this evidence in its protected source
binding so a shared-mailbox suggestion remains review-required on reopen.

When the protected row is missing or its source check is stale, To remains
blank under the existing empty-To canary. The coordinator can enter and
verify recipients in Outlook. A contradictory protected row, malformed pair,
or ambiguous chart pair does not authorize a suggested prefill. The source
digest is an attestation carried by the protected Contacts writer; the
browser cannot recompute it from the private workbooks.

No additional operating Contacts rows are included in this source patch.
Rows for other agents require a separate reviewed protected write using the
current work-order and workbook hashes. The current protected key and WO
schema require a numeric store number. The five address+ACN+agent candidates
whose store number is missing need a new protected key/schema and source
review before this route can cover them; an address-only fallback is not
implemented here.
