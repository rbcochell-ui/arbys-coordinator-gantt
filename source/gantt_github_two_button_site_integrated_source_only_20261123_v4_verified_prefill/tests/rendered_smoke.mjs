// Isolated Edge smoke. The chart, runtime, IDs and mailbox link are invented.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {build} from 'vite';
import {sealSyntheticHtml} from './fixture_seal.mjs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const project = fileURLToPath(new URL('../', import.meta.url));
const sourceSite = join(project, 'site');
const appPath = '/arbys-coordinator-gantt/';
const providerId = '0WO123456789012345';
const customerId = 'F:12345:67890';
const config = JSON.stringify({schema: 'ArbysGanttSelection/v1',
  actionsEnabled: false,
  providerAllowedNativeWorkOrderIds: [providerId],
  customerAllowedFormSourceKeys: [customerId]});
const actionScript = [
  'const send=(kind,id)=>parent.postMessage({channel:"arbys.gantt.selection.v1",type:"select",kind,id},"*");',
  `document.getElementById("provider").addEventListener("click",()=>send("provider","${providerId}"));`,
  `document.getElementById("customer").addEventListener("click",()=>send("customer","${customerId}"));`,
  'document.getElementById("invalid").addEventListener("click",()=>send("provider","0WO000000000000000"));',
].join('');
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="application/json" id="actionRoutes">${config}</script><h1>Invented Gantt</h1><button id="provider">Select invented WO</button><button id="customer">Select invented FORM project</button><button id="invalid">Select unknown ID</button><script>${actionScript}</script></body></html>`;

const temporary = await mkdtemp(join(tmpdir(), 'arbys-integrated-site-'));
const tempRoot = `${resolve(tmpdir())}${sep}`.toLowerCase();
if (!resolve(temporary).toLowerCase().startsWith(tempRoot)) {
  throw new Error('Temporary test path escaped the system temp folder');
}
let server;
let browser;
let servedRoot;
const localPaths = [];
const outside = [];
const errors = [];
try {
  const heldRoot = join(temporary, 'held');
  const fakeRoot = join(temporary, 'fake');
  await cp(join(project, 'dist'), heldRoot, {recursive: true});
  servedRoot = heldRoot;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    localPaths.push(pathname);
    const relative = pathname === appPath ? 'index.html' :
      pathname.startsWith(appPath) ? pathname.slice(appPath.length) : null;
    if (!relative) { response.writeHead(404).end(); return; }
    const root = resolve(servedRoot);
    const target = resolve(root, relative);
    if (!target.toLowerCase().startsWith(`${root}${sep}`.toLowerCase())) {
      response.writeHead(403).end(); return;
    }
    try {
      const bytes = await readFile(target);
      const type = relative.endsWith('.js') || relative.endsWith('.mjs')
        ? 'text/javascript' : relative.endsWith('.json')
          ? 'application/json' : relative.endsWith('.css')
            ? 'text/css' : 'text/html';
      response.writeHead(200, {'Content-Type': type,
        'Cache-Control': 'no-store'}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}${appPath}`;
  const payloadUrl = `${base}data/gantt.enc.json`;
  const {envelope, keyBytes} = await sealSyntheticHtml(fixture);
  async function prepareBuiltRoot(root) {
    await mkdir(join(root, 'data'), {recursive: true});
    await writeFile(join(root, 'data', 'gantt.enc.json'),
      JSON.stringify(envelope));
    const indexPath = join(root, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    const hash = createHash('sha256').update(actionScript).digest('base64');
    const patched = index.replace("script-src 'self'",
      `script-src 'self' 'sha256-${hash}'`);
    assert.notEqual(patched, index, 'Fixture CSP hash was not installed');
    await writeFile(indexPath, patched);
  }
  await prepareBuiltRoot(heldRoot);

  browser = await chromium.launch({executablePath: edge, headless: true,
    args: ['--disable-gpu', '--no-first-run']});
  const context = await browser.newContext({viewport: {width: 1440,
    height: 900}});
  await context.addInitScript(() => { window.open = () => null; });
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1') return route.continue();
    outside.push(host);
    return route.abort();
  });
  const url = `${base}index.html#k=${keyBytes.toString('base64url')}`;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, {waitUntil: 'load'});
  await page.locator('#workspace').waitFor({state: 'visible',
    timeout: 15_000});
  assert.match(await page.frameLocator('#chart').locator('body').textContent(),
    /Invented Gantt/u);
  const actions = ['#signInAction', '#verifyAction',
    '#providerDraftAction', '#customerDraftAction', '#checkSentAction'];
  for (const action of actions) {
    assert.equal(await page.locator(action).isDisabled(), true);
  }
  await page.frameLocator('#chart').locator('#provider').click();
  await page.waitForFunction(expected =>
    document.getElementById('selectedIdentity')?.textContent === expected,
  `Exact source ID: ${providerId}`);
  assert.equal(await page.locator('#selectedIdentity').textContent(),
    `Exact source ID: ${providerId}`);
  assert.equal(await page.locator('#providerDraftAction').isDisabled(), true);
  assert.equal(await page.locator('#providerSourcePanel').isHidden(), true);
  await page.frameLocator('#chart').locator('#customer').click();
  await page.waitForFunction(expected =>
    document.getElementById('selectedIdentity')?.textContent === expected,
  `Exact source ID: ${customerId}`);
  assert.equal(await page.locator('#selectedIdentity').textContent(),
    `Exact source ID: ${customerId}`);
  await page.frameLocator('#chart').locator('#invalid').click();
  await page.waitForFunction(() =>
    document.getElementById('selectedIdentity')?.textContent ===
      'Exact source ID: none selected');
  assert.equal(await page.locator('#selectedIdentity').textContent(),
    'Exact source ID: none selected');
  await page.frameLocator('#chart').locator('#provider').click();
  await page.locator('#chart').evaluate(frame => { frame.srcdoc = frame.srcdoc; });
  await page.waitForFunction(() =>
    document.getElementById('selectedIdentity')?.textContent ===
      'Exact source ID: none selected');
  for (const action of actions) {
    assert.equal(await page.locator(action).isDisabled(), true);
  }
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth), false);
  await page.close();

  // Vite replaces only the two composition imports for this temporary build.
  // Checked-in config remains disabled and no Graph or Outlook request exists.
  const fakeCompose = `globalThis.__fakeCalls=[];
globalThis.__fakePreviewStatus=Object.create(null);
export async function prepareIntegratedSite({panelElements}) {
  const calls=globalThis.__fakeCalls;
  const adapter={enabled:true,
    async signInFromClick(){calls.push(['signIn']);},
    async preview(kind,id){calls.push(['preview',kind,id]);
      const status=globalThis.__fakePreviewStatus[kind]||'eligible';
      const to=kind==='provider'
        ? ['manager@example.invalid','planner@example.invalid']
        : ['customer@example.invalid'];
      return {kind,id,status,canDraft:status==='eligible',
      validUntilUtc:'2099-01-01T00:00:00Z',
      storeNumber:kind==='provider'?'1001':null,
      to,cc:[],recipientReviewRequired:kind==='provider',
      recipientEvidence:kind==='provider'?'verified_pair':null,
      binding:kind==='provider'&&status==='eligible'
        ? {nativeWoId:id,releaseSourceSha256:'a'.repeat(64),
          protectedJoinSha256:'b'.repeat(64),to,cc:[],
          validUntilMs:Date.parse('2099-01-01T00:00:00Z')}
        : null};},
    async createOrOpenProviderDraft(id,binding){
      if(binding?.nativeWoId!==id||binding.to?.[0]!=='manager@example.invalid')
        throw new Error('Unbound provider draft');
      calls.push(['providerDraft',id,binding]);return {
      state:'draft',reviewState:'draft',recipientReviewRequired:true,
      webLink:'https://outlook.office.com/mail/deeplink/compose/invented'};},
    async createOrOpenCustomerDraft(id){calls.push(['customerDraft',id]);return {
      state:'draft',webLink:'https://outlook.office.com/mail/deeplink/compose/invented'};},
    async verifySentBySelection(kind,id){calls.push(['checkSent',kind,id]);return {
      state:'sent'};}};
  const panel={onSelection(value){panelElements.panel.hidden=value?.kind!=='provider';
      panelElements.sourceAsOf.textContent=value?.kind==='provider'
        ? 'Invented dated source only' : '';},
    onSignedIn(){},dispose(){panelElements.panel.hidden=true;}};
  return {adapter,panel};
}`;
  const virtualConfig = '\0held-site-smoke-config';
  const virtualCompose = '\0held-site-smoke-compose';
  await build({configFile: false, root: sourceSite,
    base: appPath, build: {outDir: fakeRoot, emptyOutDir: true,
      rollupOptions: {input: {app: join(sourceSite, 'index.html'),
        redirect: join(sourceSite, 'auth', 'redirect.html')}}},
    plugins: [{name: 'invented-smoke-runtime', enforce: 'pre',
      resolveId(source, importer) {
        if (!importer?.replaceAll('\\', '/').endsWith('/site/view.mjs')) {
          return null;
        }
        if (source === './actions/integration_config.mjs') {
          return virtualConfig;
        }
        if (source === '../src/compose_site.mjs') return virtualCompose;
        return null;
      },
      load(id) {
        if (id === virtualConfig) return `export const INTEGRATION_CONFIG={enabled:true,encryptedPayloadUrl:${JSON.stringify(payloadUrl)}};`;
        if (id === virtualCompose) return fakeCompose;
        return null;
      }}]});
  await prepareBuiltRoot(fakeRoot);
  servedRoot = fakeRoot;
  const enabledPage = await context.newPage();
  enabledPage.on('pageerror', error => errors.push(error.message));
  await enabledPage.goto(url, {waitUntil: 'load'});
  await enabledPage.locator('#workspace').waitFor({state: 'visible',
    timeout: 15_000});
  assert.equal(await enabledPage.locator('#signInAction').isDisabled(), false);
  await enabledPage.frameLocator('#chart').locator('#provider').click();
  await enabledPage.waitForFunction(expected =>
    document.getElementById('selectedIdentity')?.textContent === expected,
  `Exact source ID: ${providerId}`);
  assert.deepEqual(await enabledPage.evaluate(() => window.__fakeCalls), []);
  assert.equal(await enabledPage.locator('#providerDraftAction').isDisabled(), true);
  await enabledPage.locator('#signInAction').click();
  await enabledPage.waitForFunction(() =>
    window.__fakeCalls.some(call => call[0] === 'preview'));
  await enabledPage.locator('#providerDraftAction').waitFor({state: 'visible'});
  assert.equal(await enabledPage.locator('#providerDraftAction').isDisabled(), false);
  assert.equal(await enabledPage.locator('#customerDraftAction').isDisabled(), true);
  assert.equal(await enabledPage.locator('#providerSourcePanel').isHidden(), false);
  assert.equal(await enabledPage.locator('#toReview').inputValue(),
    'manager@example.invalid; planner@example.invalid');
  await enabledPage.locator('#providerDraftAction').click();
  await enabledPage.locator('#openDraftLink').waitFor({state: 'visible'});
  assert.match(await enabledPage.locator('#actionStatus').textContent(),
    /Review recipients/u);
  assert.equal((await enabledPage.evaluate(() => window.__fakeCalls))
    .filter(call => call[0] === 'providerDraft').length, 1);
  await enabledPage.evaluate(() => {
    Object.defineProperty(document, 'visibilityState',
      {configurable: true, value: 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  assert.equal((await enabledPage.evaluate(() => window.__fakeCalls))
    .filter(call => call[0] === 'checkSent').length, 0);
  await enabledPage.evaluate(() => {
    Object.defineProperty(document, 'visibilityState',
      {configurable: true, value: 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await enabledPage.waitForFunction(() => window.__fakeCalls.some(call =>
    call[0] === 'checkSent' && call[1] === 'provider'));
  assert.match(await enabledPage.locator('#actionStatus').textContent(),
    /Sent Items confirms/u);
  assert.equal((await enabledPage.evaluate(() => window.__fakeCalls))
    .filter(call => call[0] === 'providerDraft').length, 1);
  // Synthetic visibility/focus can leave Playwright's pointer state stale.
  // Iframe selection messages do not require a trusted click.
  await enabledPage.frameLocator('#chart').locator('#customer')
    .evaluate(element => element.click());
  await enabledPage.waitForFunction(() =>
    window.__fakeCalls.some(call => call[0] === 'preview' &&
      call[1] === 'customer'));
  assert.equal(await enabledPage.locator('#providerSourcePanel').isHidden(), true);
  assert.equal(await enabledPage.locator('#customerDraftAction').isDisabled(), false);
  assert.equal(await enabledPage.locator('#selectedStore').textContent(),
    'Store: not part of this tracker release');
  assert.equal(await enabledPage.locator('#toReview').inputValue(),
    'customer@example.invalid');
  await enabledPage.locator('#customerDraftAction').click();
  assert.equal((await enabledPage.evaluate(() => window.__fakeCalls))
    .filter(call => call[0] === 'customerDraft').length, 1);
  await enabledPage.locator('#checkSentAction').click();
  assert.match(await enabledPage.locator('#actionStatus').textContent(),
    /Sent Items confirms/u);
  assert.equal((await enabledPage.evaluate(() => window.__fakeCalls))
    .filter(call => call[0] === 'checkSent' && call[1] === 'customer')
    .length, 1);
  await enabledPage.evaluate(() => {
    window.__fakePreviewStatus.provider = 'draft_status_unverified';
  });
  await enabledPage.frameLocator('#chart').locator('#provider')
    .evaluate(element => element.click());
  await enabledPage.waitForFunction(() =>
    document.getElementById('actionStatus')?.textContent.includes(
      'Another coordinator owns an unresolved draft'));
  assert.equal(await enabledPage.locator('#providerDraftAction').isDisabled(),
    true);
  await enabledPage.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  assert.equal((await enabledPage.evaluate(() => window.__fakeCalls))
    .filter(call => call[0] === 'checkSent' && call[1] === 'provider')
    .length, 1);
  await enabledPage.frameLocator('#chart').locator('#invalid')
    .evaluate(element => element.click());
  await enabledPage.waitForFunction(() =>
    document.getElementById('selectedIdentity')?.textContent ===
      'Exact source ID: none selected');
  assert.equal(await enabledPage.locator('#customerDraftAction').isDisabled(), true);
  assert.equal(await enabledPage.locator('#checkSentAction').isDisabled(), true);
  assert.equal(outside.length, 0, 'Browser made an external request');
  assert.deepEqual(errors, [], 'Page JavaScript error');
  assert.equal(localPaths.some(path => path.includes('/auth/redirect.html')),
    false, 'Held page unexpectedly started auth');
  console.log('Isolated Edge smoke passed: built held site plus temporary fake runtime, selection-only iframe, two draft gestures, return-to-Gantt Sent check, cross-owner hold, no external requests.');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(done => server.close(done));
  await rm(temporary, {recursive: true, force: true});
}
