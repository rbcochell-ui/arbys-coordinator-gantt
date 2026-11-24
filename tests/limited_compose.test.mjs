import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash, webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCustomerTrackerUrl as validateIntentCustomerTrackerUrl} from '../actions/contract.mjs';
import {encryptPilotBinding, decryptPilotBinding, createPilotBindingDecoder,
  PILOT_BINDING_SCHEMA,
  validateCustomerTrackerUrl, validatePilotBindingPayload} from '../actions/pilot_binding.mjs';
import {encryptProviderBinding, decryptProviderBinding, createProviderBindingDecoder,
  PROVIDER_BINDING_SCHEMA} from '../actions/provider_binding.mjs';
import {BINDING_PUBLIC_SPKI_BASE64URL, BINDING_SIGNING_KEY_ID,
  canonicalBindingEnvelopeBytes, verifySignedBindingEnvelope,
  verifyBindingEnvelopeWithKey} from '../actions/binding_signature.mjs';
import {BINDING_BUNDLE_SCHEMA, parseBindingBundle, createBindingBundleParser,
  decryptSelectedBinding, createSelectedBindingDecoder} from '../actions/binding_bundle.mjs';
import {COMPOSE_RELEASE, digestSelection} from '../actions/action_release.mjs';
import {buildLocalHelperUri, buildAllowlistedHandoffUri, localHandoffEnabled,
  parseLocalHelperUri, requestLocalHandoff} from '../actions/local_helper_uri.mjs';
import {parseComposeSources} from '../actions/selection_source.mjs';
import {createFrameSelectionBridge, FRAME_SELECTION_CHANNEL} from '../actions/frame_bridge.mjs';
import {readPrivateSigningKey, signBindingEnvelope} from '../scripts/sign_binding_envelope.mjs';

const WO_ID = `0WO${'A'.repeat(15)}`;
const WO_ID_B = `0WO${'B'.repeat(15)}`;
const FORM_KEY = 'F:123:456';
const FORM_KEY_B = 'F:123:457';
const CHART_KEY = Uint8Array.from({length: 32}, (_, index) => index);
const PROVIDER_DIGEST = await digestSelection({kind: 'provider', id: WO_ID}, CHART_KEY);
const CUSTOMER_DIGEST = await digestSelection({kind: 'customer', id: FORM_KEY}, CHART_KEY);
const SOURCE_AT = '2026-11-22T18:43:09Z';
const TRACKER = `https://rbcochell-ui.github.io/arbys-customer-status-preview/?p=p_${'a'.repeat(32)}#k=${'A'.repeat(43)}`;
const TRACKER_B = `https://rbcochell-ui.github.io/arbys-customer-status-preview/?p=p_${'b'.repeat(32)}#k=${'E'.repeat(43)}`;
const DIRECT_IDENTITY = Object.freeze({storeNumber: '90123', outletAcn: '000123456',
  assignedSpAgentCode: 'T01'});

let inventedSignerPromise;
function inventedSigner() {
  inventedSignerPromise ??= (async () => {
    const pair = await webcrypto.subtle.generateKey(
      {name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
    const publicSpki = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey));
    const publicSpkiBase64Url = publicSpki.toString('base64url');
    const keyId = createHash('sha256').update(publicSpki).digest('hex');
    assert.notEqual(keyId, BINDING_SIGNING_KEY_ID);
    return {pair, publicSpkiBase64Url, keyId};
  })();
  return inventedSignerPromise;
}

async function signInventedEnvelope(unsigned, kind, selectedId, signer) {
  const beforeSignature = {...unsigned, keyId: signer.keyId};
  const message = canonicalBindingEnvelopeBytes(beforeSignature, kind, selectedId,
    signer.keyId);
  const raw = await webcrypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'},
    signer.pair.privateKey, message);
  return {...beforeSignature, signature: Buffer.from(raw).toString('base64url')};
}

function inventedDecoders(signer) {
  const verify = (envelope, kind, selectedId) => verifyBindingEnvelopeWithKey(
    envelope, kind, selectedId, signer.publicSpkiBase64Url, signer.keyId);
  return {provider: createProviderBindingDecoder(verify),
    customer: createPilotBindingDecoder(verify)};
}

function syntheticHtml({woType = 'Installation', nativeHold, overlayHold = '0',
    overlayNumber = '1234567', overlayIdentity = DIRECT_IDENTITY,
    contacts = true, woStore = '90123', nativeStore = '90123',
    acn = '000123456', nativeAcn = '000123456', agentCode = 'T01',
    nativeAgent = 'T01 - Test Provider',
    nativeId = WO_ID.slice(0, 15), plannerEmail = 'planner@example.test'} = {}) {
  const data = {schema: 'arbys-local-exact-form-project-preview/v16', asOfDate: '2026-11-18',
    projects: [{caseKey: FORM_KEY, formStore: '90123', cases: [{workOrders: [{
      id: WO_ID, number: '1234567', type: woType, status: 'Pending Readiness',
      assignedSpAgentCode: agentCode, woStore, acn,
      nativeFields: {...(nativeHold === undefined ? {} : {Hold: nativeHold}),
        'Store Number': nativeStore,
        'Work Order ID': nativeId, ACN: nativeAcn,
        'Assigned SP - Name': nativeAgent},
      providerContactCandidate: contacts ? {state: 'two_source_file_candidate',
        installManagerEmail: 'install@example.test', plannerEmail} : null,
    }]}]}]};
  const overlay = {schema: 'ArbysProviderVisitSourceOverlay/v2', observedAtUtc: SOURCE_AT,
    rows: {[WO_ID]: {nativeWorkOrderId: WO_ID.slice(0, 15), workOrderNumber: overlayNumber,
      workOrderType: woType, activityType: 'Installation', status: 'Pending Readiness',
      hold: overlayHold, spActivityDate: '2026-11-30', ...overlayIdentity}}};
  return `<script type="application/json" id="snapshotData">${JSON.stringify(data)}</script>` +
    `<script type="application/json" id="providerVisitSourceOverlay">${JSON.stringify(overlay)}</script>`;
}

test('selection source accepts only an exact allowlisted installation with matching WO evidence', () => {
  const allowed = {providerIds: [WO_ID], customerKeys: [FORM_KEY]};
  const selected = parseComposeSources(syntheticHtml(), allowed);
  assert.equal(selected.providerById[WO_ID].displayWoNumber, '1234567');
  assert.deepEqual(selected.providerById[WO_ID].suggestedRecipients,
    ['install@example.test', 'planner@example.test']);
  assert.equal(selected.customerByKey[FORM_KEY].storeNumber, '90123');
  assert.equal(Object.keys(parseComposeSources(syntheticHtml({woType: 'Survey'}), allowed).providerById).length, 0);
  assert.equal(Object.keys(parseComposeSources(syntheticHtml({overlayHold: '1'}), allowed).providerById).length, 0);
  assert.equal(Object.keys(parseComposeSources(syntheticHtml({nativeHold: '1'}), allowed).providerById).length, 0);
  assert.equal(Object.keys(parseComposeSources(syntheticHtml({nativeHold: null}), allowed).providerById).length, 0);
  assert.equal(Object.keys(parseComposeSources(syntheticHtml({overlayNumber: '9999999'}), allowed).providerById).length, 0);
  for (const changedIdentity of [
    {...DIRECT_IDENTITY, storeNumber: '90124'},
    {...DIRECT_IDENTITY, outletAcn: '999999999'},
    {...DIRECT_IDENTITY, assignedSpAgentCode: 'T02'},
  ]) {
    assert.equal(Object.keys(parseComposeSources(syntheticHtml({overlayIdentity: changedIdentity}),
      allowed).providerById).length, 0, JSON.stringify(changedIdentity));
  }
  for (const missing of Object.keys(DIRECT_IDENTITY)) {
    const incomplete = {...DIRECT_IDENTITY};
    delete incomplete[missing];
    assert.equal(Object.keys(parseComposeSources(syntheticHtml({overlayIdentity: incomplete}),
      allowed).providerById).length, 0, `Missing direct ${missing}`);
  }
  for (const changed of [
    {woStore: '99999'}, {nativeStore: '99999'}, {acn: '999999999'},
    {nativeAcn: '999999999'}, {nativeAgent: 'Z99 - Wrong Provider'},
    {nativeId: `0WO${'Z'.repeat(12)}`},
  ]) {
    assert.equal(Object.keys(parseComposeSources(syntheticHtml(changed), allowed).providerById).length, 0,
      JSON.stringify(changed));
  }
  assert.equal(Object.keys(parseComposeSources(syntheticHtml(), {providerIds: [], customerKeys: []}).providerById).length, 0);
  assert.deepEqual(parseComposeSources(syntheticHtml({contacts: false}), allowed).providerById[WO_ID].suggestedRecipients, []);
  assert.deepEqual(parseComposeSources(syntheticHtml({plannerEmail: 'install@example.test'}), allowed).providerById[WO_ID].suggestedRecipients, []);
});

test('dated WO selection stays legible when the later visit overlay lacks routing identity', () => {
  const allowed = {providerIds: [WO_ID], customerKeys: [FORM_KEY]};
  const parsed = parseComposeSources(syntheticHtml({overlayIdentity: {}}), allowed);
  assert.equal(parsed.providerById[WO_ID], undefined);
  assert.deepEqual(parsed.providerDisplayById[WO_ID], {
    displayWoNumber: '1234567', storeNumber: '90123',
    agentCode: 'T01', snapshotAsOfDate: '2026-11-18',
  });
  assert.equal('suggestedRecipients' in parsed.providerDisplayById[WO_ID], false);
  assert.equal(parseComposeSources(syntheticHtml({nativeAgent: 'T02 - Other Provider'}),
    allowed).providerDisplayById[WO_ID], undefined);
});

test('missing or malformed provider overlay holds routing while keeping FORM context', () => {
  const allowed = {providerIds: [WO_ID], customerKeys: [FORM_KEY]};
  const original = syntheticHtml();
  const withoutOverlay = original.replace(
    /<script type="application\/json" id="providerVisitSourceOverlay">[^<]+<\/script>/u, '');
  const wrongSchema = original.replace('ArbysProviderVisitSourceOverlay/v2',
    'ArbysProviderVisitSourceOverlay/unknown');
  const malformedObserved = original.replace(`"observedAtUtc":"${SOURCE_AT}"`,
    '"observedAtUtc":{"toString":"broken"}');
  const duplicated = original + original.match(
    /<script type="application\/json" id="providerVisitSourceOverlay">[^<]+<\/script>/u)[0];
  for (const html of [withoutOverlay, wrongSchema, malformedObserved, duplicated]) {
    const selected = parseComposeSources(html, allowed);
    assert.equal(selected.providerById[WO_ID], undefined);
    assert.equal(selected.providerDisplayById[WO_ID].displayWoNumber, '1234567');
    assert.equal(selected.customerByKey[FORM_KEY].storeNumber, '90123');
    assert.equal(selected.snapshotAsOfDate, '2026-11-18');
    assert.equal(selected.overlayObservedAtUtc, null);
  }
  assert.throws(() => parseComposeSources(withoutOverlay.replace(
    'arbys-local-exact-form-project-preview/v16', 'unknown'), allowed),
  /Chart action data unavailable/u);
});

test('a malformed Assigned SP field holds only that work order action, not the chart', () => {
  const allowed = {providerIds: [WO_ID], customerKeys: [FORM_KEY]};
  for (const malformed of [null, 17, {name: 'T01'}, ['T01']]) {
    const parsed = parseComposeSources(syntheticHtml({nativeAgent: malformed}), allowed);
    assert.equal(Object.keys(parsed.providerById).length, 0);
    assert.equal(parsed.customerByKey[FORM_KEY].storeNumber, '90123');
  }
  for (const malformed of [null, 17, {code: 'T01'}]) {
    const parsed = parseComposeSources(syntheticHtml({agentCode: malformed}), allowed);
    assert.equal(Object.keys(parsed.providerById).length, 0);
    assert.equal(parsed.customerByKey[FORM_KEY].storeNumber, '90123');
  }
});

test('provider contact binding requires exact WO, agent, store, ACN, and two distinct role emails', async () => {
  const master = new Uint8Array(32).fill(21);
  const source = parseComposeSources(syntheticHtml(),
    {providerIds: [WO_ID], customerKeys: []}).providerById[WO_ID];
  const payload = {
    schema: PROVIDER_BINDING_SCHEMA,
    nativeWoId: WO_ID, agentCode: 'T01', storeNumber: '90123',
    outletAcn: '000123456', installManagerEmail: 'install@example.test',
    plannerEmail: 'planner@example.test', contactKey: 'a'.repeat(64),
    sourceEvidenceDigest: 'b'.repeat(64), sourceRecordSha256: 'c'.repeat(64),
    sourceCheckedAtUtc: '2026-11-19T17:00:00Z',
    verifiedAtUtc: '2026-11-19T17:01:00Z',
  };
  const unsigned = await encryptProviderBinding(payload, master);
  const signer = await inventedSigner();
  const envelope = await signInventedEnvelope(unsigned, 'provider', WO_ID, signer);
  const decodeWithTestKey = inventedDecoders(signer).provider;
  const serialized = JSON.stringify(envelope);
  assert.deepEqual(Object.keys(unsigned).sort(), ['ciphertext', 'nonce', 'schema']);
  assert.deepEqual(Object.keys(envelope).sort(),
    ['ciphertext', 'keyId', 'nonce', 'schema', 'signature']);
  assert.equal(serialized.includes('install@example.test'), false);
  assert.equal(serialized.includes('planner@example.test'), false);
  assert.equal(await verifySignedBindingEnvelope(envelope, 'provider', WO_ID), false);
  assert.equal(await verifyBindingEnvelopeWithKey(envelope, 'provider', WO_ID,
    signer.publicSpkiBase64Url, signer.keyId), true);
  await assert.rejects(decryptProviderBinding(unsigned, master, source));
  await assert.rejects(decryptProviderBinding(envelope, master, source));
  assert.deepEqual(await decodeWithTestKey(envelope, master, source), payload);
  await assert.rejects(decodeWithTestKey(envelope, new Uint8Array(32).fill(22), source));
  for (const change of [
    {nativeWoId: `0WO${'Z'.repeat(15)}`}, {agentCode: 'T02'},
    {storeNumber: '90124'}, {outletAcn: '000000000'},
    {suggestedRecipients: ['wrong@example.test', 'planner@example.test']},
  ]) {
    await assert.rejects(decodeWithTestKey(envelope, master, {...source, ...change}));
  }
  const tampered = {...envelope,
    ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`};
  await assert.rejects(decodeWithTestKey(tampered, master, source));
  const forgedUnsigned = await encryptProviderBinding({...payload,
    verifiedAtUtc: '2026-11-24T00:00:00Z'}, master);
  const forged = {...forgedUnsigned, keyId: envelope.keyId, signature: envelope.signature};
  assert.equal(await verifyBindingEnvelopeWithKey(forged, 'provider', WO_ID,
    signer.publicSpkiBase64Url, signer.keyId), false);
  await assert.rejects(decodeWithTestKey(forged, master, source));
  assert.equal(await verifyBindingEnvelopeWithKey({...envelope,
    keyId: 'f'.repeat(64)}, 'provider', WO_ID,
    signer.publicSpkiBase64Url, signer.keyId), false);
  await assert.rejects(encryptProviderBinding({...payload,
    plannerEmail: 'install@example.test'}, master));
});

test('iframe can select only an exact allowlisted ID from its own opaque origin', () => {
  const listeners = new Map();
  const hostWindow = {addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type)};
  const contentWindow = {};
  const selections = [];
  const bridge = createFrameSelectionBridge({hostWindow, frame: {contentWindow},
    actions: {createOrOpenProviderDraft() {}, createOrOpenCustomerDraft() {}},
    allowedProviderIds: [WO_ID], allowedCustomerKeys: [FORM_KEY],
    onSelection: value => selections.push(value)});
  const message = listeners.get('message');
  message({source: {}, origin: 'null', data: {channel: FRAME_SELECTION_CHANNEL,
    type: 'select', kind: 'provider', id: WO_ID}});
  assert.equal(bridge.getSelection(), null);
  message({source: contentWindow, origin: 'https://attacker.example', data: {channel: FRAME_SELECTION_CHANNEL,
    type: 'select', kind: 'provider', id: WO_ID}});
  assert.equal(bridge.getSelection(), null);
  message({source: contentWindow, origin: 'null', data: {channel: FRAME_SELECTION_CHANNEL,
    type: 'select', kind: 'provider', id: WO_ID}});
  assert.deepEqual(bridge.getSelection(), {kind: 'provider', id: WO_ID});
  message({source: contentWindow, origin: 'null', data: {channel: FRAME_SELECTION_CHANNEL,
    type: 'select', kind: 'provider', id: `0WO${'Z'.repeat(15)}`}});
  assert.equal(bridge.getSelection(), null);
  bridge.dispose();
  assert.equal(listeners.has('message'), false);
  assert.equal(selections.length, 2);
});

test('customer binding needs the publisher signature as well as Gantt key and FORM AAD', async () => {
  const key = new Uint8Array(32).fill(7);
  const payload = {schema: PILOT_BINDING_SCHEMA, formSourceKey: FORM_KEY,
    storeNumber: '90123', recipientEmail: 'customer@example.test', trackerUrl: TRACKER,
    releaseReceiptSha256: 'a'.repeat(64), trackerLastVerifiedAtUtc: '2026-11-20T17:54:52Z'};
  const unsigned = await encryptPilotBinding(payload, key);
  const signer = await inventedSigner();
  const envelope = await signInventedEnvelope(unsigned, 'customer', FORM_KEY, signer);
  const decodeWithTestKey = inventedDecoders(signer).customer;
  const testPkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8',
    signer.pair.privateKey));
  await assert.rejects(signBindingEnvelope(unsigned, 'customer', FORM_KEY, testPkcs8),
    /Binding signing failed/);
  testPkcs8.fill(0);
  const serialized = JSON.stringify(envelope);
  assert.deepEqual(Object.keys(unsigned).sort(), ['ciphertext', 'nonce', 'schema']);
  assert.equal(serialized.includes(TRACKER), false);
  assert.equal(serialized.includes('customer@example.test'), false);
  assert.equal(createHash('sha256').update(Buffer.from(BINDING_PUBLIC_SPKI_BASE64URL,
    'base64url')).digest('hex'), BINDING_SIGNING_KEY_ID);
  assert.equal(await verifySignedBindingEnvelope(envelope, 'customer', FORM_KEY), false);
  assert.equal(await verifyBindingEnvelopeWithKey(envelope, 'customer', FORM_KEY,
    signer.publicSpkiBase64Url, signer.keyId), true);
  await assert.rejects(decryptPilotBinding(unsigned, key, FORM_KEY));
  await assert.rejects(decryptPilotBinding(envelope, key, FORM_KEY));
  assert.deepEqual(await decodeWithTestKey(envelope, key, FORM_KEY), payload);
  await assert.rejects(decodeWithTestKey(envelope, new Uint8Array(32).fill(8), FORM_KEY));
  await assert.rejects(decodeWithTestKey(envelope, key, 'F:123:457'));
  const changed = {...envelope, ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`};
  await assert.rejects(decodeWithTestKey(changed, key, FORM_KEY));
  const forgedUnsigned = await encryptPilotBinding({...payload,
    recipientEmail: 'attacker@example.test',
    trackerLastVerifiedAtUtc: '2026-11-24T00:00:00Z'}, key);
  const forged = {...forgedUnsigned, keyId: envelope.keyId, signature: envelope.signature};
  assert.equal(await verifyBindingEnvelopeWithKey(forged, 'customer', FORM_KEY,
    signer.publicSpkiBase64Url, signer.keyId), false);
  await assert.rejects(decodeWithTestKey(forged, key, FORM_KEY));
  assert.equal(await verifyBindingEnvelopeWithKey(envelope, 'provider', WO_ID,
    signer.publicSpkiBase64Url, signer.keyId), false);
  assert.equal(await verifyBindingEnvelopeWithKey({...envelope,
    keyId: 'f'.repeat(64)}, 'customer', FORM_KEY,
    signer.publicSpkiBase64Url, signer.keyId), false);
});

test('local protected bundle resolves two work orders and two projects by exact selection', async () => {
  const key = new Uint8Array(32).fill(31);
  const providerOne = {schema: PROVIDER_BINDING_SCHEMA,
    nativeWoId: WO_ID, agentCode: 'T01', storeNumber: '90123', outletAcn: '000123456',
    installManagerEmail: 'install-one@example.test', plannerEmail: 'plan-one@example.test',
    contactKey: 'a'.repeat(64), sourceEvidenceDigest: 'b'.repeat(64),
    sourceRecordSha256: 'c'.repeat(64), sourceCheckedAtUtc: SOURCE_AT,
    verifiedAtUtc: SOURCE_AT};
  const providerTwo = {...providerOne, nativeWoId: WO_ID_B, agentCode: 'T02',
    storeNumber: '90124', outletAcn: '009999999',
    installManagerEmail: 'install-two@example.test', plannerEmail: 'plan-two@example.test'};
  const customerOne = {schema: PILOT_BINDING_SCHEMA, formSourceKey: FORM_KEY,
    storeNumber: '90123', recipientEmail: 'customer-one@example.test', trackerUrl: TRACKER,
    releaseReceiptSha256: 'd'.repeat(64), trackerLastVerifiedAtUtc: SOURCE_AT};
  const customerTwo = {...customerOne, formSourceKey: FORM_KEY_B, storeNumber: '90124',
    recipientEmail: 'customer-two@example.test', trackerUrl: TRACKER_B};
  const signer = await inventedSigner();
  const envelopes = await Promise.all([
    signInventedEnvelope(await encryptProviderBinding(providerOne, key),
      'provider', WO_ID, signer),
    signInventedEnvelope(await encryptProviderBinding(providerTwo, key),
      'provider', WO_ID_B, signer),
    signInventedEnvelope(await encryptPilotBinding(customerOne, key),
      'customer', FORM_KEY, signer),
    signInventedEnvelope(await encryptPilotBinding(customerTwo, key),
      'customer', FORM_KEY_B, signer),
  ]);
  const parseWithTestKey = createBindingBundleParser(signer.keyId);
  const decoders = inventedDecoders(signer);
  const decodeWithTestKey = createSelectedBindingDecoder(decoders.provider, decoders.customer);
  const entries = [
    {kind: 'provider', id: WO_ID, envelope: envelopes[0]},
    {kind: 'provider', id: WO_ID_B, envelope: envelopes[1]},
    {kind: 'customer', id: FORM_KEY, envelope: envelopes[2]},
    {kind: 'customer', id: FORM_KEY_B, envelope: envelopes[3]},
  ];
  const allowed = {providerIds: [WO_ID, WO_ID_B], customerKeys: [FORM_KEY, FORM_KEY_B]};
  const sources = {providerById: {
    [WO_ID]: {eligible: true, nativeWoId: WO_ID, agentCode: 'T01',
      storeNumber: '90123', outletAcn: '000123456',
      suggestedRecipients: ['install-one@example.test', 'plan-one@example.test']},
    [WO_ID_B]: {eligible: true, nativeWoId: WO_ID_B, agentCode: 'T02',
      storeNumber: '90124', outletAcn: '009999999',
      suggestedRecipients: ['install-two@example.test', 'plan-two@example.test']},
  }, customerByKey: {
    [FORM_KEY]: {eligible: true, formSourceKey: FORM_KEY, storeNumber: '90123'},
    [FORM_KEY_B]: {eligible: true, formSourceKey: FORM_KEY_B, storeNumber: '90124'},
  }};
  const text = JSON.stringify({schema: BINDING_BUNDLE_SCHEMA, entries});
  assert.equal(text.includes('customer-one@example.test'), false);
  assert.equal(text.includes(TRACKER), false);
  assert.throws(() => parseBindingBundle(text, allowed));
  const bundle = parseWithTestKey(text, allowed);
  assert.deepEqual(await decodeWithTestKey(bundle, key, sources,
    {kind: 'provider', id: WO_ID}), providerOne);
  assert.deepEqual(await decodeWithTestKey(bundle, key, sources,
    {kind: 'provider', id: WO_ID_B}), providerTwo);
  assert.deepEqual(await decodeWithTestKey(bundle, key, sources,
    {kind: 'customer', id: FORM_KEY}), customerOne);
  assert.deepEqual(await decodeWithTestKey(bundle, key, sources,
    {kind: 'customer', id: FORM_KEY_B}), customerTwo);
  // The browser's real parser/verifier never accepts a test key from a file.
  const pretendsToUseProductionKey = [
    {kind: 'provider', id: WO_ID,
      envelope: {...envelopes[0], keyId: BINDING_SIGNING_KEY_ID}},
    {kind: 'customer', id: FORM_KEY,
      envelope: {...envelopes[2], keyId: BINDING_SIGNING_KEY_ID}},
  ];
  const productionParsed = parseBindingBundle(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: pretendsToUseProductionKey}), allowed);
  await assert.rejects(decryptSelectedBinding(productionParsed, key, sources,
    {kind: 'provider', id: WO_ID}));
  await assert.rejects(decryptSelectedBinding(productionParsed, key, sources,
    {kind: 'customer', id: FORM_KEY}));
  assert.throws(() => parseBindingBundle(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [{kind: 'provider', id: WO_ID,
      envelope: {...envelopes[0], keyId: BINDING_SIGNING_KEY_ID,
        publicKey: signer.publicSpkiBase64Url}}]}), allowed));
  assert.equal(await decodeWithTestKey(bundle, key, sources,
    {kind: 'customer', id: 'F:123:458'}), null);
  assert.equal(await decodeWithTestKey(bundle, key, {...sources,
    customerByKey: {...sources.customerByKey,
      [FORM_KEY_B]: {...sources.customerByKey[FORM_KEY_B], eligible: false}}},
  {kind: 'customer', id: FORM_KEY_B}), null);
  assert.throws(() => parseWithTestKey(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [entries[0], entries[0]]}), allowed), /Duplicate/);
  assert.throws(() => parseWithTestKey(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [{...entries[0], id: `0WO${'Z'.repeat(15)}` }]}), allowed));
  assert.throws(() => parseWithTestKey(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [{...entries[0], envelope: {...envelopes[0], keyId: 'f'.repeat(64)}}]}), allowed));
  assert.throws(() => parseWithTestKey(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [{...entries[0], envelope: {...envelopes[0], signature: undefined}}]}), allowed));
  const swapped = parseWithTestKey(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [{kind: 'provider', id: WO_ID_B, envelope: envelopes[0]},
      {kind: 'customer', id: FORM_KEY_B, envelope: envelopes[2]}]}), allowed);
  await assert.rejects(decodeWithTestKey(swapped, key, sources,
    {kind: 'provider', id: WO_ID_B}));
  await assert.rejects(decodeWithTestKey(swapped, key, sources,
    {kind: 'customer', id: FORM_KEY_B}));
  // A chart-link holder can encrypt fresh-looking substitutions, but cannot
  // give their ciphertext the publisher's signature.
  const forgedProvider = await encryptProviderBinding({...providerOne,
    installManagerEmail: 'attacker@example.test'}, key);
  const forgedCustomer = await encryptPilotBinding({...customerOne,
    recipientEmail: 'attacker@example.test',
    trackerLastVerifiedAtUtc: '2026-11-24T00:00:00Z'}, key);
  const forgedBundle = parseWithTestKey(JSON.stringify({schema: BINDING_BUNDLE_SCHEMA,
    entries: [
      {kind: 'provider', id: WO_ID, envelope: {...forgedProvider,
        keyId: envelopes[0].keyId, signature: envelopes[0].signature}},
      {kind: 'customer', id: FORM_KEY, envelope: {...forgedCustomer,
        keyId: envelopes[2].keyId, signature: envelopes[2].signature}},
    ]}), allowed);
  await assert.rejects(decodeWithTestKey(forgedBundle, key, sources,
    {kind: 'provider', id: WO_ID}));
  await assert.rejects(decodeWithTestKey(forgedBundle, key, sources,
    {kind: 'customer', id: FORM_KEY}));
  await assert.rejects(decodeWithTestKey(bundle, key, {...sources,
    providerById: {...sources.providerById,
      [WO_ID_B]: {...sources.providerById[WO_ID_B], agentCode: 'Z99'}}},
  {kind: 'provider', id: WO_ID_B}));
  assert.equal(await decodeWithTestKey(bundle, key, {...sources,
    providerById: {...sources.providerById,
      [WO_ID_B]: {...sources.providerById[WO_ID_B], nativeWoId: WO_ID}}},
  {kind: 'provider', id: WO_ID_B}), null);
});

test('customer tracker validators require the complete private project link', () => {
  assert.equal(validateIntentCustomerTrackerUrl(TRACKER), TRACKER);
  assert.equal(validateCustomerTrackerUrl(TRACKER), TRACKER);
  for (const invalid of [
    'https://rbcochell-ui.github.io/arbys-customer-status-preview/',
    TRACKER.replace('status-preview/?', 'status-preview/track.html?'),
    TRACKER.replace('#k=', '&k='),
    'https://example.test/track.html?p=x#k=y',
  ]) {
    assert.throws(() => validateIntentCustomerTrackerUrl(invalid));
    assert.throws(() => validateCustomerTrackerUrl(invalid));
  }
});

test('pilot binding requires the tracker’s verified source time, not a read clock', () => {
  const oldReadClock = {schema: PILOT_BINDING_SCHEMA, formSourceKey: FORM_KEY,
    storeNumber: '90123', recipientEmail: 'customer@example.test', trackerUrl: TRACKER,
    releaseReceiptSha256: 'a'.repeat(64), sourceReadAtUtc: SOURCE_AT};
  assert.throws(() => validatePilotBindingPayload(oldReadClock, FORM_KEY),
    /Invalid pilot binding/);
});

test('pilot bindings are held outside the public repository', () => {
  assert.equal(existsSync(new URL('../data/customer-pilot.enc.json', import.meta.url)), false);
  assert.equal(existsSync(new URL('../data/provider-pilot.enc.json', import.meta.url)), false);
  assert.deepEqual(readdirSync(new URL('../data/', import.meta.url)), ['gantt.enc.json']);
});

test('known existing drafts hold both pilot compose buttons', () => {
  assert.equal(COMPOSE_RELEASE.provider, 'held_existing_draft');
  assert.equal(COMPOSE_RELEASE.customer, 'held_existing_draft');
});

test('local helper handoff carries only one canonical selected ID', () => {
  const provider = buildLocalHelperUri({kind: 'provider', id: WO_ID});
  const customer = buildLocalHelperUri({kind: 'customer', id: FORM_KEY});
  assert.equal(provider, `arbysgantt://draft/v1?kind=provider&id=${WO_ID}`);
  assert.equal(customer, 'arbysgantt://draft/v1?kind=customer&id=F%3A123%3A456');
  assert.deepEqual(parseLocalHelperUri(provider), {kind: 'provider', id: WO_ID});
  assert.deepEqual(parseLocalHelperUri(customer), {kind: 'customer', id: FORM_KEY});
  for (const uri of [provider, customer]) {
    assert.equal(uri.includes('@'), false);
    assert.equal(uri.includes('https:'), false);
    assert.equal(uri.includes('#'), false);
  }
  assert.throws(() => buildLocalHelperUri({kind: 'customer', id: FORM_KEY,
    recipientEmail: 'private@example.test'}));
  assert.throws(() => buildLocalHelperUri({kind: 'provider', id: WO_ID,
    trackerUrl: 'https://example.test/private'}));
  assert.throws(() => buildLocalHelperUri({kind: 'provider', id: `${WO_ID}&to=private@example.test`}));
  assert.throws(() => buildLocalHelperUri({kind: 'provider', id: {toString: () => WO_ID}}));
  assert.throws(() => buildLocalHelperUri({kind: 'customer', id: 'F:123:456\r\nBcc:evil@example.test'}));
  for (const invalid of [
    `${provider}#secret`, `${provider}&to=private%40example.test`,
    `${provider}&id=${WO_ID}`, provider.replace('draft', 'draft.evil.test'),
    provider.replace('arbysgantt:', 'https:'),
    customer.replace('F%3A123%3A456', 'F:123:456'),
    customer.replace('kind=customer&id=', 'id=') + '&kind=customer',
  ]) assert.throws(() => parseLocalHelperUri(invalid));
});

test('provider remains held until an exact release; customer ID handoff is bounded', () => {
  const allowed = {providerIds: [WO_ID], customerKeys: [FORM_KEY]};
  const noDirectSource = parseComposeSources(syntheticHtml({
    overlayIdentity: {...DIRECT_IDENTITY, outletAcn: '009999999'},
  }), allowed);
  assert.equal(noDirectSource.providerById[WO_ID], undefined);

  // A provider ID remains held even with a broad release flag because this
  // source has no exact provider ID released. The installed helper still
  // verifies actor, admission, Claim, and current source before any write.
  const selection = {kind: 'provider', id: WO_ID};
  assert.equal(localHandoffEnabled('provider', selection, allowed, 'enabled',
    'draft', PROVIDER_DIGEST), false);
  const launches = [];
  assert.equal(requestLocalHandoff({event: {type: 'click', isTrusted: true},
    kind: 'provider', release: 'enabled', disabled: false,
    selection, selectionDigest: PROVIDER_DIGEST, allowed, topLevel: true,
    navigate: uri => launches.push(uri)}), 'ignored');
  assert.deepEqual(launches, []);
  const customerLaunches = [];
  assert.equal(localHandoffEnabled('customer',
    {kind: 'customer', id: FORM_KEY}, allowed, 'enabled',
    'draft', CUSTOMER_DIGEST), true);
  assert.equal(requestLocalHandoff({event: {type: 'click', isTrusted: true},
    kind: 'customer', release: 'enabled', disabled: false,
    selection: {kind: 'customer', id: FORM_KEY},
    selectionDigest: CUSTOMER_DIGEST, allowed, topLevel: true,
    navigate: uri => customerLaunches.push(uri)}), 'requested');
  assert.deepEqual(customerLaunches,
    ['arbysgantt://draft/v1?kind=customer&id=F%3A123%3A456']);
});

test('handoff rejects untrusted, framed, held, wrong-kind and unlisted selections', () => {
  const allowed = {providerIds: [WO_ID], customerKeys: [FORM_KEY]};
  const base = {event: {type: 'click', isTrusted: true}, kind: 'customer',
    release: 'enabled', disabled: false,
    selection: {kind: 'customer', id: FORM_KEY},
    selectionDigest: CUSTOMER_DIGEST, allowed, topLevel: true};
  let launches = 0;
  const navigate = () => { launches++; };
  for (const variant of [
    {event: {type: 'click', isTrusted: false}},
    {event: {type: 'change', isTrusted: true}},
    {release: 'held_existing_draft'}, {disabled: true},
    {selection: {kind: 'provider', id: WO_ID}},
  ]) assert.equal(requestLocalHandoff({...base, ...variant, navigate}), 'ignored');
  assert.equal(requestLocalHandoff({...base, topLevel: false, navigate}), 'framed');
  assert.throws(() => requestLocalHandoff({...base,
    selection: {kind: 'customer', id: FORM_KEY_B}, navigate}), /allowlisted/);
  assert.equal(localHandoffEnabled('provider',
    {kind: 'provider', id: WO_ID_B}, allowed, 'enabled'), false);
  assert.equal(localHandoffEnabled('customer',
    base.selection, allowed, 'held_existing_draft'), false);
  assert.equal(launches, 0);
  assert.throws(() => buildAllowlistedHandoffUri({kind: 'customer', id: FORM_KEY_B}, allowed));
});

test('local binding builders refuse public-repository output paths', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.throws(() => readPrivateSigningKey(
    fileURLToPath(new URL('../README.md', import.meta.url)), root),
    /outside the public repository/);
  for (const script of ['build_provider_binding.mjs', 'build_pilot_binding.mjs',
    'build_binding_bundle.mjs']) {
    const args = script === 'build_pilot_binding.mjs'
      ? ['missing-link.txt', 'missing-source.json', 'missing-current.json',
        'missing-signing-key.pk8', 'data/pilot.enc.json']
      : script === 'build_provider_binding.mjs'
      ? ['missing-link.txt', 'missing-source.json', 'missing-signing-key.pk8',
        'data/pilot.enc.json']
      : ['missing-link.txt', 'missing-source.json', 'data/pilot.enc.json'];
    const result = spawnSync(process.execPath,
      [`scripts/${script}`, ...args],
      {cwd: root, encoding: 'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the public repository/);
  }
});

test('viewer holds buttons and leaves recipient and link verification for Outlook', () => {
  assert.equal(existsSync(new URL('../actions/local_compose.mjs', import.meta.url)), false);
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /Before sending in Outlook, verify the recipient, current Thirsty or FORM date and scope, and every link/);
  assert.match(page, /Acting coordinator: not verified on this page/);
  assert.match(page, /Check Sent can identify a candidate/);
  assert.doesNotMatch(page, /id="bindingBundle"|id="reviewGate"/);
  const runtime = readFileSync(new URL('../view.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /window\.open\(compose\.url|buildOutlookComposeUrl/);
  assert.doesNotMatch(runtime, /bindingBundle|parseBindingBundle|decryptSelectedBinding/);
  assert.match(runtime, /requestLocalHandoff\(/);
  assert.match(runtime, /window\.location\.assign\(uri\)/);
});
