import {HELD_CONFIG} from
  './vendor/lean_v3/config.mjs';

// Deliberately unusable: no tenant, app, List, recipient or private URL.
export const HELD_CUSTOMER_BINDING = Object.freeze({
  enabled: false,
  lean: HELD_CONFIG,
  legacyInventory: null,
});
