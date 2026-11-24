import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodeBase64Url} from '../crypto.mjs';
import {verifiedTrackerLastVerifiedAtUtc} from '../scripts/verified_tracker_source.mjs';

const TRACKER = `https://rbcochell-ui.github.io/arbys-customer-status-preview/?p=p_${'a'.repeat(32)}#k=${'A'.repeat(43)}`;
const SOURCE_AT = '2026-11-22T20:35:12Z';
const COMMIT = 'a'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const HASH = 'c'.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = value => Buffer.from(`${JSON.stringify(value)}\n`);

function inventedGeneration(sourceAt = SOURCE_AT) {
  const urlSha = sha(Buffer.from(TRACKER));
  const key = new URLSearchParams(new URL(TRACKER).hash.slice(1)).get('k');
  const keySha = sha(Buffer.from(decodeBase64Url(key)));
  const sourceCsvRaw = Buffer.from('invented,Thirsty,CSV\n');
  const sourceReadbackRaw = raw({schema: 'ArbysCustomerDailySignedInReportReadback/v2',
    signedInSessionObserved: true, reportId: 'invented-report',
    sourceCsvSha256: sha(sourceCsvRaw), sourceExportedAtUtc: sourceAt});
  const priorStateRaw = raw({schema: 'ArbysCustomerPriorObservedSubset/v6',
    lastVerifiedAtUtc: sourceAt});
  const ciphertextRaw = raw({schema: 'invented-encrypted-project'});
  const viewerManifestRaw = raw({schema: 'invented-viewer-manifest'});
  const manifestRaw = raw({schema: 'ArbysCustomerDailyHeldCandidate/v2',
    sourceExportedAtUtc: sourceAt, nextPriorStateSha256: sha(priorStateRaw),
    encryptedPublicFileSha256: sha(ciphertextRaw), customerUrlSha256: urlSha,
    keySha256: keySha, previousCommit: PREVIOUS});
  const proofRaw = raw({schema: 'ArbysCustomerDailySignedOutReadback/v1',
    signedOut: true, commit: COMMIT, customerUrlSha256: urlSha,
    ciphertextSha256: sha(ciphertextRaw), sourceScopeNoticeShown: true,
    unconfirmedInstallDateShown: false, lastVerifiedAtUtc: sourceAt,
    observedAtUtc: '2026-11-22T20:45:12Z'});
  const receiptRaw = raw({schema: 'ArbysCustomerDailySuccessorPublished/v1',
    remotePublished: true, customerEmailSent: false, commit: COMMIT,
    baseHead: PREVIOUS, reportId: 'invented-report',
    customerUrlSha256: urlSha, keySha256: keySha,
    publicFileSha256: sha(ciphertextRaw), sourceCsvSha256: sha(sourceCsvRaw),
    sourceReadbackSha256: sha(sourceReadbackRaw),
    priorStateSha256: sha(priorStateRaw),
    candidateManifestSha256: sha(manifestRaw),
    previousPointerSha256: HASH, previousPublishedReceiptSha256: HASH,
    viewerManifestSha256: sha(viewerManifestRaw),
    signedOutReadbackSha256: sha(proofRaw), sourceExportedAtUtc: sourceAt});
  const pointerRaw = raw({schema: 'ArbysCustomerDailySuccessorPointer/v1',
    state: 'CURRENT', sequence: 1, commit: COMMIT,
    previousCommit: PREVIOUS, receiptSha256: sha(receiptRaw),
    ciphertextSha256: sha(ciphertextRaw), sourceCsvSha256: sha(sourceCsvRaw),
    sourceReadbackSha256: sha(sourceReadbackRaw),
    priorStateSha256: sha(priorStateRaw),
    candidateManifestSha256: sha(manifestRaw), keySha256: keySha,
    customerUrlSha256: urlSha, previousPointerSha256: HASH,
    previousReceiptSha256: HASH, activatedAtUtc: '2026-11-22T20:50:12Z'});
  return {pointerRaw, generationPointerRaw: pointerRaw, receiptRaw, priorStateRaw,
    manifestRaw, proofRaw, sourceCsvRaw, sourceReadbackRaw, ciphertextRaw,
    viewerManifestRaw};
}

test('customer source time comes from pinned Thirsty Last Verified, not a fresh List read', () => {
  const artifacts = inventedGeneration();
  const lastVerified = verifiedTrackerLastVerifiedAtUtc(artifacts, TRACKER);
  assert.equal(lastVerified, SOURCE_AT);
  const releaseListReadAt = '2026-11-23T20:35:12Z';
  assert.notEqual(lastVerified, releaseListReadAt);
  assert.equal(verifiedTrackerLastVerifiedAtUtc({...artifacts,
    releaseListReadAtUtc: releaseListReadAt}, TRACKER), SOURCE_AT);
});

test('tracker source requires the selected pointer and pinned signed-out proof', () => {
  const artifacts = inventedGeneration();
  assert.throws(() => verifiedTrackerLastVerifiedAtUtc({...artifacts,
    proofRaw: raw({...JSON.parse(artifacts.proofRaw),
      lastVerifiedAtUtc: '2026-11-23T20:35:12Z'})}, TRACKER));
  assert.throws(() => verifiedTrackerLastVerifiedAtUtc({...artifacts,
    generationPointerRaw: raw({schema: 'different'})}, TRACKER));
  assert.throws(() => verifiedTrackerLastVerifiedAtUtc(artifacts,
    TRACKER.replace(`p_${'a'.repeat(32)}`, `p_${'b'.repeat(32)}`)));
  assert.throws(() => verifiedTrackerLastVerifiedAtUtc({...artifacts,
    sourceCsvRaw: Buffer.from('different CSV\n')}, TRACKER));
  assert.throws(() => verifiedTrackerLastVerifiedAtUtc({...artifacts,
    pointerRaw: raw({...JSON.parse(artifacts.pointerRaw), state: 'PENDING'})}, TRACKER));
});
