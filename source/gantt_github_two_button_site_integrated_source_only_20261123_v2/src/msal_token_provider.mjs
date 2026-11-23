import {AuthHeldError, GRAPH_SCOPE_SETS, LOGIN_SCOPES, REDIRECT_URI,
  msalConfiguration, validateAuthConfig} from './auth_config.mjs';

const EXPECTED_SCOPES = new Set(Object.values(GRAPH_SCOPE_SETS)
  .map(scopes => JSON.stringify(scopes)));
const INTERACTION_CODES = new Set([
  'interaction_required', 'login_required', 'consent_required',
  'no_tokens_found', 'user_login_error',
]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code) { throw new AuthHeldError(code); }

function accountIdentity(account, claims = null) {
  if (!account || typeof account !== 'object') fail('ACCOUNT_UNVERIFIED');
  const aClaims = account.idTokenClaims ?? {};
  const oid = String(aClaims.oid ?? claims?.oid ?? '').toLowerCase();
  const claimTenant = String(aClaims.tid ?? claims?.tid ?? account.tenantId ?? '').toLowerCase();
  const tenantId = String(account.tenantId ?? '').toLowerCase();
  const homeAccountId = String(account.homeAccountId ?? '');
  const localAccountId = String(account.localAccountId ?? '');
  if (!GUID.test(oid) || !GUID.test(tenantId) || tenantId !== claimTenant ||
      !homeAccountId || !localAccountId ||
      (aClaims.oid && String(aClaims.oid).toLowerCase() !== oid) ||
      (claims?.oid && String(claims.oid).toLowerCase() !== oid) ||
      (claims?.tid && String(claims.tid).toLowerCase() !== tenantId)) {
    fail('ACCOUNT_UNVERIFIED');
  }
  return Object.freeze({oid, tenantId, homeAccountId, localAccountId});
}

function sameIdentity(a, b) {
  return a.oid === b.oid && a.tenantId === b.tenantId &&
    a.homeAccountId === b.homeAccountId &&
    a.localAccountId === b.localAccountId;
}

function isInteractionRequired(error) {
  return INTERACTION_CODES.has(String(error?.errorCode ?? '').toLowerCase()) ||
    error?.name === 'InteractionRequiredAuthError';
}

function exactScopes(scopes) {
  if (!Array.isArray(scopes) || !EXPECTED_SCOPES.has(JSON.stringify(scopes))) {
    fail('AUTH_SCOPE_DENIED');
  }
  return [...scopes];
}

/**
 * Prepare MSAL before the user clicks Sign in. This avoids an await before
 * loginPopup, which would otherwise risk losing the browser's user gesture.
 */
export async function prepareMsalTokenProvider({authConfig,
    createPublicClientApplication} = {}) {
  const checked = validateAuthConfig(authConfig);
  if (typeof createPublicClientApplication !== 'function') {
    throw new TypeError('MSAL public-client factory required');
  }
  const pca = createPublicClientApplication(msalConfiguration(authConfig));
  if (!pca || ['initialize', 'loginPopup', 'acquireTokenPopup',
    'acquireTokenSilent', 'getAllAccounts'].some(name =>
    typeof pca[name] !== 'function')) {
    throw new TypeError('MSAL public client is incomplete');
  }
  await pca.initialize();

  let pin = null;
  let interactionBusy = false;
  let reauthRequired = false;

  function cachedPinnedAccount(expected = pin) {
    if (!expected) fail('SIGN_IN_REQUIRED');
    const matches = pca.getAllAccounts().filter(account => {
      try { return sameIdentity(accountIdentity(account), expected); }
      catch { return false; }
    });
    if (matches.length !== 1) fail('PINNED_ACCOUNT_MISSING');
    return matches[0];
  }

  function checkedResult(result, expected = null) {
    const identity = accountIdentity(result?.account, result?.idTokenClaims);
    if (identity.tenantId !== checked.tenantId ||
        !checked.coordinatorOids.includes(identity.oid) ||
        (expected && !sameIdentity(identity, expected))) {
      fail('COORDINATOR_ACCOUNT_DENIED');
    }
    return identity;
  }

  async function acquirePinnedToken(scopes, expected) {
    if (reauthRequired) fail('AUTH_REAUTH_REQUIRED');
    const requestScopes = exactScopes(scopes);
    const account = cachedPinnedAccount(expected);
    let result;
    try {
      result = await pca.acquireTokenSilent({
        account, scopes: requestScopes, redirectUri: REDIRECT_URI,
      });
    } catch (error) {
      if (isInteractionRequired(error)) {
        reauthRequired = true;
        fail('AUTH_REAUTH_REQUIRED');
      }
      fail('AUTH_TOKEN_UNAVAILABLE');
    }
    const identity = checkedResult(result, expected);
    const granted = new Set((result?.scopes ?? []).map(value =>
      String(value).toLowerCase()));
    if (!requestScopes.every(value => granted.has(value.toLowerCase())) ||
        typeof result?.accessToken !== 'string' ||
        result.accessToken.length < 12) {
      fail('AUTH_TOKEN_UNVERIFIED');
    }
    cachedPinnedAccount(identity);
    return Object.freeze({accessToken: result.accessToken});
  }

  const provider = Object.freeze({
    /** A Graph client must bind a verified account before any token read. */
    acquireToken() { fail('SIGN_IN_REQUIRED'); },
    /** Called synchronously by V2 GraphClient.bindAccount at action start. */
    pinAccount() {
      if (!pin) fail('SIGN_IN_REQUIRED');
      if (reauthRequired) fail('AUTH_REAUTH_REQUIRED');
      const captured = pin;
      cachedPinnedAccount(captured);
      return Object.freeze({
        acquireToken: scopes => acquirePinnedToken(scopes, captured),
      });
    },
  });

  return Object.freeze({
    tokenProvider: provider,
    /** Call only from the parent Sign in button's trusted click handler. */
    async signInFromClick() {
      if (interactionBusy) fail('AUTH_INTERACTION_BUSY');
      interactionBusy = true;
      try {
        if (pin && !reauthRequired) {
          cachedPinnedAccount();
          return pin;
        }
        // No await occurs before the popup call. The redirect bridge is the
        // sole script on the registered redirect page.
        const request = {scopes: [...LOGIN_SCOPES], redirectUri: REDIRECT_URI};
        const pending = pin
          ? pca.acquireTokenPopup({...request, account: cachedPinnedAccount()})
          : pca.loginPopup({...request, prompt: 'select_account'});
        const result = await pending;
        const identity = checkedResult(result, pin);
        cachedPinnedAccount(identity);
        pin = identity;
        reauthRequired = false;
        return pin;
      } catch (error) {
        if (error instanceof AuthHeldError) throw error;
        fail('AUTH_INTERACTIVE_FAILED');
      } finally {
        interactionBusy = false;
      }
    },
    /** Non-sensitive identity metadata only; no token is returned here. */
    getPinnedIdentity() { return pin; },
  });
}
