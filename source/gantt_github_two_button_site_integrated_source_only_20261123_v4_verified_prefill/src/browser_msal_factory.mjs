import {PublicClientApplication} from '@azure/msal-browser';

/** The only browser-specific factory needed by compose_parent.mjs. */
export function createPublicClientApplication(config) {
  return new PublicClientApplication(config);
}
