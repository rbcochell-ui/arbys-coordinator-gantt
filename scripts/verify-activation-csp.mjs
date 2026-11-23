import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// The held page deliberately allows no Microsoft network requests. This check
// is for a separately approved, enabled build; it never changes the page.
const REQUIRED = Object.freeze({
  'default-src': Object.freeze(["'none'"]),
  'connect-src': Object.freeze([
    "'self'",
    'https://login.microsoftonline.com',
    'https://graph.microsoft.com',
  ]),
  'frame-src': Object.freeze([
    "'self'",
    'about:',
    'https://login.microsoftonline.com',
  ]),
  'object-src': Object.freeze(["'none'"]),
  'base-uri': Object.freeze(["'none'"]),
  'form-action': Object.freeze(["'none'"]),
  'img-src': Object.freeze(["'none'"]),
  'font-src': Object.freeze(["'none'"]),
  'worker-src': Object.freeze(["'none'"]),
  'style-src': Object.freeze(["'unsafe-inline'"]),
});

export class ActivationCspError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ActivationCspError';
    this.code = code;
  }
}

function fail(code) {
  throw new ActivationCspError(code);
}

function readMetaPolicy(html) {
  if (typeof html !== 'string') fail('HTML_REQUIRED');
  const matches = [...html.matchAll(/<meta(?=\s|\/?>)[^>]*>/giu)]
    .map(match => match[0])
    .filter(tag => /\shttp-equiv\s*=\s*(["'])Content-Security-Policy\1/iu
      .test(tag));
  if (matches.length !== 1) fail('CSP_META_COUNT');
  const httpEquivCount = [...matches[0].matchAll(/\shttp-equiv\s*=/giu)].length;
  const contentCount = [...matches[0].matchAll(/\scontent\s*=/giu)].length;
  if (contentCount === 0) fail('CSP_CONTENT_MISSING');
  if (httpEquivCount !== 1 || contentCount !== 1) {
    fail('CSP_ATTRIBUTE_DUPLICATE');
  }
  const content = /\scontent\s*=\s*(["'])(.*?)\1/isu.exec(matches[0]);
  if (!content?.[2]) fail('CSP_CONTENT_MISSING');
  return content[2];
}

function parseDirectives(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...tokens] = trimmed.split(/\s+/u);
    const key = name.toLowerCase();
    if (directives.has(key)) fail('CSP_DIRECTIVE_DUPLICATE');
    directives.set(key, tokens);
  }
  return directives;
}

function requireExactTokens(directives, directive, required) {
  const actual = directives.get(directive);
  if (!actual || actual.length !== required.length ||
      new Set(actual).size !== actual.length ||
      !required.every(token => actual.includes(token))) {
    fail('CSP_' + directive.toUpperCase().replaceAll('-', '_') + '_NOT_EXACT');
  }
}

/**
 * Validate the built parent page before enabling delegated Graph actions.
 * Passing this check does not establish Entra consent, SharePoint grants, or
 * successful authentication in the company tenant.
 */
export function verifyActivationCsp(html) {
  const directives = parseDirectives(readMetaPolicy(html));
  for (const [name, tokens] of Object.entries(REQUIRED)) {
    requireExactTokens(directives, name, tokens);
  }
  const scripts = directives.get('script-src');
  if (!scripts?.includes("'self'") ||
      new Set(scripts).size !== scripts.length ||
      !scripts.every(token => token === "'self'" ||
        /^'sha256-[A-Za-z0-9+/=]+'$/u.test(token))) {
    fail('CSP_SCRIPT_SRC_NOT_PINNED');
  }
  return true;
}

if (process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/verify-activation-csp.mjs <built-index.html>');
    process.exitCode = 2;
  } else {
    try {
      verifyActivationCsp(readFileSync(resolve(process.argv[2]), 'utf8'));
      console.log('Activated CSP check passed for exact Graph and Entra origins.');
    } catch (error) {
      console.error('Activated CSP check held: ' +
        String(error?.code ?? error?.message ?? error));
      process.exitCode = 1;
    }
  }
}
