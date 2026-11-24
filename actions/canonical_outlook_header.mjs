// Encoding only. The caller must first verify an exact signed/pinned source.
// The tenant's Outlook host preserves To and subject on this HTTPS route but
// discards `body`; deliberately never put a body query parameter on the URL.
const HOST = 'https://outlook.cloud.microsoft';
const PATH = '/mail/deeplink/compose';
const ADDRESS = /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u;

export class OutlookHeaderError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function canonicalOutlookHeader(template) {
  const to = template?.to;
  const subject = template?.subject;
  const body = template?.body;
  if (!Array.isArray(to) || to.length < 1 || to.length > 2 ||
      to.some(address => typeof address !== 'string' ||
        !ADDRESS.test(address)) ||
      new Set(to.map(address => address.toLowerCase())).size !== to.length ||
      typeof subject !== 'string' || !subject || subject.length > 180 ||
      /[\r\n\u0000-\u001f\u007f]/u.test(subject) ||
      typeof body !== 'string' || !body || body.length > 8_000 ||
      /\u0000/u.test(body)) {
    throw new OutlookHeaderError('COMPOSE_HEADER_INVALID');
  }
  const url = `${HOST}${PATH}?to=${encodeURIComponent(to.join(';'))}` +
    `&subject=${encodeURIComponent(subject)}`;
  const parsed = new URL(url);
  if (parsed.origin !== HOST || parsed.pathname !== PATH ||
      parsed.username || parsed.password || parsed.hash ||
      [...parsed.searchParams.keys()].join(',') !== 'to,subject' ||
      parsed.searchParams.get('to') !== to.join(';') ||
      parsed.searchParams.get('subject') !== subject ||
      url.length > 1_000) {
    throw new OutlookHeaderError('COMPOSE_HEADER_INVALID');
  }
  return Object.freeze({url, body,
    to: Object.freeze([...to]), subject});
}
