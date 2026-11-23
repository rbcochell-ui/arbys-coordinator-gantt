/** Source-only Entra SPA contract. No tenant/client IDs or account IDs ship. */
export const GANTT_ORIGIN = 'https://rbcochell-ui.github.io';
export const GANTT_APP_URL = `${GANTT_ORIGIN}/arbys-coordinator-gantt/`;
export const REDIRECT_URI = `${GANTT_APP_URL}auth/redirect.html`;
export const GRAPH_SCOPE_SETS = Object.freeze({
  identity: Object.freeze(['User.Read']),
  lists: Object.freeze(['Lists.SelectedOperations.Selected']),
  mail: Object.freeze(['Mail.ReadWrite']),
});
export const LOGIN_SCOPES = Object.freeze([
  'User.Read', 'Lists.SelectedOperations.Selected', 'Mail.ReadWrite',
]);
export const HELD_AUTH_CONFIG = Object.freeze({
  enabled: false,
  tenantId: null,
  clientId: null,
  coordinatorOids: Object.freeze([]),
  redirectUri: REDIRECT_URI,
});

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthHeldError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AuthHeldError';
    this.code = code;
  }
}

export function validateAuthConfig(config) {
  if (config?.enabled !== true || !GUID.test(config.tenantId ?? '') ||
      !GUID.test(config.clientId ?? '') || config.redirectUri !== REDIRECT_URI ||
      !Array.isArray(config.coordinatorOids) ||
      ![1, 2, 3].includes(config.coordinatorOids.length) ||
      config.coordinatorOids.some(id => !GUID.test(id)) ||
      new Set(config.coordinatorOids.map(id => id.toLowerCase())).size !==
        config.coordinatorOids.length) {
    throw new AuthHeldError('AUTH_CONFIG_HELD');
  }
  return Object.freeze({
    tenantId: config.tenantId.toLowerCase(),
    clientId: config.clientId.toLowerCase(),
    redirectUri: REDIRECT_URI,
    coordinatorOids: Object.freeze(config.coordinatorOids.map(id => id.toLowerCase())),
  });
}

export function msalConfiguration(config) {
  const checked = validateAuthConfig(config);
  return Object.freeze({
    auth: Object.freeze({
      clientId: checked.clientId,
      authority: `https://login.microsoftonline.com/${checked.tenantId}`,
      redirectUri: REDIRECT_URI,
    }),
    // Popup + redirect bridge works without a durable token cache. A page
    // refresh requires an explicit Sign in click again.
    cache: Object.freeze({cacheLocation: 'memoryStorage'}),
  });
}
