// Validate the selected protected customer tracker generation and return its
// Thirsty source time. A List read, Pages check, or pointer activation is not
// evidence that the tracker content was refreshed.
import {createHash} from 'node:crypto';
import {decodeBase64Url} from '../crypto.mjs';
import {validateCustomerTrackerUrl} from '../actions/pilot_binding.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function need(ok) {
  if (!ok) throw new Error('Verified tracker source evidence is unavailable');
}

function sha(bytes) {
  need(Buffer.isBuffer(bytes));
  return createHash('sha256').update(bytes).digest('hex');
}

function json(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 64_000);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Verified tracker source evidence is unavailable'); }
}

function instant(value) {
  need(typeof value === 'string' && UTC.test(value) && Number.isFinite(Date.parse(value)));
  return Date.parse(value);
}

/** The publisher pins these exact bytes under the selected CURRENT pointer. */
export function verifiedTrackerLastVerifiedAtUtc(artifacts, trackerUrl) {
  const url = new URL(validateCustomerTrackerUrl(trackerUrl));
  const urlSha = sha(Buffer.from(url.href, 'utf8'));
  const customerKey = new URLSearchParams(url.hash.slice(1)).get('k');
  const keySha = sha(Buffer.from(decodeBase64Url(customerKey)));
  const pointerRaw = artifacts?.pointerRaw;
  const generationPointerRaw = artifacts?.generationPointerRaw;
  need(Buffer.isBuffer(pointerRaw) && Buffer.isBuffer(generationPointerRaw) &&
    pointerRaw.equals(generationPointerRaw));
  const pointer = json(pointerRaw);
  need(pointer.schema === 'ArbysCustomerDailySuccessorPointer/v1' &&
    pointer.state === 'CURRENT' && Number.isSafeInteger(pointer.sequence) &&
    pointer.sequence >= 1 && SHA40.test(pointer.commit) &&
    SHA40.test(pointer.previousCommit) &&
    pointer.customerUrlSha256 === urlSha && pointer.keySha256 === keySha &&
    [pointer.receiptSha256, pointer.ciphertextSha256, pointer.sourceCsvSha256,
      pointer.sourceReadbackSha256, pointer.priorStateSha256,
      pointer.candidateManifestSha256, pointer.previousPointerSha256,
      pointer.previousReceiptSha256].every(value => SHA64.test(value)));
  instant(pointer.activatedAtUtc);

  const receiptRaw = artifacts.receiptRaw;
  const priorStateRaw = artifacts.priorStateRaw;
  const manifestRaw = artifacts.manifestRaw;
  const proofRaw = artifacts.proofRaw;
  const receipt = json(receiptRaw);
  const state = json(priorStateRaw);
  const manifest = json(manifestRaw);
  const proof = json(proofRaw);
  const readback = json(artifacts.sourceReadbackRaw);
  need(sha(receiptRaw) === pointer.receiptSha256 &&
    sha(priorStateRaw) === pointer.priorStateSha256 &&
    sha(manifestRaw) === pointer.candidateManifestSha256 &&
    sha(artifacts.sourceCsvRaw) === pointer.sourceCsvSha256 &&
    sha(artifacts.sourceReadbackRaw) === pointer.sourceReadbackSha256 &&
    sha(artifacts.ciphertextRaw) === pointer.ciphertextSha256 &&
    sha(artifacts.viewerManifestRaw) === receipt.viewerManifestSha256 &&
    sha(proofRaw) === receipt.signedOutReadbackSha256);
  need(receipt.schema === 'ArbysCustomerDailySuccessorPublished/v1' &&
    receipt.remotePublished === true && receipt.customerEmailSent === false &&
    receipt.commit === pointer.commit && receipt.baseHead === pointer.previousCommit &&
    receipt.customerUrlSha256 === urlSha && receipt.keySha256 === keySha &&
    receipt.publicFileSha256 === pointer.ciphertextSha256 &&
    receipt.sourceCsvSha256 === pointer.sourceCsvSha256 &&
    receipt.sourceReadbackSha256 === pointer.sourceReadbackSha256 &&
    receipt.priorStateSha256 === pointer.priorStateSha256 &&
    receipt.candidateManifestSha256 === pointer.candidateManifestSha256 &&
    receipt.previousPointerSha256 === pointer.previousPointerSha256 &&
    receipt.previousPublishedReceiptSha256 === pointer.previousReceiptSha256 &&
    readback.schema === 'ArbysCustomerDailySignedInReportReadback/v2' &&
    readback.signedInSessionObserved === true &&
    readback.sourceCsvSha256 === pointer.sourceCsvSha256 &&
    readback.sourceExportedAtUtc === receipt.sourceExportedAtUtc &&
    readback.reportId === receipt.reportId &&
    state.schema === 'ArbysCustomerPriorObservedSubset/v6' &&
    manifest.schema === 'ArbysCustomerDailyHeldCandidate/v2' &&
    manifest.sourceExportedAtUtc === receipt.sourceExportedAtUtc &&
    manifest.nextPriorStateSha256 === pointer.priorStateSha256 &&
    manifest.encryptedPublicFileSha256 === pointer.ciphertextSha256 &&
    manifest.customerUrlSha256 === urlSha && manifest.keySha256 === keySha &&
    manifest.previousCommit === pointer.previousCommit &&
    proof.schema === 'ArbysCustomerDailySignedOutReadback/v1' &&
    proof.signedOut === true && proof.commit === pointer.commit &&
    proof.customerUrlSha256 === urlSha &&
    proof.ciphertextSha256 === pointer.ciphertextSha256 &&
    proof.sourceScopeNoticeShown === true &&
    proof.unconfirmedInstallDateShown === false &&
    state.lastVerifiedAtUtc === receipt.sourceExportedAtUtc &&
    proof.lastVerifiedAtUtc === state.lastVerifiedAtUtc);
  const sourceMs = instant(state.lastVerifiedAtUtc);
  need(instant(proof.observedAtUtc) >= sourceMs);
  return state.lastVerifiedAtUtc;
}
