// Isolated Edge smoke for the dated panel. No production site or cloud access.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const source = fileURLToPath(new URL('../dated_provider_review_panel.mjs', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'arbys-dated-panel-'));
const tempRoot = `${resolve(tmpdir())}${sep}`.toLowerCase();
if (!resolve(temporary).toLowerCase().startsWith(tempRoot)) {
  throw new Error('Temporary smoke directory escaped system temp');
}
let server;
let browser;
try {
  await copyFile(source, join(temporary, 'dated_provider_review_panel.mjs'));
  await writeFile(join(temporary, 'index.html'), `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'">
<style>body{font:16px/1.5 system-ui;margin:1rem;max-width:50rem}section{border:1px solid #ccd;padding:1rem;border-radius:.5rem}p{overflow-wrap:anywhere}a{overflow-wrap:anywhere}</style>
<script type="module" src="./app.mjs"></script></head><body>
<button id="select">Select invented WO</button><button id="signIn">Fake sign-in</button>
<button id="occupied">Show existing draft</button><button id="clear">Clear selection</button>
<section id="panel" hidden><h1>Dated provider source</h1>
<p id="sourceAsOf"></p><p id="chartDate"></p><p id="datedPhase"></p>
<p id="agentCode"></p><p id="storeNumber"></p>
<a id="thirstyLink" target="_blank" rel="noopener noreferrer" hidden>Open exact Thirsty WO</a>
<p id="recipientWarning"></p><p id="reviewWarning"></p><p id="status"></p>
</section></body></html>`);
  await writeFile(join(temporary, 'app.mjs'), `import {createDatedProviderReviewPanel} from './dated_provider_review_panel.mjs';
const id='0WO123456789012345';
let occupied=false;
const names=['panel','sourceAsOf','chartDate','datedPhase','agentCode','storeNumber','thirstyLink','recipientWarning','reviewWarning','status'];
const elements=Object.fromEntries(names.map(name=>[name,document.getElementById(name)]));
const panel=createDatedProviderReviewPanel({elements,loadSnapshotPreview:async selected=>occupied?({kind:'provider',id:selected,canDraft:false,sourceAvailable:false,existingStatus:'draft_occupied',thirstyUrl:'https://hubit.my.salesforce.com/lightning/r/WorkOrder/'+selected+'/view'}):({kind:'provider',id:selected,canDraft:false,eligibility:'preinstall_snapshot_candidate',reasonCode:'DATED_PREINSTALL_CANDIDATE',sourceAsOfUtc:'2026-11-22T18:43:09Z',chartSnapshotAsOfDate:'2026-11-18',datedPhase:'Pending Readiness',agentCode:'A1',storeNumber:null,thirstyUrl:'https://hubit.my.salesforce.com/lightning/r/WorkOrder/'+selected+'/view',recipientSuggestion:'none',to:[]})});
document.getElementById('select').addEventListener('click',()=>panel.onSelection({kind:'provider',id}));
document.getElementById('signIn').addEventListener('click',()=>panel.onSignedIn());
document.getElementById('occupied').addEventListener('click',()=>{occupied=true;void panel.refresh()});
document.getElementById('clear').addEventListener('click',()=>panel.onSelection(null));
window.__panel=panel;window.__id=id;`);
  server = createServer(async (request, response) => {
    const name = new URL(request.url, 'http://127.0.0.1').pathname;
    const target = resolve(temporary, `.${name === '/' ? '/index.html' : name}`);
    if (!target.startsWith(`${resolve(temporary)}${sep}`)) {
      response.writeHead(403).end(); return;
    }
    try {
      const bytes = await readFile(target);
      response.writeHead(200, {'Content-Type': target.endsWith('.mjs')
        ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store'}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  browser = await chromium.launch({executablePath: edge, headless: true,
    args: ['--disable-gpu', '--no-first-run']});
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const outside = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') {
      return route.continue();
    }
    outside.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, {waitUntil: 'load'});
  await page.locator('#select').click();
  assert.equal(await page.locator('#panel').isVisible(), true);
  assert.match(await page.locator('#status').textContent(), /Sign in/);
  assert.equal(await page.locator('#thirstyLink').isVisible(), false);
  await page.locator('#signIn').click();
  await page.locator('#thirstyLink').waitFor({state: 'visible'});
  assert.match(await page.locator('#sourceAsOf').textContent(), /2026-11-22/);
  assert.match(await page.locator('#recipientWarning').textContent(), /To will be blank/);
  assert.match(await page.locator('#reviewWarning').textContent(), /Outlook before Send/);
  assert.equal(await page.locator('#thirstyLink').getAttribute('href'),
    'https://hubit.my.salesforce.com/lightning/r/WorkOrder/0WO123456789012345/view');
  assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.evaluate(() =>
    window.__panel.selectionPort.capture(window.__id).id),
  '0WO123456789012345');
  await page.locator('#occupied').click();
  await page.waitForFunction(() => document.getElementById('status')
    .textContent.includes('can be reopened'));
  assert.match(await page.locator('#sourceAsOf').textContent(),
    /not rechecked for this existing draft/);
  assert.match(await page.locator('#reviewWarning').textContent(), /current Thirsty phase/);
  assert.equal(await page.evaluate(async () => {
    try { await window.__panel.selectionPort.ensureReady(window.__id); return null; }
    catch (error) { return error.code; }
  }), 'DATED_PREVIEW_SELECTION_REQUIRED');
  await page.locator('#clear').click();
  assert.equal(await page.locator('#panel').isVisible(), false);
  assert.equal(await page.locator('#thirstyLink').getAttribute('href'), null);
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  console.log('Isolated Edge dated-panel smoke passed: signed-in preview, empty-To warning, existing-draft fallback, exact link, mobile width, selection clear, no external requests.');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(done => server.close(done));
  await rm(temporary, {recursive: true, force: true});
}
