import {localHandoffEnabled, selectedHandoffHold} from './local_helper_uri.mjs';
import {COMPOSE_RELEASE} from './action_release.mjs';

/** A chart selection is context, never authorization for an Outlook action. */
export function actionUiState({action, selection, allowed, release,
    selectionDigest = null, releaseConfig = COMPOSE_RELEASE,
    embedded = false, attempted = false}) {
  if (action !== 'draft' && action !== 'sent') {
    throw new TypeError('Invalid action');
  }
  if (!selection) return Object.freeze({enabled: false, code: 'no_selection'});
  const hold = selectedHandoffHold(selection, selectionDigest, releaseConfig);
  if (hold !== null) return Object.freeze({enabled: false, code: hold});
  if (!localHandoffEnabled(selection.kind, selection, allowed,
      'enabled', action, selectionDigest, releaseConfig))
    return Object.freeze({enabled: false, code: 'unlisted'});
  if (release !== 'enabled') return Object.freeze({enabled: false, code: 'release_held'});
  if (embedded) return Object.freeze({enabled: false, code: 'embedded'});
  if (attempted) return Object.freeze({enabled: false, code: 'inspect_only'});
  return Object.freeze({enabled: true, code: action === 'sent'
    ? 'sent_candidate_only' : 'draft_request_only'});
}
