// Local staging tool. It binds one verified provider contact record to the
// selected native WO ID, agent, store, and outlet ACN without printing emails.
import {readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptGantt, parseCapabilityHref} from '../crypto.mjs';
import {parseSelectionConfig} from '../selection_config.mjs';
import {parseComposeSources} from '../actions/selection_source.mjs';
import {encryptProviderBinding, PROVIDER_BINDING_SCHEMA} from '../actions/provider_binding.mjs';
import {readPrivateSigningKey, signBindingEnvelope} from './sign_binding_envelope.mjs';

const [capabilityPath, contactRecordPath, signingKeyPath, outputPath,
  selectedNativeWoId] = process.argv.slice(2);
if (!capabilityPath || !contactRecordPath || !signingKeyPath || !outputPath) {
  throw new Error('Usage: node scripts/build_provider_binding.mjs <private-gantt-link-file> <private-contact-record-json> <private-signing-key-pk8> <private-output> [selected-native-WO-ID]');
}
const repoRoot = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url)))).toLowerCase();
const target = resolve(outputPath).toLowerCase();
const canonicalTarget = resolve(realpathSync(dirname(target)), basename(target)).toLowerCase();
if (target === repoRoot || target.startsWith(`${repoRoot}${sep}`) ||
    canonicalTarget === repoRoot || canonicalTarget.startsWith(`${repoRoot}${sep}`)) {
  throw new Error('Provider contact binding must stay outside the public repository while held');
}
function privateInput(path) {
  const absolute = realpathSync(resolve(path));
  const lower = absolute.toLowerCase();
  if (lower === repoRoot || lower.startsWith(`${repoRoot}${sep}`)) {
    throw new Error('Protected source evidence must stay outside the public repository');
  }
  return absolute;
}

const master = parseCapabilityHref(readFileSync(privateInput(capabilityPath), 'utf8').trim());
const html = await decryptGantt(JSON.parse(readFileSync('data/gantt.enc.json', 'utf8')), master);
const allowed = parseSelectionConfig(html);
const nativeWoId = selectedNativeWoId ?? (allowed.providerIds.length === 1 ? allowed.providerIds[0] : null);
if (!nativeWoId || !allowed.providerIds.includes(nativeWoId)) {
  throw new Error('Select one exact allowlisted native work order ID');
}
const source = parseComposeSources(html, allowed).providerById[nativeWoId];
if (!source || source.suggestedRecipients.length !== 2) {
  throw new Error('Pilot work order or two-role contact candidate is unavailable');
}

const recordBytes = readFileSync(privateInput(contactRecordPath));
const record = JSON.parse(recordBytes.toString('utf8'));
if (record.Verified !== true || record.AgentCode !== source.agentCode ||
    record.StoreNumber !== source.storeNumber || record.OutletACN !== source.outletAcn ||
    record.InstallManagerEmail.toLowerCase() !== source.suggestedRecipients[0].toLowerCase() ||
    record.PlannerEmail.toLowerCase() !== source.suggestedRecipients[1].toLowerCase()) {
  throw new Error('Protected provider record does not match the selected work order');
}
const payload = {
  schema: PROVIDER_BINDING_SCHEMA,
  nativeWoId: source.nativeWoId,
  agentCode: source.agentCode,
  storeNumber: source.storeNumber,
  outletAcn: source.outletAcn,
  installManagerEmail: record.InstallManagerEmail,
  plannerEmail: record.PlannerEmail,
  contactKey: record.ContactKey,
  sourceEvidenceDigest: record.SourceEvidenceDigest,
  sourceRecordSha256: createHash('sha256').update(recordBytes).digest('hex'),
  sourceCheckedAtUtc: record.SourceCheckedAtUtc,
  verifiedAtUtc: record.VerifiedAtUtc,
};
const signingKey = readPrivateSigningKey(signingKeyPath, repoRoot);
let signed;
try {
  const encrypted = await encryptProviderBinding(payload, master);
  signed = await signBindingEnvelope(encrypted, 'provider', nativeWoId, signingKey);
} finally { signingKey.fill(0); }
const output = `${JSON.stringify(signed)}\n`;
writeFileSync(outputPath, output, {flag: 'wx'});
console.log(JSON.stringify({result: 'signed, encrypted provider binding staged locally',
  bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex')}));
