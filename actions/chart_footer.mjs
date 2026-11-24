// Display-only correction for the one reviewed encrypted chart. The original
// decrypted bytes remain the action source and must match the chart envelope.
const SOURCE_SHA256 =
  '820f49e495ab0d7144dc0f3d232258427d3579254c84cd5886bc56d89bd14bb1';
const DISPLAY_SHA256 =
  '00c0579f6bfdab858c814910992f416ac56189261cbc9a6dab1617e0a683791d';
const OLD_FOOTER = '<span>Source fields are snapshots. The two draft actions require the authenticated coordinator app and guarded backend. Nothing sends automatically.</span>';
const CURRENT_FOOTER = '<span>Source fields are snapshots. When a draft button is available, use Coordinator actions above to copy the full message, open Outlook, paste it, and verify recipients, links, and current Thirsty details before you send. Nothing sends automatically.</span>';

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function renderReviewedChartFooter(authenticatedHtml) {
  if (typeof authenticatedHtml !== 'string' ||
      authenticatedHtml.length > 1_000_000 ||
      !globalThis.crypto?.subtle ||
      await sha256(authenticatedHtml) !== SOURCE_SHA256) {
    throw new Error('Reviewed chart render unavailable');
  }
  const first = authenticatedHtml.indexOf(OLD_FOOTER);
  if (first < 0 || authenticatedHtml.indexOf(OLD_FOOTER, first + 1) >= 0) {
    throw new Error('Reviewed chart footer unavailable');
  }
  const displayed = authenticatedHtml.replace(OLD_FOOTER, CURRENT_FOOTER);
  if (await sha256(displayed) !== DISPLAY_SHA256) {
    throw new Error('Reviewed chart display mismatch');
  }
  return displayed;
}
