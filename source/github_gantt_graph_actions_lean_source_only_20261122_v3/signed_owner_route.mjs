import {inspectLegacyPilots} from './legacy_team_inventory_fence.mjs';
import {LegacyReopenAdapter} from './legacy_reopen.mjs';

/**
 * Source-only composition with the authenticated signed inventory fence.
 * The fence itself accepts only a loader made by createReleaseInventoryLoader.
 * The adjacent verifier accepts only its authenticated release loader.
 */
export function createSignedOwnerRoute({loadLegacyFenceProof, ...ports}) {
  if (typeof loadLegacyFenceProof !== 'function') {
    throw new TypeError('Authenticated signed inventory loader required');
  }
  return new LegacyReopenAdapter({...ports,
    inspectLegacyInventory: (key, graph, siteId, expectedProofDigest) =>
      inspectLegacyPilots(key, graph, siteId, loadLegacyFenceProof,
        expectedProofDigest),
  });
}
