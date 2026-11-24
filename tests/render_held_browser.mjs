// Optional local render check. It uses invented chart data and an isolated
// headless Edge profile; no real Gantt key or customer data is read.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCipheriv, createHash, randomBytes} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {AAD, ENVELOPE_SCHEMA, PLAIN_SCHEMA} from '../crypto.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
assert.ok(existsSync(edge), 'Microsoft Edge is required for this optional check');

const pilot = 'F:123:789';
const provider = `0WO${'A'.repeat(15)}`;
const actionRoutes = {schema: 'ArbysGanttSelection/v1', actionsEnabled: false,
  providerAllowedNativeWorkOrderIds: [provider],
  customerAllowedFormSourceKeys: [pilot]};
const snapshot = {schema: 'arbys-local-exact-form-project-preview/v16',
  asOfDate: '2026-11-18', projects: [{caseKey: pilot, formStore: '12345',
    cases: []}]};
const chartHtml = '<!doctype html><html lang="en"><head>' +
  `<script type="application/json" id="actionRoutes">${JSON.stringify(actionRoutes)}</script>` +
  `<script type="application/json" id="snapshotData">${JSON.stringify(snapshot)}</script>` +
  '</head><body><h1>Invented sample timeline</h1></body></html>';
const key = randomBytes(32);
const nonce = randomBytes(12);
const plain = JSON.stringify({schema: PLAIN_SCHEMA,
  sha256: createHash('sha256').update(chartHtml).digest('hex'), html: chartHtml});
const cipher = createCipheriv('aes-256-gcm', key, nonce);
cipher.setAAD(Buffer.from(AAD));
const encrypted = Buffer.concat([cipher.update(plain), cipher.final(),
  cipher.getAuthTag()]);
const envelope = JSON.stringify({schema: ENVELOPE_SCHEMA,
  nonce: nonce.toString('base64url'), ciphertext: encrypted.toString('base64url')});

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/data/gantt.enc.json') {
    response.writeHead(200, {'content-type': 'application/json',
      'cache-control': 'no-store'});
    response.end(envelope);
    return;
  }
  if (!/^\/(?:index\.html|view\.mjs|crypto\.mjs|selection_config\.mjs|actions\/[A-Za-z_]+\.mjs)$/.test(pathname)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const body = readFileSync(join(root, pathname.slice(1)));
    response.writeHead(200, {'content-type': pathname.endsWith('.mjs')
      ? 'text/javascript' : 'text/html', 'cache-control': 'no-store'});
    response.end(body);
  } catch {
    response.writeHead(404); response.end();
  }
});

const profile = mkdtempSync(join(tmpdir(), 'arbys-gantt-render-'));
const resolvedTemp = resolve(tmpdir());
assert.ok(resolve(profile).startsWith(resolvedTemp + sep));

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/index.html`;
  async function dump(url) {
    const result = await execFileAsync(edge, [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--no-default-browser-check', `--user-data-dir=${profile}`,
      '--virtual-time-budget=5000', '--dump-dom', url,
    ], {timeout: 30000, maxBuffer: 2_000_000});
    return result.stdout;
  }
  const withoutKey = await dump(base);
  assert.match(withoutKey, /Timeline unavailable/);
  assert.match(withoutKey, /Check that you opened the complete link/);
  const fragment = new URLSearchParams([['k', key.toString('base64url')],
    ['kind', 'customer'], ['id', pilot]]).toString();
  const withKey = await dump(`${base}#${fragment}`);
  assert.match(withKey, /Invented sample timeline/);
  assert.match(withKey, /Customer milestone draft — held/);
  assert.match(withKey, /Check Sent — held/);
  assert.match(withKey, /Store 12345 selected for a customer progress note/);
  assert.match(withKey, /Chart snapshot as of 2026-11-18/);
  assert.match(withKey, /Acting coordinator: not verified on this page/);
  assert.match(withKey, /Drafting is held in this release/);
  assert.match(withKey, /Check Sent can identify a candidate/);
  const providerFragment = new URLSearchParams([['k', key.toString('base64url')],
    ['kind', 'provider'], ['id', provider]]).toString();
  const providerView = await dump(`${base}#${providerFragment}`);
  assert.match(providerView, /Provider parts draft — held/);
  assert.match(providerView, /Provider Check Sent is held for this work order until its exact receipt route is released/);
  if (process.env.ARBYS_RENDER_SCREENSHOT) {
    const screenshot = resolve(process.env.ARBYS_RENDER_SCREENSHOT);
    assert.ok(screenshot.startsWith(resolvedTemp + sep));
    assert.equal(existsSync(screenshot), false);
    await execFileAsync(edge, [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--no-default-browser-check', `--user-data-dir=${profile}`,
      '--window-size=1280,900', '--force-device-scale-factor=1',
      '--virtual-time-budget=5000', `--screenshot=${screenshot}`,
      `${base}#${fragment}`,
    ], {timeout: 30000, maxBuffer: 2_000_000});
    assert.ok(existsSync(screenshot));
    console.log(`Invented screenshot: ${screenshot}`);
  }
  console.log('PASS: signed-out base holds; invented complete link renders held draft, actor, and Sent candidate states.');
} finally {
  await new Promise((done) => server.close(done));
  assert.ok(resolve(profile).startsWith(resolvedTemp + sep));
  rmSync(profile, {recursive: true, force: true});
}
