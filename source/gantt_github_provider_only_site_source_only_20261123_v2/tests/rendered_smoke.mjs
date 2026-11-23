// Headless local smoke with invented chart IDs; never touches cloud data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {build} from 'vite';
import {sealSyntheticHtml} from
  '../../gantt_github_two_button_site_integrated_source_only_20261123_v3/tests/fixture_seal.mjs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const project = fileURLToPath(new URL('../', import.meta.url));
const sourceSite = join(project, 'site');
const appPath = '/arbys-coordinator-gantt/';
const providerId = '0WO123456789012345';
const customerId = 'F:12345:67890';
const routes = JSON.stringify({schema: 'ArbysGanttSelection/v1',
  actionsEnabled: false,
  providerAllowedNativeWorkOrderIds: [providerId],
  customerAllowedFormSourceKeys: [customerId]});
const actionScript = [
  'const select=(kind,id)=>parent.postMessage({channel:"arbys.gantt.selection.v1",type:"select",kind,id},"*");',
  `document.getElementById("provider").onclick=()=>select("provider","${providerId}");`,
  `document.getElementById("customer").onclick=()=>select("customer","${customerId}");`,
].join('');
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="application/json" id="actionRoutes">${routes}</script><h1>Invented Gantt</h1><button id="provider">Invented WO</button><button id="customer">Invented FORM</button><script>${actionScript}</script></body></html>`;
const temporary = await mkdtemp(join(tmpdir(), 'arbys-provider-held-'));
const tempRoot = `${resolve(tmpdir())}${sep}`.toLowerCase();
if (!resolve(temporary).toLowerCase().startsWith(tempRoot)) {
  throw new Error('Temporary path escaped the system temp folder');
}
let server;
let browser;
const outside = [];
const errors = [];
const microsoftMocks = [];
let allowMicrosoftMocks = false;
try {
  let servedRoot = join(temporary, 'site');
  await cp(join(project, 'dist'), servedRoot, {recursive: true});
  const {envelope, keyBytes} = await sealSyntheticHtml(fixture);
  const hash = createHash('sha256').update(actionScript).digest('base64');
  async function prepare(root) {
    await mkdir(join(root, 'data'), {recursive: true});
    await writeFile(join(root, 'data', 'gantt.enc.json'),
      JSON.stringify(envelope));
    const indexPath = join(root, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    const patched = index.replace("script-src 'self'",
      `script-src 'self' 'sha256-${hash}'`);
    assert.notEqual(patched, index);
    await writeFile(indexPath, patched);
  }
  await prepare(servedRoot);

  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
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
      const type = relative.endsWith('.js') || relative.endsWith('.mjs') ?
        'text/javascript' : relative.endsWith('.json') ?
          'application/json' : 'text/html';
      response.writeHead(200, {'Content-Type': type,
        'Cache-Control': 'no-store'}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}${appPath}`;
  const url = `${base}index.html#k=${keyBytes.toString('base64url')}`;
  browser = await chromium.launch({executablePath: edge, headless: true,
    args: ['--disable-gpu', '--no-first-run']});
  const context = await browser.newContext({viewport: {width: 1440,
    height: 900}});
  await context.addInitScript(() => { window.open = () => null; });
  await context.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    const host = requestUrl.hostname;
    if (host === '127.0.0.1') return route.continue();
    if (allowMicrosoftMocks && host === 'login.microsoftonline.com' &&
        requestUrl.pathname ===
          '/organizations/v2.0/.well-known/openid-configuration') {
      microsoftMocks.push(['login-connect', route.request().resourceType()]);
      return route.fulfill({status: 200, contentType: 'application/json',
        body: '{"issuer":"https://login.microsoftonline.com/organizations"}'});
    }
    if (allowMicrosoftMocks && host === 'login.microsoftonline.com' &&
        requestUrl.pathname === '/organizations/oauth2/v2.0/authorize') {
      microsoftMocks.push(['login-frame', route.request().resourceType()]);
      return route.fulfill({status: 200, contentType: 'text/html',
        body: '<!doctype html><title>Invented sign-in frame</title>'});
    }
    if (allowMicrosoftMocks && host === 'graph.microsoft.com' &&
        requestUrl.pathname === '/v1.0/me') {
      microsoftMocks.push(['graph-connect', route.request().resourceType()]);
      return route.fulfill({status: 200, contentType: 'application/json',
        body: '{"id":"invented-coordinator"}'});
    }
    outside.push(host);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url, {waitUntil: 'load'});
  await page.locator('#workspace').waitFor({state: 'visible',
    timeout: 15_000});
  assert.match(await page.title(), /coordinator timeline/iu);
  assert.match(await page.frameLocator('#chart').locator('body').textContent(),
    /Invented Gantt/u);
  const controls = ['#signInAction', '#verifyAction',
    '#providerDraftAction', '#customerDraftAction', '#checkSentAction'];
  for (const control of controls) {
    assert.equal(await page.locator(control).isDisabled(), true);
  }
  await page.frameLocator('#chart').locator('#provider').click();
  await page.waitForFunction(expected =>
    document.getElementById('selectedIdentity')?.textContent === expected,
  `Exact source ID: ${providerId}`);
  assert.equal(await page.locator('#providerDraftAction').isDisabled(), true);
  await page.frameLocator('#chart').locator('#customer').click();
  await page.waitForFunction(() =>
    document.getElementById('selectedIdentity')?.textContent ===
      'Exact source ID: none selected');
  assert.equal(await page.locator('#customerDraftAction').isDisabled(), true);
  const desktopShot = join(tmpdir(), 'arbys-provider-only-held-desktop-20261123.png');
  await page.screenshot({path: desktopShot, fullPage: false});
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth), false);
  const mobileShot = join(tmpdir(), 'arbys-provider-only-held-mobile-20261123.png');
  await page.screenshot({path: mobileShot, fullPage: false});
  const pageTitle = await page.title();
  await page.close();

  // A temporary Vite build replaces only the held runtime bindings with an
  // invented adapter. It proves the provider UI can arm while customer stays
  // inert; the checked-in config remains Off and no Graph call is possible.
  const fakeRoot = join(temporary, 'fake');
  const fakeCompose = `globalThis.__fakeCalls=[];
export async function prepareProviderOnlySite() {
  const calls=globalThis.__fakeCalls;
  return {panel:null,adapter:{enabled:true,
    async signInFromClick(){
      const login=await fetch('https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration');
      if(!login.ok)throw new Error('Microsoft authority fetch blocked');
      await new Promise((done,fail)=>{
        const iframe=document.createElement('iframe');
        const timer=setTimeout(()=>{iframe.remove();fail(new Error('Microsoft frame blocked'));},5000);
        iframe.onload=()=>{clearTimeout(timer);iframe.remove();done();};
        iframe.onerror=()=>{clearTimeout(timer);iframe.remove();fail(new Error('Microsoft frame blocked'));};
        iframe.src='https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?prompt=none';
        iframe.hidden=true;document.body.append(iframe);
      });
      calls.push(['signIn']);},
    async preview(kind,id){calls.push(['preview',kind,id]);
      if(kind!=='provider')throw new Error('Customer route held');
      const graph=await fetch('https://graph.microsoft.com/v1.0/me?$select=id');
      if(!graph.ok)throw new Error('Microsoft Graph fetch blocked');
      return {kind,id,status:'eligible',canDraft:true,
        validUntilUtc:'2099-01-01T00:00:00Z',storeNumber:'1001',
        woNumber:'900001',agentCode:'A1',
        workOrderStatus:'Pending Readiness',
        observedAtUtc:'2026-11-23T15:00:00Z',
        to:['manager@example.invalid','planner@example.invalid'],cc:[],
        recipientReviewRequired:false,
        binding:{nativeWoId:id,woNumber:'900001',storeNumber:'1001',
          agentCode:'A1',workOrderStatus:'Pending Readiness',
          observedAtUtc:'2026-11-23T15:00:00Z',
          to:['manager@example.invalid','planner@example.invalid'],
          sourceDigest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sourceETagsJson:'{}',
          releaseBinding:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          validUntilMs:Date.parse('2099-01-01T00:00:00Z')}};},
    async createOrOpenProviderDraft(id,binding){
      if(binding?.nativeWoId!==id||binding.to?.length!==2)
        throw new Error('Preview binding missing');
      calls.push(['providerDraft',id,binding.agentCode]);
      return {state:'draft',webLink:
        'https://outlook.office.com/mail/deeplink/compose/invented'};},
    async createOrOpenCustomerDraft(id){calls.push(['customerDraft',id]);
      throw new Error('Customer route held');},
    async verifySentBySelection(kind,id){calls.push(['checkSent',kind,id]);
      return {state:'held',reason:'NOT_STARTED'};}}};
}`;
  const virtualConfig = '\0provider-only-smoke-config';
  const virtualCompose = '\0provider-only-smoke-compose';
  const payloadUrl = `${base}data/gantt.enc.json`;
  await build({configFile: false, root: sourceSite, base: appPath,
    build: {outDir: fakeRoot, emptyOutDir: true,
      rollupOptions: {input: {app: join(sourceSite, 'index.html'),
        redirect: join(sourceSite, 'auth', 'redirect.html')}}},
    plugins: [{name: 'invented-provider-runtime', enforce: 'pre',
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
        if (id === virtualConfig) {
          return `export const INTEGRATION_CONFIG={enabled:true,encryptedPayloadUrl:${JSON.stringify(payloadUrl)}};`;
        }
        if (id === virtualCompose) return fakeCompose;
        return null;
      }}]});
  await prepare(fakeRoot);
  servedRoot = fakeRoot;
  allowMicrosoftMocks = true;
  const enabledPage = await context.newPage();
  enabledPage.on('pageerror', error => errors.push(error.message));
  await enabledPage.goto(url, {waitUntil: 'load'});
  await enabledPage.locator('#workspace').waitFor({state: 'visible',
    timeout: 15_000});
  assert.equal(await enabledPage.locator('#signInAction').isDisabled(), false);
  await enabledPage.frameLocator('#chart').locator('#provider').click();
  await enabledPage.locator('#signInAction').click();
  await enabledPage.waitForFunction(() =>
    window.__fakeCalls?.some(call => call[0] === 'preview'));
  await enabledPage.waitForFunction(() =>
    document.getElementById('providerDraftAction')?.disabled === false);
  assert.deepEqual(await enabledPage.locator('#toReview').inputValue(),
    'manager@example.invalid; planner@example.invalid');
  assert.equal(await enabledPage.locator('#selectedWorkOrder').textContent(),
    'WO number: 900001');
  assert.equal(await enabledPage.locator('#selectedAgent').textContent(),
    'Assigned SP: A1');
  assert.equal(await enabledPage.locator('#selectedStatus').textContent(),
    'Saved WO status: Pending Readiness');
  assert.equal(await enabledPage.locator('#selectedSourceTime').textContent(),
    'Source observed: 2026-11-23T15:00:00Z');
  assert.equal(await enabledPage.locator('#customerDraftAction').isDisabled(),
    true);
  await enabledPage.frameLocator('#chart').locator('#customer').click();
  await enabledPage.waitForFunction(() =>
    document.getElementById('selectedIdentity')?.textContent ===
      'Exact source ID: none selected');
  assert.equal(await enabledPage.locator('#customerDraftAction').isDisabled(),
    true);
  await enabledPage.frameLocator('#chart').locator('#provider').click();
  await enabledPage.waitForFunction(() =>
    document.getElementById('providerDraftAction')?.disabled === false);
  await enabledPage.locator('#providerDraftAction').click();
  await enabledPage.locator('#openDraftLink').waitFor({state: 'visible'});
  const calls = await enabledPage.evaluate(() => window.__fakeCalls);
  assert.equal(calls.filter(call => call[0] === 'providerDraft').length, 1);
  assert.equal(calls.filter(call => call[0] === 'customerDraft').length, 0);
  assert.deepEqual(microsoftMocks.slice(0, 3), [
    ['login-connect', 'fetch'], ['login-frame', 'document'],
    ['graph-connect', 'fetch'],
  ]);
  await enabledPage.close();
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({status: 'PASS', pageTitle,
    providerSelected: true, customerSelectionIgnored: true,
    heldButtonsDisabled: true, inventedProviderActionArmed: true,
    inventedCustomerActionHeld: true, externalRequests: outside.length,
    mockedMicrosoftRequests: microsoftMocks.length,
    pageErrors: errors.length, screenshots: [desktopShot, mobileShot]}));
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  if (resolve(temporary).toLowerCase().startsWith(tempRoot)) {
    await rm(temporary, {recursive: true, force: true});
  }
}
