# Customer FORM-to-tracker link proof — source-only

This held runtime now requires two signed-out public files for each issued
customer URL: data/p_<handle>.json for the encrypted status and
data/p_<handle>.link.json for an encrypted FORM binding. The link proof uses the
same 256-bit capability key already in the private URL, with a separate AES-GCM
associated-data domain. Only a SHA-256 marker of the FORM source key appears
inside its ciphertext. The public file contains no plaintext FORM key, name,
address, email, notes, pricing, or capability key.

The proof is issued once per project after a source owner verifies the exact
FORM project and published tracker together. The exported
createCustomerFormLinkProof function returns sidecar bytes for a controlled
publisher; it does not publish them. Use a fresh random nonce for each issuance
under one key. Keep the full private URL and key out of the public repository,
logs, and review comments.

At preview for an occupied customer draft, at first draft, and before either
customer button returns an existing Outlook draft link, CustomerReleaseResolver
checks all readable Release rows for a
unique tracker handle, fetches both public files without cookies or fragment
key in the HTTP request, matches the raw status file to the restricted
CiphertextSha256 field, decrypts both with the private capability, checks the
project handle and freshness, and compares the proof's FORM marker with the
selected FORM key. It holds on a missing proof, duplicate handle, mismatch,
truncated List inventory, changed public bytes, redirect, decryption failure,
or stale status. An occupied old draft cannot become a second draft or yield
its Outlook link without current proof. Check Sent can still verify an actual
Sent Items message and record its receipt without reopening the old draft.

Graph may omit CustomerTrackingUrl on unrelated unissued rows; those blank
rows are ignored, while a missing selected row still holds. The all-row scan
is a bounded observation, not a transactional uniqueness constraint. Owner
issuance must serialize handle assignments and read back the full List; a
separately provisioned unique Handle field would provide a stronger tenant
constraint. The post-Claim resolver check catches observed drift but cannot
make two concurrent owner writes atomic.

The existing one-project pilot has no published sidecar and therefore remains
held by this source. To use the new check, the owner must verify that pilot's
FORM-to-status linkage, publish its one encrypted sidecar, read it back
signed-out, and then refresh the restricted Ready Release row with the current
raw status-file hash and owner receipt. Do not repurpose ReleaseReceiptSha256:
it already identifies the separate owner release receipt. The same issuance
work is needed for each of the other 39 projects before its customer button is
eligible. Daily status refreshes can keep the original URL and static sidecar,
but must update the Release row's raw ciphertext hash and Ready window.

This check proves that the issued FORM key and URL identify the same encrypted
handle and currently served ciphertext. It cannot independently prove the
source owner's judgment that the underlying Thirsty work orders belong to that
FORM project, or that the status page renders correctly. Keep the signed-in
source review and signed-out page readback as separate release gates. No live
file, List row, draft, or email was changed by this source-only candidate.
