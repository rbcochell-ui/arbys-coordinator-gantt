// Display-only corrections for the one reviewed encrypted chart. The original
// decrypted bytes remain the action source and must match the chart envelope.
const SOURCE_SHA256 =
  '820f49e495ab0d7144dc0f3d232258427d3579254c84cd5886bc56d89bd14bb1';
const DISPLAY_SHA256 =
  '653aacfeba4a9e204730c693e30457fedd7a7426424cad05f716db3bde6101df';
const OLD_FOOTER = '<span>Source fields are snapshots. The two draft actions require the authenticated coordinator app and guarded backend. Nothing sends automatically.</span>';
const CURRENT_FOOTER = '<span>Source fields are snapshots. When a draft button is available, use Coordinator actions above to copy the full message, open Outlook, paste it, and verify recipients, links, and current Thirsty details before you send. Nothing sends automatically.</span>';
const DISPLAY_EDITS = Object.freeze([
  [OLD_FOOTER, CURRENT_FOOTER],
  ["  const label = 'Select provider parts draft';",
    "  const label = workOrder.type === 'Installation'\n    ? 'Select this WO for provider parts email template above'\n    : 'Select provider parts draft';"],
  ["title:'Select this work order in the parent page. Draft creation is held pending company access and fresh source checks.'",
    "title:workOrder.type === 'Installation'\n      ? 'Select this WO, then open Provider parts email template in Coordinator actions above. Verify current Thirsty status, SP date, contacts, and parts before Send.'\n      : 'Select this work order in the parent page. Draft creation is held pending company access and fresh source checks.'"],
  ['    const outreachNote = partsCandidate',
    "    const outreachNote = wo.type === 'Installation'\n      ? `Provider parts email template available in Coordinator actions above · ${assignedSp} · verify current Thirsty status, SP date, contacts and parts before Send.`\n      : partsCandidate"],
]);

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
  let displayed = authenticatedHtml;
  for (const [before, after] of DISPLAY_EDITS) {
    const first = displayed.indexOf(before);
    if (first < 0 || displayed.indexOf(before, first + 1) >= 0) {
      throw new Error('Reviewed chart display edit unavailable');
    }
    displayed = displayed.replace(before, after);
  }
  if (await sha256(displayed) !== DISPLAY_SHA256) {
    throw new Error('Reviewed chart display mismatch');
  }
  return displayed;
}
