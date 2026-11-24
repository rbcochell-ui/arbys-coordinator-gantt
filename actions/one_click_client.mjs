// Held client adapter for a future public Gantt. It uses only fixed release
// pins and never navigates or sends. No live page currently imports it.
import {parseSelectionConfig} from
  '../selection_config.mjs';
import {parseBindingBundle} from
  './binding_bundle.mjs';
import {preparePinnedProviderCompose, prepareSignedCustomerCompose,
  ComposeHeldError} from
  './compose_candidate.mjs';
import {PROVIDER_COMMITMENTS} from './provider_pins.mjs';
import {MAX_OUTER_BYTES, unsealOuterBundle} from './outer_bundle.mjs';
import {OUTER_RELEASE} from './outer_release.mjs';
import {F32_PROVIDER_SOURCE_RELEASE} from './provider_source_release.mjs';
import {MAX_PROVIDER_ASSET_BYTES, unsealProviderSource} from
  './provider_source_codec.mjs';
import {assertSelectedProviderChartIdentity} from
  './provider_chart_selection.mjs';
import {digestSelection} from './action_release.mjs';

export const OUTER_ASSET_URL =
  'https://rbcochell-ui.github.io/arbys-coordinator-gantt/data/customer-bindings.outer.json';
export const PROVIDER_ASSET_URL =
  'https://rbcochell-ui.github.io/arbys-coordinator-gantt/data/provider-f32.enc.json';
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/u;
const STORE = /^[0-9]{1,7}$/u;
const OUTER_DEADLINE_MS = 15_000;
const SNAPSHOT_RE =
  /<script type="application\/json" id="snapshotData">([^<]+)<\/script>/gu;

async function readBoundedAsset(response, signal, maxBytes) {
  const header = response?.headers?.get?.('content-length');
  if (header !== null && header !== undefined &&
      (!/^[0-9]+$/u.test(header) || Number(header) > maxBytes)) {
    throw new Error('Compose asset too large');
  }
  if (!response?.body || typeof response.body.getReader !== 'function') {
    throw new Error('Streaming compose asset unavailable');
  }
  const reader = response.body.getReader();
  const cancelReader = () => {
    try { void reader.cancel().catch(() => {}); } catch { /* held */ }
  };
  signal.addEventListener('abort', cancelReader, {once: true});
  if (signal.aborted) {
    cancelReader();
    try { reader.releaseLock(); } catch { /* a timed-out read may be pending */ }
    throw new Error('Compose asset timed out');
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid compose bytes');
      total += value.length;
      if (total > maxBytes) throw new Error('Compose asset too large');
      chunks.push(value);
    }
  } catch (error) {
    cancelReader();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    try { reader.releaseLock(); } catch { /* a timed-out read may be pending */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

async function fetchBoundedAsset(fetcher, url, maxBytes) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Compose asset timed out'));
    }, OUTER_DEADLINE_MS);
  });
  try {
    const response = await Promise.race([fetcher(url, {
      cache: 'no-store', credentials: 'omit', redirect: 'error',
      signal: controller.signal,
    }), deadline]);
    if (!response?.ok) throw new Error('Compose asset unavailable');
    return await Promise.race([readBoundedAsset(response,
      controller.signal, maxBytes), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function selectedChartStore(html, allowed, selectedFormKey) {
  if (typeof html !== 'string' || html.length > 800_000 ||
      !allowed.customerKeys.includes(selectedFormKey)) {
    throw new ComposeHeldError('FORM_SELECTION_INVALID');
  }
  const matches = [...html.matchAll(SNAPSHOT_RE)];
  if (matches.length !== 1 || matches[0][1].length > 700_000) {
    throw new ComposeHeldError('FORM_SELECTION_INVALID');
  }
  let snapshot;
  try { snapshot = JSON.parse(matches[0][1]); }
  catch { throw new ComposeHeldError('FORM_SELECTION_INVALID'); }
  if (snapshot?.schema !== 'arbys-local-exact-form-project-preview/v16' ||
      !Array.isArray(snapshot.projects) || snapshot.projects.length > 50) {
    throw new ComposeHeldError('FORM_SELECTION_INVALID');
  }
  const matchesProject = snapshot.projects.filter(project =>
    project?.caseKey === selectedFormKey);
  if (matchesProject.length !== 1) {
    throw new ComposeHeldError('FORM_SELECTION_INVALID');
  }
  const raw = matchesProject[0].formStore;
  if (typeof raw === 'string' && STORE.test(raw)) return raw;
  if (raw === null || raw === '' ||
      (typeof raw === 'string' && raw.trim().toLowerCase() === 'unknown')) {
    return null;
  }
  throw new ComposeHeldError('FORM_STORE_MALFORMED');
}

/** One click can prepare a fresh editable URI after a separately reviewed
 * release. Current fixed release state is HELD and fails before fetching.
 * The caller must never cache a prepared URI or treat it as a Sent receipt.
 */
export async function prepareOneClickCustomerTemplate(selectedFormKey,
    decryptedChartHtml, chartKeyBytes, fetcher = globalThis.fetch) {
  if (OUTER_RELEASE.state !== 'RELEASED') {
    throw new ComposeHeldError('ONE_CLICK_RELEASE_HELD');
  }
  if (typeof selectedFormKey !== 'string' || !FORM_KEY.test(selectedFormKey) ||
      typeof fetcher !== 'function') {
    throw new ComposeHeldError('FORM_SELECTION_INVALID');
  }
  const allowed = parseSelectionConfig(decryptedChartHtml);
  const chartStore = selectedChartStore(decryptedChartHtml, allowed,
    selectedFormKey);
  let outerText;
  try {
    outerText = await fetchBoundedAsset(fetcher, OUTER_ASSET_URL,
      MAX_OUTER_BYTES);
  } catch {
    throw new ComposeHeldError('ONE_CLICK_BUNDLE_UNAVAILABLE');
  }
  let innerText;
  try {
    innerText = await unsealOuterBundle(outerText, chartKeyBytes, OUTER_RELEASE);
  } catch {
    throw new ComposeHeldError('ONE_CLICK_BUNDLE_UNAVAILABLE');
  }
  const bundle = parseBindingBundle(innerText, allowed);
  return prepareSignedCustomerCompose(bundle, chartKeyBytes, selectedFormKey,
    chartStore);
}

/** F32 uses one exact encrypted WO/contact source and one opaque selection
 * pin. The chart must agree with it, and a fixed release must explicitly
 * pass source-owner review before any Outlook URI is prepared.
 */
export async function prepareOneClickProviderTemplate(selectedNativeWoId,
    decryptedChartHtml, chartKeyBytes, fetcher = globalThis.fetch) {
  if (F32_PROVIDER_SOURCE_RELEASE.state !== 'RELEASED' ||
      F32_PROVIDER_SOURCE_RELEASE.sourceOwnerReviewed !== true) {
    throw new ComposeHeldError('PROVIDER_SOURCE_HELD');
  }
  if (typeof fetcher !== 'function') {
    throw new ComposeHeldError('PROVIDER_SOURCE_INVALID');
  }
  const allowed = parseSelectionConfig(decryptedChartHtml);
  if (!allowed.providerIds.includes(selectedNativeWoId)) {
    throw new ComposeHeldError('WO_SELECTION_INVALID');
  }
  let digest;
  try {
    digest = await digestSelection({kind: 'provider',
      id: selectedNativeWoId}, chartKeyBytes);
  } catch {
    throw new ComposeHeldError('WO_SELECTION_INVALID');
  }
  if (digest !== F32_PROVIDER_SOURCE_RELEASE.selectionDigestSha256 ||
      PROVIDER_COMMITMENTS[digest] !==
        F32_PROVIDER_SOURCE_RELEASE.providerCommitmentSha256) {
    throw new ComposeHeldError('PROVIDER_PIN_UNRELEASED');
  }
  let asset;
  try {
    asset = await fetchBoundedAsset(fetcher, PROVIDER_ASSET_URL,
      MAX_PROVIDER_ASSET_BYTES);
  } catch {
    throw new ComposeHeldError('PROVIDER_SOURCE_UNAVAILABLE');
  }
  let source;
  try {
    source = await unsealProviderSource(asset, chartKeyBytes,
      F32_PROVIDER_SOURCE_RELEASE, selectedNativeWoId);
    assertSelectedProviderChartIdentity(decryptedChartHtml, allowed,
      selectedNativeWoId, source);
  } catch {
    throw new ComposeHeldError('WO_SOURCE_MISMATCH');
  }
  return preparePinnedProviderCompose(selectedNativeWoId, source, digest);
}

/** No runtime tab handoff is authorized by this source-only packet. */
export function openOutlookTemplateHeld(_template, _opener) {
  throw new ComposeHeldError('OUTLOOK_TEMPLATE_LAUNCH_HELD');
}

