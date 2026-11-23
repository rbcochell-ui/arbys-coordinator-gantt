import {webcrypto} from 'node:crypto';
import {createProviderSnapshotResolver} from
  '../../gantt_github_provider_snapshot_resolver_source_only_20261122_v1/provider_snapshot_resolver.mjs';

globalThis.crypto ??= webcrypto;

let input = '';
for await (const chunk of process.stdin) input += chunk;
const {html, sha256, ids, nowMs} = JSON.parse(input);
const resolver = await createProviderSnapshotResolver({
  html,
  approvedHtmlSha256: sha256,
});
const results = ids.map(id => {
  const result = resolver.resolve(id, nowMs);
  return {
    eligible: result.eligibility === 'preinstall_snapshot_candidate',
    exactPair: result.recipientSuggestion === 'exact_saved_file_pair',
    recipientCount: result.to.length,
  };
});
process.stdout.write(JSON.stringify(results));
