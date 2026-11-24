const SELECTION_SCRIPT = /<script type="application\/json" id="actionRoutes">([^<]{1,4096})<\/script>/g;
const WORK_ORDER_ID = /^0WO[A-Za-z0-9]{15}$/;
const FORM_SOURCE_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;
const EXPECTED_KEYS = new Set([
  'schema', 'actionsEnabled',
  'providerAllowedNativeWorkOrderIds', 'customerAllowedFormSourceKeys',
]);

function validIds(values, pattern) {
  return Array.isArray(values) && values.length <= 50 &&
    values.every((value, index) => typeof value === 'string' &&
      pattern.test(value) && values.indexOf(value) === index);
}

/** A decrypted chart can identify a selection; it cannot authorize a draft. */
export function parseSelectionConfig(html) {
  if (typeof html !== 'string' || html.length > 800_000 ||
      /apps\.powerapps\.com|data-action-route/i.test(html)) {
    throw new Error('The chart does not match the held selection contract');
  }
  const matches = [...html.matchAll(SELECTION_SCRIPT)];
  if (matches.length !== 1) throw new Error('Missing or duplicated selection contract');
  const config = JSON.parse(matches[0][1]);
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).length !== EXPECTED_KEYS.size ||
      Object.keys(config).some((key) => !EXPECTED_KEYS.has(key)) ||
      config.schema !== 'ArbysGanttSelection/v1' ||
      config.actionsEnabled !== false ||
      !validIds(config.providerAllowedNativeWorkOrderIds, WORK_ORDER_ID) ||
      !validIds(config.customerAllowedFormSourceKeys, FORM_SOURCE_KEY)) {
    throw new Error('Invalid held selection contract');
  }
  return Object.freeze({
    providerIds: Object.freeze([...config.providerAllowedNativeWorkOrderIds]),
    customerKeys: Object.freeze([...config.customerAllowedFormSourceKeys]),
  });
}
