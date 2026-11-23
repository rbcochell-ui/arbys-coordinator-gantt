import {HeldActionError} from './vendor/lean_v3/contract.mjs';

const REQUIRED_CONNECT = Object.freeze([
  'https://login.microsoftonline.com',
  'https://graph.microsoft.com',
]);

function fail() { throw new HeldActionError('CUSTOMER_CSP_BLOCKS_GRAPH_AUTH'); }

/**
 * The deployment passes the actual served page's CSP meta content. This is
 * a source gate, followed by a signed-in browser network canary at release.
 */
export function assertCustomerActiveCsp(content) {
  if (typeof content !== 'string' || content.length > 4096) fail();
  const directives = new Map();
  for (const chunk of content.split(';')) {
    const tokens = chunk.trim().split(/\s+/u).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    if (directives.has(name)) fail();
    directives.set(name, new Set(tokens));
  }
  const connect = directives.get('connect-src');
  const frame = directives.get('frame-src');
  if (!connect || !frame ||
      REQUIRED_CONNECT.some(origin => !connect.has(origin)) ||
      !frame.has('https://login.microsoftonline.com')) fail();
  return true;
}

/**
 * Inspect the current page, not a deployment-supplied string. A stricter
 * response header is still possible, so activation also requires a live
 * signed-in Graph/MSAL browser canary.
 */
export function assertCurrentCustomerCsp() {
  const meta = globalThis.document?.querySelector?.(
    'meta[http-equiv="Content-Security-Policy"]');
  const content = meta?.getAttribute?.('content');
  return assertCustomerActiveCsp(content);
}
