/**
 * Source-only corroboration for a selected, native Thirsty work order.
 * No network, List, Outlook, or send capability is present in this module.
 *
 * A Case's reviewed FORM source key anchors project membership. Location is a
 * separate corroboration and provider-contact join, never a substitute parent.
 */
export const LINKAGE_SCHEMA = 'ArbysExactLinkageGuard/v1';

const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/u;
const WO_ID = /^0WO[A-Za-z0-9]{15}$/u;
const CASE_ID = /^500[A-Za-z0-9]{15}$/u;
const AGENT = /^[A-Z][A-Z0-9]{0,9}$/u;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/u;
const UNKNOWN_STORE = /^(?:UNKNOWN|TBD|N\/A|[A-Z])$/iu;

export class LinkageGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LinkageGuardError';
    this.code = code;
  }
}

function fail(code) { throw new LinkageGuardError(code); }
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validSalesforceId(value, prefix, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let block = 0; block < 15; block += 5) {
    let bits = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (/[A-Z]/u.test(value[block + bit])) bits |= 1 << bit;
    }
    suffix += alphabet[bits];
  }
  return value.startsWith(prefix) && value.slice(15) === suffix;
}

function digits(value) {
  const raw = text(value);
  if (!raw || !/^[0-9]+$/u.test(raw)) return null;
  const normalized = raw.replace(/^0+(?=[0-9])/u, '');
  return normalized === '0' ? null : normalized;
}

function store(value) {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    fail('STORE_VALUE_INVALID');
  }
  const raw = text(value);
  if (!raw || UNKNOWN_STORE.test(raw)) return null;
  if (!/^[0-9]{1,10}$/u.test(raw)) fail('STORE_VALUE_INVALID');
  return digits(raw);
}

function addressPart(value) {
  return text(value).normalize('NFKC').toUpperCase()
    .replace(/[.,#]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** Complete street, optional unit, city, state, and ZIP5; no fuzzy matching. */
export function exactAddressKey(value) {
  if (!object(value)) return null;
  const street = addressPart(value.street);
  if (value.street2 !== undefined && value.line2 !== undefined &&
      addressPart(value.street2) !== addressPart(value.line2)) return null;
  const unit = addressPart(value.street2 ?? value.line2 ?? '');
  const city = addressPart(value.city);
  const state = addressPart(value.state);
  const zip = text(value.zip);
  const zipMatch = /^([0-9]{5})(?:-[0-9]{4})?$/u.exec(zip);
  if (!street || !city || !/^[A-Z]{2}$/u.test(state) || !zipMatch) return null;
  return JSON.stringify([street, unit, city, state, zipMatch[1]]);
}

function agentFromWorkOrder(wo) {
  // Actual saved exports use "CODE - Name"; some upstream sheets use "CODE_Name".
  const raw = text(wo.assignedSpName);
  const match = /^([A-Z][A-Z0-9]{0,9})(?:\s+-\s+|_)(\S.*)$/u.exec(raw);
  if (!match) return null;
  const code = text(wo.assignedSpAgentCode);
  if (code && code !== match[1]) return null;
  return match[1];
}

function validEmail(value) {
  return typeof value === 'string' && value === value.trim() &&
    value.length <= 254 && EMAIL.test(value);
}

function contactPair(row) {
  if (!validEmail(row?.installManagerEmail) || !validEmail(row?.plannerEmail)) {
    return null;
  }
  return [row.installManagerEmail.toLowerCase(), row.plannerEmail.toLowerCase()];
}

function held(selected, reasonCode, reviewFlags = []) {
  return Object.freeze({
    schema: LINKAGE_SCHEMA,
    state: 'held', reasonCode,
    nativeWorkOrderId: selected.wo.nativeWorkOrderId,
    nativeCaseId: selected.oneCase.nativeCaseId,
    formSourceKey: selected.project.formSourceKey,
    matchMethod: null, recipientSuggestion: null,
    reviewFlags: Object.freeze([...reviewFlags]),
    sendAllowed: false,
  });
}

function collect(projects) {
  if (!Array.isArray(projects) || projects.length > 1000) {
    fail('PROJECT_COHORT_INVALID');
  }
  const projectKeys = new Set();
  const caseIds = new Set();
  const workOrders = new Map();
  for (const project of projects) {
    if (!object(project) || !FORM_KEY.test(project.formSourceKey ?? '') ||
        projectKeys.has(project.formSourceKey) || !Array.isArray(project.cases)) {
      fail('PROJECT_COHORT_INVALID');
    }
    projectKeys.add(project.formSourceKey);
    for (const oneCase of project.cases) {
      if (!object(oneCase) ||
          !validSalesforceId(oneCase.nativeCaseId, '500', CASE_ID) ||
          caseIds.has(oneCase.nativeCaseId) ||
          oneCase.linkedFormSourceKey !== project.formSourceKey ||
          !Array.isArray(oneCase.workOrders)) {
        fail('FORM_CASE_ANCHOR_INVALID');
      }
      caseIds.add(oneCase.nativeCaseId);
      for (const wo of oneCase.workOrders) {
        if (!object(wo) ||
            !validSalesforceId(wo.nativeWorkOrderId, '0WO', WO_ID) ||
            wo.nativeCaseId !== oneCase.nativeCaseId ||
            workOrders.has(wo.nativeWorkOrderId)) {
          fail('NATIVE_WO_CASE_ANCHOR_INVALID');
        }
        workOrders.set(wo.nativeWorkOrderId, {project, oneCase, wo});
      }
    }
  }
  return workOrders;
}

function ambiguousFormAddress(projects, selected, acn, addressKey) {
  const keys = new Set();
  for (const project of projects) {
    if (exactAddressKey(project.formAddress) !== addressKey) continue;
    if (project.cases.some(oneCase => digits(oneCase.customerAcn) === acn)) {
      keys.add(project.formSourceKey);
    }
  }
  return keys.size !== 1 || !keys.has(selected.project.formSourceKey);
}

/**
 * Evaluate one selected 18-character WO ID. A candidate only suggests draft
 * recipients; current Thirsty phase and contact roles still need review.
 */
export function evaluateSelectedLinkage({projects, linkageRows, directoryRows,
    selectedNativeWorkOrderId} = {}) {
  if (!validSalesforceId(selectedNativeWorkOrderId, '0WO', WO_ID)) {
    fail('NATIVE_WO_ID_REQUIRED');
  }
  if (!Array.isArray(linkageRows) || !Array.isArray(directoryRows)) {
    fail('CONTACT_SOURCES_INVALID');
  }
  const workOrders = collect(projects);
  const selected = workOrders.get(selectedNativeWorkOrderId);
  if (!selected) fail('WO_NOT_CHARTED');
  const {project, oneCase, wo} = selected;

  // The native Case link anchors membership; neither store nor address can
  // silently relocate a WO to another FORM project.
  const caseAcn = digits(oneCase.customerAcn);
  const woAcn = digits(wo.outletAcn);
  if (!caseAcn || !woAcn) return held(selected, 'ACN_MISSING');
  if (caseAcn !== woAcn) return held(selected, 'ACN_CONFLICT');
  const agent = agentFromWorkOrder(wo);
  if (!agent || !AGENT.test(agent)) return held(selected, 'AGENT_UNVERIFIED');

  const formStore = store(project.formStoreNumber);
  const woStore = store(wo.storeNumber);
  // A missing native WO store is its own hold. It cannot silently enter the
  // customer-missing-store address path, even if the two addresses agree.
  if (!woStore) return held(selected, 'WO_STORE_MISSING');

  const formAddress = exactAddressKey(project.formAddress);
  const serviceAddress = exactAddressKey(wo.serviceAddress);
  const reviewFlags = formAddress && serviceAddress &&
    formAddress !== serviceAddress ? ['FORM_SERVICE_ADDRESS_DIFFERS'] : [];
  let matchMethod;
  let candidates;
  if (formStore) {
    if (formStore !== woStore) return held(selected, 'STORE_CONFLICT', reviewFlags);
    matchMethod = 'exact_store_acn_agent';
    candidates = linkageRows.filter(row => digits(row?.outletAcn) === woAcn &&
      text(row?.agentCode) === agent &&
      store(row?.storeNumber) === woStore);
  } else {
    if (!formAddress || !serviceAddress) {
      return held(selected, 'ADDRESS_INCOMPLETE');
    }
    if (formAddress !== serviceAddress) {
      return held(selected, 'ADDRESS_CONFLICT');
    }
    if (ambiguousFormAddress(projects, selected, woAcn, formAddress)) {
      return held(selected, 'AMBIGUOUS_FORM_ADDRESS');
    }
    matchMethod = 'exact_address_acn_agent';
    reviewFlags.push('FORM_STORE_UNKNOWN');
    candidates = linkageRows.filter(row =>
      digits(row?.outletAcn) === woAcn &&
      text(row?.agentCode) === agent &&
      exactAddressKey(row?.serviceAddress) === formAddress);
  }

  if (candidates.length !== 1) {
    const samePlaceDifferentAgent = linkageRows.some(row =>
      digits(row?.outletAcn) === woAcn &&
      (formStore ? store(row?.storeNumber) === woStore :
        exactAddressKey(row?.serviceAddress) === formAddress) &&
      text(row?.agentCode) !== agent);
    return held(selected, candidates.length > 1 ? 'AMBIGUOUS_CONTACT_JOIN' :
      samePlaceDifferentAgent ? 'CONTACT_AGENT_CONFLICT' :
        'CONTACT_MATCH_MISSING', reviewFlags);
  }
  const candidate = candidates[0];
  const candidateStore = store(candidate.storeNumber);
  if (candidateStore && candidateStore !== woStore) {
    return held(selected, 'CONTACT_STORE_CONFLICT', reviewFlags);
  }
  const pair = contactPair(candidate);
  if (!pair) return held(selected, 'CONTACT_FIELDS_MISSING', reviewFlags);

  const matchingDirectory = directoryRows.filter(row =>
    text(row?.agentCode) === agent);
  if (matchingDirectory.some(row => !contactPair(row))) {
    return held(selected, 'CONTACT_DIRECTORY_INVALID', reviewFlags);
  }
  const directoryPairs = new Set(matchingDirectory
    .map(row => JSON.stringify(contactPair(row))));
  if (directoryPairs.size !== 1 || !directoryPairs.has(JSON.stringify(pair))) {
    return held(selected, directoryPairs.size > 1 ?
      'CONTACT_DIRECTORY_AMBIGUOUS' : 'CONTACT_DIRECTORY_CONFLICT', reviewFlags);
  }

  return Object.freeze({
    schema: LINKAGE_SCHEMA,
    state: 'candidate', reasonCode: null,
    nativeWorkOrderId: wo.nativeWorkOrderId,
    nativeCaseId: oneCase.nativeCaseId,
    formSourceKey: project.formSourceKey,
    matchMethod,
    recipientSuggestion: Object.freeze([...new Set(pair)]),
    reviewFlags: Object.freeze([...reviewFlags]),
    sendAllowed: false,
  });
}
