/** Rebuild only the disabled, data-free Pages shell from the reviewed source. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePackage =
  'source/gantt_github_two_button_site_integrated_source_only_20261123_v4_verified_prefill';
const dist = join(root, sourcePackage, 'dist');
const manifestPath = join(root, 'HELD_BUILD_MANIFEST.json');
const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = bytes =>
  Buffer.from(bytes.toString('utf8').replace(/\r+\n/gu, '\n'));
const digest = path => sha(canonical(readFileSync(path)));
const chartDigest =
  'a7719f606cfbada0cf31187c18ada8548d4b42024653c26888367e1f7ed8c84c';

assert.equal(previous.schema, 'arbys-gantt-held-build/v1');
assert.equal(previous.integrationEnabled, false);
assert.equal(previous.baseCommit,
  '01052b519c6da361a71887269645eb3dc5a671e2');
assert.equal(digest(join(root, 'data/gantt.enc.json')), chartDigest,
  'the encrypted customer chart must remain unchanged');

// Do not let an old ignored dist/ masquerade as the current source build.
execFileSync(process.execPath,
  [join(root, sourcePackage, 'node_modules/vite/bin/vite.js'), 'build'],
  {cwd: join(root, sourcePackage), stdio: 'inherit'});

const config = (await import(pathToFileURL(join(root, sourcePackage,
  'site/actions/integration_config.mjs')).href)).INTEGRATION_CONFIG;
assert.equal(config.enabled, false);
for (const route of [config.auth, config.lean, config.snapshot]) {
  assert.equal(route.enabled, false);
}
assert.equal(config.lean.providerEnabled, false);
assert.equal(config.lean.customerEnabled, false);
assert.equal(config.snapshot.providerSnapshotEnabled, false);

const index = readFileSync(join(dist, 'index.html'), 'utf8');
for (const id of ['signInAction', 'verifyAction', 'providerDraftAction',
  'customerDraftAction', 'checkSentAction']) {
  assert.match(index, new RegExp(`<button id="${id}"[^>]*\\bdisabled\\b`, 'u'));
}
for (const directive of ["default-src 'none'", "connect-src 'self'",
  "frame-src 'self' about:", "form-action 'none'", "object-src 'none'"]) {
  assert.ok(index.includes(directive), `${directive} missing`);
}
assert.ok(!/graph\.microsoft\.com|login\.microsoftonline\.com/iu.test(index),
  'held site must block Microsoft network destinations');

const expectedAux = ['Configuration-B1Fwyfg7.js', 'redirect-Ck1ZdWvy.js'];
const appPattern = /^app-[A-Za-z0-9_-]+\.js$/u;
const distAssets = readdirSync(join(dist, 'assets')).sort();
const newApps = distAssets.filter(name => appPattern.test(name));
assert.equal(newApps.length, 1);
assert.deepEqual(distAssets, [...expectedAux, newApps[0]].sort(),
  'Vite output has an unexpected asset');
const priorApps = Object.keys(previous.sha256).filter(name =>
  name.startsWith('assets/') && appPattern.test(name.slice(7)));
assert.equal(priorApps.length, 1, 'prior manifest must pin one app bundle');
const oldApp = priorApps[0].slice(7);
const rootApps = readdirSync(join(root, 'assets'))
  .filter(name => appPattern.test(name));
assert.ok(rootApps.length >= 1 && rootApps.length <= 2 &&
  rootApps.every(name => name === oldApp || name === newApps[0]),
  'root has an unreviewed app bundle');
if (rootApps.includes(oldApp)) {
  assert.equal(previous.sha256[`assets/${oldApp}`],
    digest(join(root, 'assets', oldApp)), 'old app changed outside this build');
}
if (newApps[0] !== oldApp && rootApps.includes(newApps[0])) {
  assert.equal(digest(join(root, 'assets', newApps[0])),
    digest(join(dist, 'assets', newApps[0])),
    'new app differs from the source build');
}

for (const name of distAssets) {
  const bundle = readFileSync(join(dist, 'assets', name), 'utf8');
  assert.ok(!/Mail\.Send\b/iu.test(bundle), `${name} contains Send scope`);
  assert.ok(!/#k=[A-Za-z0-9_-]{43}/u.test(bundle),
    `${name} contains a private capability key`);
  assert.ok(!/[A-Z0-9._%+-]+@(?!example\.invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(bundle),
    `${name} contains a nonfixture email`);
}

const pages = ['index.html', 'auth/redirect.html'];
for (const relative of pages) {
  copyFileSync(join(dist, relative), join(root, relative));
}
for (const name of distAssets) {
  copyFileSync(join(dist, 'assets', name), join(root, 'assets', name));
}
if (oldApp !== newApps[0] && rootApps.includes(oldApp)) {
  unlinkSync(join(root, 'assets', oldApp));
}

const files = [...pages, ...distAssets.map(name => `assets/${name}`)];
const hashes = Object.fromEntries(files.map(relative =>
  [relative, digest(join(root, relative))]));
hashes['data/gantt.enc.json'] = chartDigest;
const manifest = {schema: previous.schema, baseCommit: previous.baseCommit,
  sourcePackage, integrationEnabled: false, sha256: hashes};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
for (const relative of files) {
  assert.equal(digest(join(root, relative)),
    digest(join(dist, relative)), `${relative} differs from source build`);
}
console.log(`Held Pages shell rebuilt from ${sourcePackage}; ${files.length} files pinned.`);
