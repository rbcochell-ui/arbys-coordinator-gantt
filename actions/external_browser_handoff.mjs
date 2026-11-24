import {parseCapabilityHref} from '../crypto.mjs';

const PROVIDER_ID = /^0WO[A-Za-z0-9]{15}$/;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;

function routeAllowed(url) {
  const publicPage = url.origin === 'https://rbcochell-ui.github.io' &&
    ['/arbys-coordinator-gantt/', '/arbys-coordinator-gantt/index.html']
      .includes(url.pathname);
  const localPage = url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    ['/', '/index.html'].includes(url.pathname);
  return publicPage || localPage;
}

function exactSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'id,kind' ||
      typeof value.id !== 'string' ||
      !(value.kind === 'provider' ? PROVIDER_ID.test(value.id) :
        value.kind === 'customer' ? FORM_KEY.test(value.id) : false)) {
    throw new TypeError('Invalid chart selection');
  }
  return Object.freeze({kind: value.kind, id: value.id});
}

/** The fragment adds only an allowlist candidate to the existing private key. */
export function parseExternalBrowserHref(href) {
  let url;
  try { url = new URL(href); } catch { throw new TypeError('Invalid chart link'); }
  if (!routeAllowed(url) || url.search || url.username || url.password) {
    throw new TypeError('Invalid chart link');
  }
  const raw = url.hash.slice(1);
  const pairs = [...new URLSearchParams(raw).entries()];
  if ((pairs.length !== 1 && pairs.length !== 3) ||
      pairs[0]?.[0] !== 'k' ||
      (pairs.length === 3 &&
       (pairs[1][0] !== 'kind' || pairs[2][0] !== 'id')) ||
      new URLSearchParams(pairs).toString() !== raw) {
    throw new TypeError('Invalid chart link');
  }
  const base = new URL(url.href);
  base.hash = `k=${pairs[0][1]}`;
  let key;
  try { key = parseCapabilityHref(base.href); }
  catch { throw new TypeError('Invalid chart link'); }
  const selection = pairs.length === 3
    ? exactSelection({kind: pairs[1][1], id: pairs[2][1]}) : null;
  return Object.freeze({key, selection, capabilityHref: base.href});
}

/** A forged but syntactically valid ID cannot become a selected chart item. */
export function restoreAllowlistedSelection(selection, allowed) {
  if (selection == null) return null;
  let exact;
  try { exact = exactSelection(selection); } catch { return null; }
  const values = exact.kind === 'provider'
    ? allowed?.providerIds : allowed?.customerKeys;
  return Array.isArray(values) && values.includes(exact.id) ? exact : null;
}

/** Preserve the complete chart key and only a selected native ID. */
export function buildExternalBrowserHref(href, selection, allowed) {
  const parsed = parseExternalBrowserHref(href);
  const url = new URL(parsed.capabilityHref);
  if (selection == null) return url.href;
  const exact = exactSelection(selection);
  if (!restoreAllowlistedSelection(exact, allowed)) {
    throw new TypeError('Selection is not allowlisted by this chart');
  }
  const key = new URL(parsed.capabilityHref).hash.slice(3);
  url.hash = new URLSearchParams([
    ['k', key], ['kind', exact.kind], ['id', exact.id],
  ]).toString();
  return url.href;
}
