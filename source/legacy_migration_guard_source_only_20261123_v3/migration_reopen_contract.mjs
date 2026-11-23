/**
 * Offline, opt-in admission gate for the V3 one-shot legacy migration.
 *
 * This module imports no migration implementation or pilot binding. A
 * separately reviewed offline runner supplies the V3 API; the Gantt runtime
 * never imports this module. The runner must use only the returned guarded
 * methods for the two historical pilots.
 */
import {verifiedLegacyAnchorTargets,
  verifiedLegacyOutlookLink} from
  '../github_gantt_graph_actions_lean_source_only_20261122_v3/legacy_reopen.mjs';

const object = value => value !== null &&
  typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => Array.isArray(left) &&
  Array.isArray(right) && left.length === right.length &&
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export function createGuardedLegacyMigration(api) {
  if (typeof api?.MigrationHold !== 'function' ||
      typeof api.prepareMigration !== 'function' ||
      typeof api.prepareRestrictedProof !== 'function' ||
      typeof api.importOneShot !== 'function') {
    throw new TypeError('Complete offline V3 migration API required');
  }
  const hold = code => { throw new api.MigrationHold(code); };

  function validateReopenableObservation(spec, observation,
      domParserClass) {
    if (!['provider-parts', 'customer-tracker'].includes(spec?.kind) ||
        !object(observation?.old?.directItem?.fields) ||
        !object(observation?.mail?.draft) ||
        !object(observation?.source) ||
        !Array.isArray(observation.source.requiredLinks) ||
        !Array.isArray(observation.mail.draft.anchorTargets)) {
      hold('REOPEN_ADMISSION_INCOMPLETE');
    }
    const old = observation.old.directItem.fields;
    const draft = observation.mail.draft;
    let savedLink, observedLink, actualTargets;
    try {
      savedLink = verifiedLegacyOutlookLink(old.DraftWebLink);
      observedLink = verifiedLegacyOutlookLink(draft.webLink);
      actualTargets = verifiedLegacyAnchorTargets(draft.bodyHtml,
        domParserClass);
    } catch { hold('REOPEN_ADMISSION_HTML_OR_LINK_UNVERIFIED'); }
    if (savedLink !== observedLink ||
        !same(actualTargets, draft.anchorTargets) ||
        !same(actualTargets, observation.source.requiredLinks)) {
      hold('REOPEN_ADMISSION_HTML_OR_LINK_UNVERIFIED');
    }
    if (spec.kind === 'customer-tracker') {
      let releaseTargets;
      try {
        releaseTargets = verifiedLegacyAnchorTargets(old.DraftBodyHtml,
          domParserClass);
      } catch { hold('REOPEN_ADMISSION_RELEASE_HTML_UNVERIFIED'); }
      if (releaseTargets.length !== 1 ||
          !same(releaseTargets, observation.source.requiredLinks)) {
        hold('REOPEN_ADMISSION_RELEASE_HTML_UNVERIFIED');
      }
    }
    return true;
  }

  function prepareReopenableMigration(spec, observation,
      {domParserClass, ...options} = {}) {
    validateReopenableObservation(spec, observation, domParserClass);
    return api.prepareMigration(spec, observation, options);
  }

  function prepareReopenableRestrictedProof(plan, observation,
      {domParserClass, ...options} = {}) {
    validateReopenableObservation(plan?.spec, observation, domParserClass);
    return api.prepareRestrictedProof(plan, observation, options);
  }

  async function importReopenableOneShot(plan, io,
      {domParserClass, clock} = {}) {
    if (!object(io) || typeof io.observe !== 'function' ||
        typeof io.loadRestrictedProof !== 'function' ||
        typeof io.postClaim !== 'function' ||
        typeof io.postDraftReceipt !== 'function') {
      hold('REOPEN_IMPORT_PORTS_INVALID');
    }
    const guarded = {
      observe: async spec => {
        const observation = await io.observe(spec);
        validateReopenableObservation(spec, observation, domParserClass);
        return observation;
      },
      loadRestrictedProof: (...args) => io.loadRestrictedProof(...args),
      postClaim: (...args) => io.postClaim(...args),
      postDraftReceipt: (...args) => io.postDraftReceipt(...args),
    };
    return api.importOneShot(plan, guarded, {clock});
  }

  return Object.freeze({validateReopenableObservation,
    prepareReopenableMigration, prepareReopenableRestrictedProof,
    importReopenableOneShot});
}
