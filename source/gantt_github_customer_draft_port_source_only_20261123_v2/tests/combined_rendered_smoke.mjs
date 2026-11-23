// Local browser exercise of the held combined shell with invented identifiers.
// The checked-in config stays Off. No Microsoft or GitHub service is contacted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from
  'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const customerRoot = fileURLToPath(new URL('../', import.meta.url));
const customerName = basename(resolve(customerRoot));
const providerName = 'gantt_github_provider_only_site_source_only_20261123_v2';
const coreName = 'github_gantt_graph_actions_lean_source_only_20261122_v3';
const snapshotName =
  'gantt_github_snapshot_first_provider_flow_source_only_20261123_v4';
const twoButtonName =
  'gantt_github_two_button_site_integrated_source_only_20261123_v3';
const providerRoot = resolve(process.env.ARBYS_PROVIDER_V2_ROOT ??
  join(customerRoot, '..', providerName));
const sourceRoot = resolve(providerRoot, '..');
const providerRequire = createRequire(join(providerRoot, 'package.json'));
const {build} = await import(pathToFileURL(
  providerRequire.resolve('vite')).href);
const {chromium} = providerRequire('playwright-core');
const {sealSyntheticHtml} = await import(pathToFileURL(join(sourceRoot,
  twoButtonName, 'tests', 'fixture_seal.mjs')).href);

const appPath = '/arbys-coordinator-gantt/';
const providerId = '0WO123456789012345';
const customerId = 'F:12345:67890';
const selection = JSON.stringify({schema: 'ArbysGanttSelection/v1',
  actionsEnabled: false,
  providerAllowedNativeWorkOrderIds: [providerId],
  customerAllowedFormSourceKeys: [customerId]});
const actionScript = [
  'const select=(kind,id)=>parent.postMessage({channel:"arbys.gantt.selection.v1",type:"select",kind,id},"*");',
  'document.getElementById("provider").onclick=()=>select("provider","' +
    providerId + '");',
  'document.getElementById("customer").onclick=()=>select("customer","' +
    customerId + '");',
].join('');
const fixture = '<!doctype html><html><head><meta charset="utf-8"></head>' +
  '<body><script type="application/json" id="actionRoutes">' +
  selection + '</script><h1>Invented Gantt</h1>' +
  '<button id="provider">Invented WO</button>' +
  '<button id="customer">Invented FORM</button><script>' +
  actionScript + '</script></body></html>';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const temporary = await mkdtemp(join(tmpdir(), 'arbys-combined-held-'));
const tempPrefix = resolve(tmpdir()).toLowerCase() + sep;
if (!resolve(temporary).toLowerCase().startsWith(tempPrefix)) {
  throw new Error('Temporary path escaped the system temp folder');
}
const stagedSource = join(temporary, 'source');
const stagedProvider = join(stagedSource, providerName);
const heldDist = join(temporary, 'held-dist');
const activeDist = join(temporary, 'fake-active-dist');
let server;
let browser;
const outside = [];
const errors = [];
const microsoftMocks = [];
let allowMicrosoftMocks = false;

try {
  await mkdir(stagedSource, {recursive: true});
  const onlySource = src => !['node_modules', 'dist', 'tests']
    .includes(basename(src));
  await cp(providerRoot, stagedProvider, {recursive: true,
    filter: onlySource});
  await cp(join(sourceRoot, coreName), join(stagedSource, coreName),
    {recursive: true, filter: onlySource});
  await cp(join(sourceRoot, snapshotName), join(stagedSource, snapshotName),
    {recursive: true, filter: onlySource});
  await cp(customerRoot, join(stagedSource, customerName),
    {recursive: true, filter: src => !['node_modules', 'dist', 'tests', 'overlay']
      .includes(basename(src))});
  for (const relative of [
    join('src', 'combined_compose.mjs'),
    join('site', 'index.html'),
    join('site', 'view.mjs'),
    join('site', 'actions', 'ui_controller.mjs'),
    join('site', 'actions', 'integration_config.mjs'),
  ]) {
    await cp(join(customerRoot, 'overlay', relative),
      join(stagedProvider, relative), {force: true});
  }
  try {
    await symlink(join(providerRoot, 'node_modules'),
      join(stagedProvider, 'node_modules'), 'junction');
  } catch {
    await cp(join(providerRoot, 'node_modules'),
      join(stagedProvider, 'node_modules'), {recursive: true});
  }

  const sourceSite = join(stagedProvider, 'site');
  const buildInputs = {app: join(sourceSite, 'index.html'),
    redirect: join(sourceSite, 'auth', 'redirect.html')};
  await build({configFile: false, root: sourceSite, base: appPath,
    build: {outDir: heldDist, emptyOutDir: true,
      rollupOptions: {input: buildInputs}}});
  const {envelope, keyBytes} = await sealSyntheticHtml(fixture);
  const hash = createHash('sha256').update(actionScript).digest('base64');
  async function prepare(root) {
    await mkdir(join(root, 'data'), {recursive: true});
    await writeFile(join(root, 'data', 'gantt.enc.json'),
      JSON.stringify(envelope));
    const path = join(root, 'index.html');
    const index = await readFile(path, 'utf8');
    const patched = index.replace("script-src 'self'",
      "script-src 'self' 'sha256-" + hash + "'");
    assert.notEqual(patched, index);
    await writeFile(path, patched);
  }
  await prepare(heldDist);

  let servedRoot = heldDist;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative = pathname === appPath ? 'index.html' :
      pathname.startsWith(appPath) ? pathname.slice(appPath.length) : null;
    if (!relative) { response.writeHead(404).end(); return; }
    const root = resolve(servedRoot);
    const target = resolve(root, relative);
    if (!target.toLowerCase().startsWith((root + sep).toLowerCase())) {
      response.writeHead(403).end(); return;
    }
    try {
      const bytes = await readFile(target);
      const type = /\.(?:m?js)$/u.test(relative) ? 'text/javascript' :
        relative.endsWith('.json') ? 'application/json' : 'text/html';
      response.writeHead(200, {'Content-Type': type,
        'Cache-Control': 'no-store'}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + server.address().port + appPath;
  const url = base + 'index.html#k=' + keyBytes.toString('base64url');
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
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
  };

  const heldPage = await context.newPage();
  watch(heldPage);
  await heldPage.goto(url, {waitUntil: 'load'});
  await heldPage.locator('#workspace').waitFor({state: 'visible',
    timeout: 15_000});
  for (const id of ['signInAction', 'providerDraftAction',
      'customerDraftAction', 'checkSentAction']) {
    assert.equal(await heldPage.locator('#' + id).isDisabled(), true);
  }
  await heldPage.frameLocator('#chart').locator('#customer').click();
  await heldPage.waitForFunction(() =>
    document.getElementById('selectedIdentity')?.textContent ===
      'Exact source ID: none selected');
  assert.equal(await heldPage.locator('#customerDraftAction').isDisabled(),
    true);
  await heldPage.close();

  // Vite substitutes only the bindings. It exercises the real combined UI
  // and browser CSP; the fake adapter uses no tenant, Lists, or mailbox.
  const fakeCompose = [
    'globalThis.__fakeCalls=[];',
    'globalThis.__customerApproved=false;',
    'globalThis.__providerBound=false;',
    'export async function prepareCombinedSite() {',
    ' const calls=globalThis.__fakeCalls;',
    ' return {panel:null,providerEnabled:true,customerEnabled:true,',
    ' adapter:{enabled:true,',
    ' async signInFromClick(){',
    '  const login=await fetch("https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration");',
    '  if(!login.ok)throw new Error("Microsoft authority fetch blocked");',
    '  await new Promise((done,fail)=>{',
    '   const iframe=document.createElement("iframe");',
    '   const timer=setTimeout(()=>{iframe.remove();fail(new Error("Microsoft frame blocked"));},5000);',
    '   iframe.onload=()=>{clearTimeout(timer);iframe.remove();done();};',
    '   iframe.onerror=()=>{clearTimeout(timer);iframe.remove();fail(new Error("Microsoft frame blocked"));};',
    '   iframe.src="https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?prompt=none";',
    '   iframe.hidden=true;document.body.append(iframe);',
    '  });',
    '  const graph=await fetch("https://graph.microsoft.com/v1.0/me?$select=id");',
    '  if(!graph.ok)throw new Error("Microsoft Graph fetch blocked");',
    '  calls.push(["signIn"]);},',
    ' async preview(kind,id){calls.push(["preview",kind,id]);',
    '  if(kind==="customer") return {kind,id,status:"eligible",',
    '   canDraft:true,validUntilUtc:"2099-01-01T00:00:00Z",',
    '   to:["approved@example.invalid"],cc:[],',
    '   recipientReviewRequired:!globalThis.__customerApproved,',
    '   binding:{formSourceKey:id,sourceDigest:"c".repeat(64),',
    '    sourceETagsJson:"{}",recipientEmail:"approved@example.invalid",',
    '    trackerUrlSha256:"d".repeat(64),',
    '    validUntilMs:Date.parse("2099-01-01T00:00:00Z")}};',
    '  if(kind==="provider") return {kind,id,status:"eligible",',
    '   canDraft:true,validUntilUtc:"2099-01-01T00:00:00Z",',
    '   storeNumber:"1001",woNumber:"900001",agentCode:"A1",',
    '   workOrderStatus:"Pending Readiness",',
    '   observedAtUtc:"2026-11-23T15:00:00Z",',
    '   to:["manager@example.invalid","planner@example.invalid"],cc:[],',
    '   recipientReviewRequired:false,',
    '   binding:globalThis.__providerBound?{nativeWoId:id,woNumber:"900001",',
    '    storeNumber:"1001",agentCode:"A1",',
    '    workOrderStatus:"Pending Readiness",',
    '    observedAtUtc:"2026-11-23T15:00:00Z",',
    '    to:["manager@example.invalid","planner@example.invalid"],',
    '    sourceDigest:"a".repeat(64),sourceETagsJson:"{}",',
    '    releaseBinding:"b".repeat(64),',
    '    validUntilMs:Date.parse("2099-01-01T00:00:00Z")}:null};',
    '  throw new Error("Unsupported kind");},',
    ' async createOrOpenProviderDraft(id,binding){',
    '  if(binding?.nativeWoId!==id)throw new Error("Missing bound preview");',
    '  calls.push(["providerDraft",id,binding.agentCode]);',
    '  return {state:"draft",webLink:"https://outlook.office.com/mail/deeplink/compose/invented"};},',
    ' async createOrOpenCustomerDraft(id,binding){',
    '  if(binding?.formSourceKey!==id||',
    '    binding?.recipientEmail!=="approved@example.invalid")',
    '    throw new Error("Missing customer release binding");',
    '  calls.push(["customerDraft",id,binding.trackerUrlSha256]);',
    '  return {state:"draft",webLink:"https://outlook.office.com/mail/deeplink/compose/invented"};},',
    ' async verifySentBySelection(kind,id){calls.push(["checkSent",kind,id]);',
    '  return {state:"held",reason:"NOT_STARTED"};}',
    ' }};',
    '}',
  ].join('\n');
  const virtualConfig = '\0combined-smoke-config';
  const virtualCompose = '\0combined-smoke-compose';
  const payloadUrl = base + 'data/gantt.enc.json';
  await build({configFile: false, root: sourceSite, base: appPath,
    build: {outDir: activeDist, emptyOutDir: true,
      rollupOptions: {input: buildInputs}},
    plugins: [{name: 'invented-combined-runtime', enforce: 'pre',
      resolveId(source, importer) {
        if (!importer?.replaceAll('\\', '/').endsWith('/site/view.mjs')) {
          return null;
        }
        if (source === './actions/integration_config.mjs') {
          return virtualConfig;
        }
        if (source === '../src/combined_compose.mjs') return virtualCompose;
        return null;
      },
      load(id) {
        if (id === virtualConfig) {
          return 'export const INTEGRATION_CONFIG={enabled:true,' +
            'encryptedPayloadUrl:' + JSON.stringify(payloadUrl) + '};';
        }
        if (id === virtualCompose) return fakeCompose;
        return null;
      }}]});
  await prepare(activeDist);
  servedRoot = activeDist;
  allowMicrosoftMocks = true;

  const page = await context.newPage();
  watch(page);
  await page.goto(url, {waitUntil: 'load'});
  await page.locator('#workspace').waitFor({state: 'visible',
    timeout: 15_000});
  assert.match(await page.locator('#customerDraftAction').textContent(),
    /customer milestone draft/iu);
  await page.frameLocator('#chart').locator('#customer').click();
  await page.waitForFunction(expected =>
    document.getElementById('selectedIdentity')?.textContent === expected,
  'Exact source ID: ' + customerId);
  await page.locator('#signInAction').click();
  await page.waitForFunction(() => globalThis.__fakeCalls
    ?.some(call => call[0] === 'preview' && call[1] === 'customer'));
  assert.equal(await page.locator('#customerDraftAction').isDisabled(), true,
    'unreviewed recipient must hold the customer button');
  await page.evaluate(() => { globalThis.__customerApproved = true; });
  await page.locator('#verifyAction').click();
  await page.waitForFunction(() =>
    document.getElementById('customerDraftAction')?.disabled === false);
  assert.equal(await page.locator('#toReview').inputValue(),
    'approved@example.invalid');
  assert.match(await page.locator('#recipientHelp').textContent(),
    /does not prove who clicked Submit/iu);
  assert.match(await page.locator('#selectedStore').textContent(),
    /owner-approved Release/iu);
  await page.locator('#customerDraftAction').click();
  await page.locator('#openDraftLink').waitFor({state: 'visible'});
  let calls = await page.evaluate(() => globalThis.__fakeCalls);
  assert.equal(calls.filter(call => call[0] === 'customerDraft').length, 1);
  assert.equal(calls.find(call => call[0] === 'customerDraft')[2],
    'd'.repeat(64));
  assert.equal(calls.filter(call => call[0] === 'providerDraft').length, 0);

  await page.frameLocator('#chart').locator('#provider').click();
  await page.waitForFunction(expected =>
    document.getElementById('selectedIdentity')?.textContent === expected,
  'Exact source ID: ' + providerId);
  await page.waitForFunction(() => globalThis.__fakeCalls
    ?.some(call => call[0] === 'preview' && call[1] === 'provider'));
  assert.equal(await page.locator('#providerDraftAction').isDisabled(), true,
    'provider button must require its bound preview');
  await page.evaluate(() => { globalThis.__providerBound = true; });
  await page.locator('#verifyAction').click();
  await page.waitForFunction(() =>
    document.getElementById('providerDraftAction')?.disabled === false);
  await page.locator('#providerDraftAction').click();
  await page.locator('#openDraftLink').waitFor({state: 'visible'});
  calls = await page.evaluate(() => globalThis.__fakeCalls);
  assert.equal(calls.filter(call => call[0] === 'customerDraft').length, 1);
  assert.equal(calls.filter(call => call[0] === 'providerDraft').length, 1);
  assert.deepEqual(microsoftMocks.slice(0, 3), [
    ['login-connect', 'fetch'], ['login-frame', 'document'],
    ['graph-connect', 'fetch'],
  ]);
  await page.close();
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({status: 'PASS', heldButtonsDisabled: true,
    unreviewedCustomerHeld: true, customerDraftClicked: true,
    unboundProviderHeld: true, boundProviderDraftClicked: true,
    microsoftNetworkMocks: microsoftMocks.length,
    unexpectedExternalRequests: outside.length, pageErrors: errors.length}));
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  if (resolve(temporary).toLowerCase().startsWith(tempPrefix)) {
    await rm(temporary, {recursive: true, force: true});
  }
}
