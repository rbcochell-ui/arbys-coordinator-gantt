// Encoding only. This module proves neither source identity nor permission to
// draft; trusted entrypoints must check those before calling it.
const ADDRESS = /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/u;

export function encodeComposeUris(to, subject, body) {
  if (!Array.isArray(to) || to.length < 1 || to.length > 2 ||
      to.some(address => typeof address !== 'string' || !ADDRESS.test(address)) ||
      new Set(to.map(address => address.toLowerCase())).size !== to.length ||
      typeof subject !== 'string' || !subject || subject.length > 180 ||
      /[\r\n\u0000]/u.test(subject) ||
      typeof body !== 'string' || !body || body.length > 8000 ||
      /\u0000/u.test(body)) throw new TypeError('Invalid compose fields');
  const canonicalBody = body.replace(/\r\n?|\n/gu, '\r\n');
  const pair = (name, value) => `${name}=${encodeURIComponent(value)}`;
  const web = `https://outlook.office.com/mail/deeplink/compose?${[
    pair('to', to.join(';')), pair('subject', subject),
    pair('body', canonicalBody),
  ].join('&')}`;
  // RFC 6068 section 5: CRLF in the raw mailto URI must be %0D%0A.
  const mailto = `mailto:${to.join(',')}?${[
    pair('subject', subject), pair('body', canonicalBody),
  ].join('&')}`;
  return Object.freeze({outlookWeb: web, mailto, body: canonicalBody});
}
