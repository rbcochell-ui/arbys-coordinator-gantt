// Assemble exact, encrypted selection bindings for local coordinator use.
// The manifest, input envelopes, and output must all remain outside this repo.
import {readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptGantt, parseCapabilityHref} from '../crypto.mjs';
import {parseSelectionConfig} from '../selection_config.mjs';
import {parseComposeSources} from '../actions/selection_source.mjs';
import {BINDING_BUNDLE_SCHEMA, decryptSelectedBinding,
  parseBindingBundle} from '../actions/binding_bundle.mjs';

const [capabilityPath, manifestPath, outputPath] = process.argv.slice(2);
if (!capabilityPath || !manifestPath || !outputPath) {
  throw new Error('Usage: node scripts/build_binding_bundle.mjs <private-gantt-link-file> <private-manifest-json> <private-output-json>');
}
const repoRoot = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url)))).toLowerCase();
function insideRepo(path) {
  const lower = path.toLowerCase();
  return lower === repoRoot || lower.startsWith(`${repoRoot}${sep}`);
}
function privateInputPath(path) {
  const absolute = resolve(path);
  if (insideRepo(absolute) || insideRepo(realpathSync(absolute))) {
    throw new Error('Protected binding files must stay outside the public repository');
  }
  return absolute;
}
function privateOutputPath(path) {
  const absolute = resolve(path);
  const canonical = resolve(realpathSync(dirname(absolute)), basename(absolute));
  if (insideRepo(absolute) || insideRepo(canonical)) {
    throw new Error('Protected binding files must stay outside the public repository');
  }
  return absolute;
}
const output = privateOutputPath(outputPath);
const manifestFile = privateInputPath(manifestPath);
const master = parseCapabilityHref(readFileSync(privateInputPath(capabilityPath), 'utf8').trim());
const html = await decryptGantt(JSON.parse(readFileSync('data/gantt.enc.json', 'utf8')), master);
const allowed = parseSelectionConfig(html);
const sources = parseComposeSources(html, allowed);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
    Object.keys(manifest).length !== 2 || manifest.schema !== 'arbys-gantt-local-binding-manifest/v1' ||
    !Array.isArray(manifest.entries) || manifest.entries.length > 100) {
  throw new Error('Invalid private binding manifest');
}
const entries = manifest.entries.map(entry => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).length !== 3 || typeof entry.file !== 'string' ||
      typeof entry.kind !== 'string' || typeof entry.id !== 'string') {
    throw new Error('Invalid private binding manifest entry');
  }
  const envelopeFile = privateInputPath(resolve(dirname(manifestFile), entry.file));
  const envelope = JSON.parse(readFileSync(envelopeFile, 'utf8'));
  return {kind: entry.kind, id: entry.id, envelope};
});
const serialized = `${JSON.stringify({schema: BINDING_BUNDLE_SCHEMA, entries})}\n`;
const bundle = parseBindingBundle(serialized, allowed);
for (const entry of entries) {
  const binding = await decryptSelectedBinding(bundle, master, sources, entry);
  if (!binding) throw new Error('Private binding does not match a current allowlisted selection');
}
writeFileSync(output, serialized, {flag: 'wx'});
console.log(JSON.stringify({result: 'encrypted local binding bundle staged outside public repository',
  entries: entries.length, bytes: Buffer.byteLength(serialized),
  sha256: createHash('sha256').update(serialized).digest('hex')}));
