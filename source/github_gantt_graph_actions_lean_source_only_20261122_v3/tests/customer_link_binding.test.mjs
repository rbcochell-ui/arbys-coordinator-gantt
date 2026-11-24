import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {canonicalCustomerBody} from '../contract.mjs';
import {createCustomerFormLinkProof,
  verifyPublishedCustomerBinding} from '../customer_link_binding.mjs';
import {CustomerReleaseResolver, RELEASE_FIELDS} from '../customer_source.mjs';

const FORM = ['F', '12345678', '9999999999'].join(':');
const OTHER_FORM = ['F', '12345678', '9999999998'].join(':');
const HANDLE = 'p_' + 'a'.repeat(32);
const KEY = new Uint8Array(32).fill(7);
const TRACKER = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  '?p=' + HANDLE + '#k=' + Buffer.from(KEY).toString('base64url');
const MAIN_URL = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  'data/' + HANDLE + '.json';
const PROOF_URL = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
  'data/' + HANDLE + '.link.json';
const NOW = Date.parse('2026-11-23T12:05:00Z');
const VERIFIED = '2026-11-23T12:00:00Z';
const LIST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = {id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  address: 'coordinator@example.invalid'};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function mainFile({
  slug = HANDLE, lastVerifiedAtUtc = VERIFIED,
  key = KEY,
} = {}) {
  const project = {schema: 'arbys-customer-status/observed-v2',
    slug, customerRequestedDate: '2026-11-15', lastVerifiedAtUtc,
    milestones: {requestReceived: 'complete', dateReview: 'pending',
      workOrders: 'pending', equipmentDelivery: 'pending',
      installation: 'pending', closeout: 'pending'},
    visits: [{ref: 'v_000000000001', visitType: 'Survey',
      observedStatus: 'Completed'}]};
  const nonce = new Uint8Array(12).fill(1);
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key,
    'AES-GCM', false, ['encrypt']);
  const ciphertext = await globalThis.crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce,
    additionalData: new TextEncoder().encode(
      'arbys-customer-status/v1:' + HANDLE), tagLength: 128,
  }, cryptoKey, new TextEncoder().encode(JSON.stringify(project)));
  return Buffer.from(JSON.stringify({schema: 'arbys-customer-cipher/v1',
    handle: HANDLE, nonce: Buffer.from(nonce).toString('base64url'),
    ciphertext: Buffer.from(ciphertext).toString('base64url')}) + '\n');
}

async function files({proofForm = FORM, mainOptions = {}} = {}) {
  const mainRaw = await mainFile(mainOptions);
  const proofRaw = Buffer.from(await createCustomerFormLinkProof({
    formSourceKey: proofForm, trackerUrl: TRACKER,
    nonceBytes: new Uint8Array(12).fill(2),
  }));
  return {mainRaw, proofRaw};
}

function publicFetch({mainRaw, proofRaw}, requests = []) {
  return async (url, init) => {
    requests.push({url, init});
    const bytes = url === MAIN_URL ? mainRaw :
      url === PROOF_URL ? proofRaw : null;
    if (!bytes) return {status: 404, redirected: false, url,
      arrayBuffer: async () => new ArrayBuffer(0)};
    return {status: 200, redirected: false, url,
      arrayBuffer: async () => Uint8Array.from(bytes).buffer};
  };
}

test('same private capability decrypts tracker and FORM binding proof', async () => {
  const set = await files();
  const requests = [];
  const result = await verifyPublishedCustomerBinding({
    formSourceKey: FORM, trackerUrl: TRACKER,
    ciphertextSha256: sha(set.mainRaw), nowMs: NOW,
    fetchImpl: publicFetch(set, requests),
  });
  assert.equal(result.handle, HANDLE);
  assert.equal(result.verifiedAtMs, Date.parse(VERIFIED));
  assert.deepEqual(requests.map(request => request.url).sort(),
    [MAIN_URL, PROOF_URL].sort());
  for (const request of requests) {
    assert.equal(request.url.includes('#'), false);
    assert.equal(request.init.credentials, 'omit');
    assert.equal(request.init.redirect, 'error');
  }
  assert.equal(set.proofRaw.includes(Buffer.from(FORM)), false);
});

test('wrong FORM key cannot reuse a valid private tracker capability', async () => {
  const set = await files();
  await assert.rejects(verifyPublishedCustomerBinding({
    formSourceKey: OTHER_FORM, trackerUrl: TRACKER,
    ciphertextSha256: sha(set.mainRaw), nowMs: NOW,
    fetchImpl: publicFetch(set),
  }), {code: 'RELEASE_TRACKER_FORM_MISMATCH'});
});

test('changed public bytes, missing proof, wrong key and stale page all hold', async () => {
  const set = await files();
  const changed = {mainRaw: Buffer.concat([set.mainRaw, Buffer.from(' ')]),
    proofRaw: set.proofRaw};
  await assert.rejects(verifyPublishedCustomerBinding({
    formSourceKey: FORM, trackerUrl: TRACKER,
    ciphertextSha256: sha(set.mainRaw), nowMs: NOW,
    fetchImpl: publicFetch(changed),
  }), {code: 'RELEASE_TRACKER_CIPHERTEXT_MISMATCH'});
  await assert.rejects(verifyPublishedCustomerBinding({
    formSourceKey: FORM, trackerUrl: TRACKER,
    ciphertextSha256: sha(set.mainRaw), nowMs: NOW,
    fetchImpl: publicFetch({...set, proofRaw: null}),
  }), {code: 'RELEASE_TRACKER_PROOF_UNAVAILABLE'});
  const wrongKey = 'https://rbcochell-ui.github.io/arbys-customer-status-preview/' +
    '?p=' + HANDLE + '#k=' +
    Buffer.from(new Uint8Array(32).fill(8)).toString('base64url');
  await assert.rejects(verifyPublishedCustomerBinding({
    formSourceKey: FORM, trackerUrl: wrongKey,
    ciphertextSha256: sha(set.mainRaw), nowMs: NOW,
    fetchImpl: publicFetch(set),
  }), {code: 'RELEASE_TRACKER_PAGE_INVALID'});
  const old = await files({mainOptions: {
    lastVerifiedAtUtc: '2026-11-22T12:00:00Z'}});
  await assert.rejects(verifyPublishedCustomerBinding({
    formSourceKey: FORM, trackerUrl: TRACKER,
    ciphertextSha256: sha(old.mainRaw), nowMs: NOW,
    fetchImpl: publicFetch(old),
  }), {code: 'RELEASE_TRACKER_PAGE_STALE'});
});

function releaseGraph({inventory, mainRaw, proofRaw}) {
  const fields = {
    FormSourceKey: FORM, ReleaseState: 'Ready', ReleaseKind: 'FirstPilot',
    PublishedCommit: 'a'.repeat(40), CiphertextSha256: sha(mainRaw),
    ReleaseReceiptSha256: 'b'.repeat(64),
    RecipientEmail: 'customer@example.invalid',
    DraftSubject: 'Follow along with your Arby project',
    DraftBodyHtml: canonicalCustomerBody(TRACKER),
    CustomerTrackingUrl: TRACKER,
    IssuedAtUtc: '2026-11-23T12:00:00Z',
    ReadyUntilUtc: '2026-11-23T12:30:00Z',
    DraftState: 'NotRequested', DraftMailbox: null,
    DraftMessageId: null, DraftWebLink: null, DraftRequestedAtUtc: null,
  };
  const item = {id: '1', eTag: '"1"', fields,
    lastModifiedBy: {user: {id: OWNER}},
    lastModifiedDateTime: '2026-11-23T12:01:00Z'};
  const publicRequests = [];
  const graph = {
    async getMe() { return ACTOR; },
    async request(path) {
      const url = new URL(path, 'https://graph.microsoft.com');
      if (url.pathname.endsWith('/columns')) {
        return {status: 200, data: {value: RELEASE_FIELDS.map(name =>
          name === 'FormSourceKey' ? {name, required: true, indexed: true,
            enforceUniqueValues: true, text: {}} : {name})}};
      }
      if (url.pathname.endsWith('/items/1')) {
        return {status: 200, data: item};
      }
      if (url.pathname.endsWith('/items')) {
        return {status: 200, data: url.searchParams.has('$filter')
          ? {value: [item]} : inventory};
      }
      return {status: 200, data: {id: LIST_ID,
        displayName: 'Arbys Customer Draft Releases',
        webUrl: 'https://groups.coca-cola.com/sites/ArbysOperations/Lists/' +
          'Arbys%20Customer%20Draft%20Releases/AllItems.aspx'}};
    },
  };
  const config = {siteId: 'invented-site',
    lists: {customerReleases: LIST_ID},
    approvedCustomerReleaseKinds: ['FirstPilot'],
    releaseOwnerOids: [OWNER]};
  return {resolver: new CustomerReleaseResolver({graph, config,
    now: () => NOW, fetchImpl: publicFetch({mainRaw, proofRaw}, publicRequests)}),
  publicRequests};
}

test('Ready Release resolves only with one handle across all projects', async () => {
  const set = await files();
  const inventory = {value: [
    {id: '1', fields: {
      FormSourceKey: FORM, CustomerTrackingUrl: TRACKER}},
    {id: '2', fields: {FormSourceKey: OTHER_FORM}},
  ]};
  const {resolver, publicRequests} = releaseGraph({...set, inventory});
  const source = await resolver.resolve(FORM, ACTOR);
  assert.equal(source.formSourceKey, FORM);
  assert.equal(source.trackerUrl, TRACKER);
  assert.equal(publicRequests.length, 2);
});

test('two FORM releases using the same tracker handle hold before page read', async () => {
  const set = await files();
  const inventory = {value: [
    {id: '1', fields: {FormSourceKey: FORM, CustomerTrackingUrl: TRACKER}},
    {id: '2', fields: {FormSourceKey: OTHER_FORM,
      CustomerTrackingUrl: TRACKER}},
  ]};
  const {resolver, publicRequests} = releaseGraph({...set, inventory});
  await assert.rejects(resolver.resolve(FORM, ACTOR),
    {code: 'RELEASE_TRACKER_HANDLE_REUSED'});
  assert.deepEqual(publicRequests, []);
});

test('a second capability key cannot reuse one published tracker handle',
  async () => {
    const set = await files();
    const alternateUrl = TRACKER.replace(
      Buffer.from(KEY).toString('base64url'),
      Buffer.from(new Uint8Array(32).fill(8)).toString('base64url'));
    const inventory = {value: [
      {id: '1', fields: {FormSourceKey: FORM, CustomerTrackingUrl: TRACKER}},
      {id: '2', fields: {FormSourceKey: OTHER_FORM,
        CustomerTrackingUrl: alternateUrl}},
    ]};
    const {resolver, publicRequests} = releaseGraph({...set, inventory});
    await assert.rejects(resolver.resolve(FORM, ACTOR),
      {code: 'RELEASE_TRACKER_HANDLE_REUSED'});
    assert.deepEqual(publicRequests, []);
  });

test('paged or missing Release inventory never proves URL uniqueness', async () => {
  const set = await files();
  for (const inventory of [
    {value: [{id: '1', fields: {
      FormSourceKey: FORM, CustomerTrackingUrl: TRACKER}}],
    '@odata.nextLink': 'https://graph.microsoft.com/invented-page'},
    {value: []},
    {value: [{id: '1', fields: {FormSourceKey: FORM}}]},
  ]) {
    const {resolver, publicRequests} = releaseGraph({...set, inventory});
    await assert.rejects(resolver.resolve(FORM, ACTOR),
      {code: 'RELEASE_TRACKER_INVENTORY_INCOMPLETE'});
    assert.deepEqual(publicRequests, []);
  }
});
