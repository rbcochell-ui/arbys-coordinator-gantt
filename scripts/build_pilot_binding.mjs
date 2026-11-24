// Local staging tool. Inputs stay in the private workspace; stdout reports
// only sizes and hashes. Never commit the input files or print their values.
import {existsSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptGantt, parseCapabilityHref} from '../crypto.mjs';
import {parseSelectionConfig} from '../selection_config.mjs';
import {parseComposeSources} from '../actions/selection_source.mjs';
import {encryptPilotBinding, PILOT_BINDING_SCHEMA} from '../actions/pilot_binding.mjs';
import {verifiedTrackerLastVerifiedAtUtc} from './verified_tracker_source.mjs';
import {readPrivateSigningKey, signBindingEnvelope} from './sign_binding_envelope.mjs';

const [capabilityPath, releaseEvidencePath, trackerCurrentPath, signingKeyPath, outputPath,
  selectedFormSourceKey] = process.argv.slice(2);
if (!capabilityPath || !releaseEvidencePath || !trackerCurrentPath ||
    !signingKeyPath || !outputPath) {
  throw new Error('Usage: node scripts/build_pilot_binding.mjs <private-gantt-link-file> <private-release-evidence-json> <protected-tracker-current.json> <private-signing-key-pk8> <private-output> [selected-FORM-source-key]');
}
const repoRoot = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url)))).toLowerCase();
const target = resolve(outputPath).toLowerCase();
const canonicalTarget = resolve(realpathSync(dirname(target)), basename(target)).toLowerCase();
if (target === repoRoot || target.startsWith(`${repoRoot}${sep}`) ||
    canonicalTarget === repoRoot || canonicalTarget.startsWith(`${repoRoot}${sep}`)) {
  throw new Error('Pilot customer binding must stay outside the public repository');
}
function protectedInput(path) {
  const absolute = realpathSync(resolve(path));
  const lower = absolute.toLowerCase();
  if (lower === repoRoot || lower.startsWith(`${repoRoot}${sep}`)) {
    throw new Error('Protected source evidence must stay outside the public repository');
  }
  return absolute;
}

const master = parseCapabilityHref(readFileSync(protectedInput(capabilityPath), 'utf8').trim());
const html = await decryptGantt(JSON.parse(readFileSync('data/gantt.enc.json', 'utf8')), master);
const allowed = parseSelectionConfig(html);
const formSourceKey = selectedFormSourceKey ?? (allowed.customerKeys.length === 1 ? allowed.customerKeys[0] : null);
if (!formSourceKey || !allowed.customerKeys.includes(formSourceKey)) {
  throw new Error('Select one exact allowlisted FORM source key');
}
const sources = parseComposeSources(html, allowed);
const project = sources.customerByKey[formSourceKey];
if (!project) throw new Error('Pilot project is absent from the encrypted chart');

const evidence = JSON.parse(readFileSync(protectedInput(releaseEvidencePath), 'utf8'));
const byId = evidence?.readyById?.row;
const byKey = evidence?.readyByKey?.row;
if (!byId || !byKey || byId.FormSourceKey !== formSourceKey ||
    byKey.FormSourceKey !== formSourceKey ||
    byId.CustomerTrackingUrl !== byKey.CustomerTrackingUrl ||
    byId.RecipientEmail !== byKey.RecipientEmail ||
    byId.ReleaseReceiptSha256 !== byKey.ReleaseReceiptSha256 ||
    byId.ReleaseState !== 'Ready' || byKey.ReleaseState !== 'Ready') {
  throw new Error('Protected release-row evidence is inconsistent');
}
const customerUrlHash = createHash('sha256').update(byId.CustomerTrackingUrl).digest('hex');
if (customerUrlHash !== evidence.publishedCustomerUrlSha256) {
  throw new Error('Protected customer link does not match the publication receipt');
}
const currentFile = protectedInput(trackerCurrentPath);
if (basename(currentFile).toLowerCase() !== 'current.json' ||
    existsSync(join(dirname(currentFile), 'pending.json'))) {
  throw new Error('A selected, settled tracker generation is required');
}
const pointerRaw = readFileSync(currentFile);
const pointer = JSON.parse(pointerRaw.toString('utf8'));
if (!/^[0-9a-f]{40}$/.test(pointer?.commit)) {
  throw new Error('Selected tracker pointer is invalid');
}
const generation = join(dirname(currentFile), 'generations', pointer.commit);
const names = ['pointer.json', 'published-current.json', 'prior-state.json',
  'ciphertext.json', 'source.csv', 'source-readback.json',
  'candidate-manifest.json', 'signed-out-readback.json',
  'viewer-manifest.json'];
if (readdirSync(protectedInput(generation)).sort().join('\0') !==
    [...names].sort().join('\0')) {
  throw new Error('Selected tracker generation inventory changed');
}
const readGeneration = name => readFileSync(protectedInput(join(generation, name)));
const trackerLastVerifiedAtUtc = verifiedTrackerLastVerifiedAtUtc({
  pointerRaw, generationPointerRaw: readGeneration('pointer.json'),
  receiptRaw: readGeneration('published-current.json'),
  priorStateRaw: readGeneration('prior-state.json'),
  ciphertextRaw: readGeneration('ciphertext.json'),
  sourceCsvRaw: readGeneration('source.csv'),
  sourceReadbackRaw: readGeneration('source-readback.json'),
  manifestRaw: readGeneration('candidate-manifest.json'),
  proofRaw: readGeneration('signed-out-readback.json'),
  viewerManifestRaw: readGeneration('viewer-manifest.json'),
}, byId.CustomerTrackingUrl);
const payload = {
  schema: PILOT_BINDING_SCHEMA, formSourceKey,
  storeNumber: project.storeNumber,
  recipientEmail: byId.RecipientEmail,
  trackerUrl: byId.CustomerTrackingUrl,
  releaseReceiptSha256: byId.ReleaseReceiptSha256,
  trackerLastVerifiedAtUtc,
};
const signingKey = readPrivateSigningKey(signingKeyPath, repoRoot);
let signed;
try {
  const encrypted = await encryptPilotBinding(payload, master);
  signed = await signBindingEnvelope(encrypted, 'customer', formSourceKey, signingKey);
} finally { signingKey.fill(0); }
const output = `${JSON.stringify(signed)}\n`;
writeFileSync(outputPath, output, {flag: 'wx'});
console.log(JSON.stringify({result: 'signed, encrypted customer binding staged locally',
  bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex')}));
