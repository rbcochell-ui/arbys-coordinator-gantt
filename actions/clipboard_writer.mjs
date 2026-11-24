// Clipboard write only. This module never opens Outlook, creates a draft, or
// sends. Call it directly from a trusted user click; it makes its first write
// before its first await to preserve transient user activation.
export class ClipboardWriteError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function writeClipboardPayload(payload, clipboard,
    Item = globalThis.ClipboardItem, BlobType = globalThis.Blob) {
  if (typeof payload?.plainText !== 'string' ||
      typeof payload?.html !== 'string' || !payload.plainText ||
      !payload.html || !clipboard) {
    throw new ClipboardWriteError('CLIPBOARD_INPUT_INVALID');
  }
  if (typeof clipboard.write === 'function' &&
      typeof Item === 'function' && typeof BlobType === 'function') {
    try {
      const item = new Item({
        'text/html': new BlobType([payload.html], {type: 'text/html'}),
        'text/plain': new BlobType([payload.plainText],
          {type: 'text/plain'}),
      });
      await clipboard.write([item]);
      return 'html+plain';
    } catch { /* Try plain text as a safe, explicitly labeled fallback. */ }
  }
  if (typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(payload.plainText);
      return 'plain';
    } catch { /* Caller shows a manual selection path. */ }
  }
  throw new ClipboardWriteError('CLIPBOARD_WRITE_UNAVAILABLE');
}
