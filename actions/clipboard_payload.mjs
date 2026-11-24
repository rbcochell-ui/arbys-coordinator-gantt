// Pure formatting for a reviewed compose template. Source authority is checked
// by the signed/pinned template builder before this module is called.
import {PICOS_PARTS} from './parts.mjs';

const escapeHtml = value => value.replace(/[&<>"']/gu, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export class ClipboardPayloadError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function clipboardPayload(template) {
  const body = template?.body;
  if (typeof body !== 'string' || !body || body.length > 8_000 ||
      /\u0000/u.test(body) || !['customer', 'provider'].includes(template?.kind)) {
    throw new ClipboardPayloadError('CLIPBOARD_BODY_INVALID');
  }
  const lines = body.split(/\r\n|\n|\r/gu);
  let links;
  if (template.kind === 'provider') {
    links = PICOS_PARTS.map(part => part.url);
    if (!links.every(url => lines.filter(line => line === url).length === 1)) {
      throw new ClipboardPayloadError('CLIPBOARD_LINKS_MISSING');
    }
  } else {
    const link = template.trackerUrl;
    if (typeof link !== 'string' ||
        !link.startsWith('https://rbcochell-ui.github.io/arbys-customer-status-preview/?p=') ||
        lines.filter(line => line === link).length !== 1) {
      throw new ClipboardPayloadError('CLIPBOARD_LINKS_MISSING');
    }
    links = [link];
  }
  const allowed = new Set(links);
  const html = '<div>' + lines.map(line => allowed.has(line)
    ? `<a href="${escapeHtml(line)}">${escapeHtml(line)}</a>`
    : escapeHtml(line)).join('<br>') + '</div>';
  if (html.length > 20_000) {
    throw new ClipboardPayloadError('CLIPBOARD_BODY_INVALID');
  }
  return Object.freeze({plainText: body, html,
    linkCount: links.length});
}
