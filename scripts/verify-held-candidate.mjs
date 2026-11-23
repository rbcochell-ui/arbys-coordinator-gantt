import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'HELD_BUILD_MANIFEST.json'), 'utf8'));
const requireDist = process.argv.includes('--require-dist');
assert.ok(process.argv.length === 2 ||
  (process.argv.length === 3 && requireDist),
  'only --require-dist is accepted');
assert.equal(manifest.sourcePackage,
  'source/gantt_github_two_button_site_integrated_source_only_20261123_v4_verified_prefill',
  'held artifact must pin the current V4 source');
const source = join(root, manifest.sourcePackage);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Vite's Windows build can duplicate a CR before an injected newline.
const canonical = bytes => Buffer.from(bytes.toString('utf8').replace(/\r+\n/gu, '\n'));

assert.equal(manifest.schema, 'arbys-gantt-held-build/v1');
assert.equal(manifest.integrationEnabled, false);
assert.equal(manifest.sha256['data/gantt.enc.json'],
  'a7719f606cfbada0cf31187c18ada8548d4b42024653c26888367e1f7ed8c84c',
  'encrypted chart must remain at the last verified content');

for (const [relativePath, expected] of Object.entries(manifest.sha256)) {
  const bytes = readFileSync(join(root, relativePath));
  // Git on Windows can check text out with CRLF; Pages serves the LF blob.
  const actual = sha256(canonical(bytes));
  assert.equal(actual, expected, `${relativePath} differs from the reviewed build`);
}

const {INTEGRATION_CONFIG: config} = await import(pathToFileURL(
  join(source, 'site/actions/integration_config.mjs')).href);
assert.equal(config.enabled, false);
assert.equal(config.auth.enabled, false);
assert.equal(config.lean.enabled, false);
assert.equal(config.snapshot.enabled, false);
assert.equal(config.legacyInventory, null);
assert.equal(config.legacyOwner, null);
assert.equal(config.lean.providerEnabled, false);
assert.equal(config.lean.customerEnabled, false);
assert.equal(config.snapshot.providerSnapshotEnabled, false);
for (const part of [config.auth, config.lean, config.snapshot]) {
  for (const field of ['tenantId', 'clientId', 'siteId', 'encryptedPayloadUrl']) {
    if (field in part) assert.equal(part[field], null, `${field} must stay unbound`);
  }
  if ('lists' in part) {
    for (const [name, id] of Object.entries(part.lists)) {
      assert.equal(id, null, `${name} must stay unbound`);
    }
  }
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1];
assert.ok(csp, 'CSP is required');
for (const directive of ["default-src 'none'", "connect-src 'self'",
  "frame-src 'self' about:", "form-action 'none'", "object-src 'none'"]) {
  assert.ok(csp.includes(directive), `${directive} is required`);
}
assert.ok(!/graph\.microsoft\.com|login\.microsoftonline\.com/iu.test(csp),
  'Microsoft network destinations must remain blocked');
for (const id of ['signInAction', 'verifyAction', 'providerDraftAction',
  'customerDraftAction', 'checkSentAction']) {
  assert.ok(new RegExp(`<button id="${id}"[^>]*\\bdisabled\\b`, 'u').test(html),
    `${id} must be checked in disabled`);
}
const appBundles = Object.keys(manifest.sha256).filter(path =>
  /^assets\/app-[A-Za-z0-9_-]+\.js$/u.test(path));
assert.equal(appBundles.length, 1, 'manifest must pin exactly one app bundle');
const appBundle = appBundles[0].slice('assets/'.length);
assert.ok(html.includes(`/arbys-coordinator-gantt/assets/${appBundle}`));
assert.ok(html.includes('sandbox="allow-scripts allow-popups'));
assert.deepEqual(readdirSync(join(root, 'assets')).filter(name =>
  /^app-[A-Za-z0-9_-]+\.js$/u.test(name)), [appBundle],
  'only the reviewed app bundle may remain at the Pages root');

for (const filename of [appBundle, 'Configuration-B1Fwyfg7.js',
  'redirect-Ck1ZdWvy.js']) {
  const bundle = readFileSync(join(root, 'assets', filename), 'utf8');
  assert.ok(!/Mail\.Send\b/iu.test(bundle),
    `${filename} contains a send scope`);
  assert.ok(!/(?:provider-parts:0WO[A-Za-z0-9]{15}|customer-tracker:F:[1-9][0-9]*:[1-9][0-9]*)/u.test(bundle),
    `${filename} contains a complete dispatch key`);
  assert.ok(!/[A-Z0-9._%+-]+@(?!example\.invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(bundle),
    `${filename} contains a literal non-fixture email address`);
  assert.ok(!/#k=[A-Za-z0-9_-]{43}/u.test(bundle),
    `${filename} contains a complete private capability key`);
}

const dist = join(source, 'dist');
if (requireDist) {
  assert.ok(existsSync(dist), 'current V4 dist must exist before comparison');
}
if (existsSync(dist)) {
  for (const relativePath of Object.keys(manifest.sha256).filter(
    path => path !== 'data/gantt.enc.json')) {
    assert.equal(sha256(canonical(readFileSync(join(dist, relativePath)))),
      manifest.sha256[relativePath],
      `rebuilt ${relativePath} does not match the pinned root artifact`);
  }
}

console.log('Held candidate verified: pinned artifacts, unchanged ciphertext, disabled controls/config, strict CSP, and no bundled send scope or private pilot details.');
