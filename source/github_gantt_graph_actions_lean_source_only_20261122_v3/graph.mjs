import {CORRELATION_HEADER, email, GRAPH_SCOPES, HeldActionError} from './contract.mjs';

export class GraphHttpError extends Error {
  constructor(status, code = null) {
    super(`Microsoft Graph returned HTTP ${status}`);
    this.name = 'GraphHttpError';
    this.status = status;
    this.code = typeof code === 'string' ? code : null;
  }
}

const allowedScopeSets = new Set(Object.values(GRAPH_SCOPES).map(v => JSON.stringify(v)));
const itemPost = /^\/v1\.0\/sites\/[^/]+\/lists\/[0-9a-f-]{36}\/items$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENT_SCAN_PAGE_SIZE = 25;
const SENT_SCAN_MAX_PAGES = 20;
const SENT_SCAN_LOOKBACK_MS = 5 * 60 * 1000;
const SENT_SCAN_SELECT = 'id,sentDateTime';
const SENT_SCAN_ORDER = 'sentDateTime desc';
const SENT_SCAN_PATH = '/v1.0/me/mailFolders/sentitems/messages';

/** Delegated-only Graph transport. There is no send, update, delete, or retry path. */
export class GraphClient {
  constructor({tokenProvider, fetchImpl = globalThis.fetch}) {
    if (typeof tokenProvider?.acquireToken !== 'function' || typeof fetchImpl !== 'function') {
      throw new TypeError('A delegated token provider and fetch are required');
    }
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  bindAccount() {
    if (typeof this.tokenProvider.pinAccount !== 'function') {
      throw new HeldActionError('GRAPH_ACCOUNT_NOT_PINNABLE');
    }
    return new GraphClient({tokenProvider: this.tokenProvider.pinAccount(), fetchImpl: this.fetchImpl});
  }

  async request(path, {method = 'GET', scopes, body, headers = {}, beforeFetch} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/v1.0/') || path.startsWith('//') ||
        !allowedScopeSets.has(JSON.stringify(scopes))) {
      throw new HeldActionError('GRAPH_REQUEST_INVALID');
    }
    const url = new URL(path, 'https://graph.microsoft.com');
    if (url.origin !== 'https://graph.microsoft.com' ||
        !url.pathname.startsWith('/v1.0/') ||
        !['GET', 'POST'].includes(method) ||
        (method === 'POST' &&
          url.pathname !== '/v1.0/me/messages' && !itemPost.test(url.pathname)) ||
        (method === 'GET' && body !== undefined)) {
      throw new HeldActionError('GRAPH_REQUEST_INVALID');
    }
    const tokenResult = await this.tokenProvider.acquireToken(scopes);
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.accessToken;
    if (typeof token !== 'string' || token.length < 12 || /\s/.test(token)) {
      throw new HeldActionError('GRAPH_TOKEN_UNAVAILABLE');
    }
    const init = {
      method, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers},
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    // This synchronous check occurs after any interactive token acquisition.
    if (beforeFetch !== undefined) {
      if (typeof beforeFetch !== 'function') throw new HeldActionError('GRAPH_PREFLIGHT_INVALID');
      const result = beforeFetch();
      if (result && typeof result.then === 'function') {
        throw new HeldActionError('ASYNC_GRAPH_PREFLIGHT_NOT_ALLOWED');
      }
    }
    const response = await this.fetchImpl(url.href, init);
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new HeldActionError('GRAPH_RESPONSE_TOO_LARGE');
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); }
      catch { throw new HeldActionError('GRAPH_RESPONSE_INVALID'); }
    }
    if (!response.ok) throw new GraphHttpError(response.status, data?.error?.code);
    return {status: response.status, data, etag: response.headers.get('etag')};
  }

  async getMe() {
    const r = await this.request('/v1.0/me?$select=id,mail,userPrincipalName',
      {scopes: GRAPH_SCOPES.identity});
    const id = String(r.data?.id ?? '').toLowerCase();
    if (!GUID.test(id)) {
      throw new HeldActionError('ACTOR_ID_MISSING');
    }
    return {id, address: email(r.data?.mail || r.data?.userPrincipalName)};
  }

  async getFolderId(kind) {
    if (!['drafts', 'sentitems'].includes(kind)) throw new HeldActionError('MAIL_FOLDER_INVALID');
    const r = await this.request(`/v1.0/me/mailFolders/${kind}?$select=id`, {
      scopes: GRAPH_SCOPES.mail, headers: {Prefer: 'IdType="ImmutableId"'},
    });
    if (typeof r.data?.id !== 'string' || !r.data.id) {
      throw new HeldActionError('MAIL_FOLDER_ID_MISSING');
    }
    return r.data.id;
  }

  async createDraft(draft, correlationId, beforeFetch) {
    if (!GUID.test(correlationId ?? '') ||
        !Array.isArray(draft?.to) || ![0, 1, 2].includes(draft.to.length) ||
        typeof draft.subject !== 'string' || typeof draft.htmlBody !== 'string') {
      throw new HeldActionError('DRAFT_POST_INVALID');
    }
    const r = await this.request('/v1.0/me/messages', {
      method: 'POST', scopes: GRAPH_SCOPES.mail,
      headers: {Prefer: 'IdType="ImmutableId"'}, beforeFetch,
      body: {
        subject: draft.subject,
        body: {contentType: 'HTML', content: draft.htmlBody},
        toRecipients: draft.to.map(address => ({emailAddress: {address: email(address)}})),
        internetMessageHeaders: [{name: CORRELATION_HEADER, value: correlationId}],
      },
    });
    if (r.status !== 201 || typeof r.data?.id !== 'string' || !r.data.id ||
        r.data.isDraft !== true) throw new HeldActionError('DRAFT_POST_OUTCOME_UNKNOWN');
    return r.data;
  }

  async getMessage(id) {
    if (typeof id !== 'string' || id.length < 8 || id.length > 2048) {
      throw new HeldActionError('MESSAGE_ID_INVALID');
    }
    const select = 'id,isDraft,parentFolderId,sentDateTime,toRecipients,ccRecipients,bccRecipients,internetMessageHeaders,webLink,subject,body,internetMessageId';
    const path = `/v1.0/me/messages/${encodeURIComponent(id)}?$select=${select}`;
    const r = await this.request(path, {
      scopes: GRAPH_SCOPES.mail, headers: {Prefer: 'IdType="ImmutableId"'},
    });
    return r.data;
  }

  async getMessageHeaders(id) {
    if (typeof id !== 'string' || id.length < 8 || id.length > 2048) {
      throw new HeldActionError('MESSAGE_ID_INVALID');
    }
    // Graph explicitly documents internetMessageHeaders on Get message. A
    // collection response is only an ID/time inventory, never header proof.
    const path = `/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,internetMessageHeaders`;
    const r = await this.request(path, {
      scopes: GRAPH_SCOPES.mail, headers: {Prefer: 'IdType="ImmutableId"'},
    });
    if (r.status !== 200 || r.data?.id !== id ||
        !Array.isArray(r.data.internetMessageHeaders)) {
      throw new HeldActionError('SENT_SCAN_INCOMPLETE');
    }
    return r.data.internetMessageHeaders;
  }

  /**
   * Outlook UI may create a Sent Items copy with a different immutable ID.
   * Scan only this delegated user's Sent Items. Read each candidate's opaque
   * header through Get message, then fetch the sole match in full upstream.
   * A partial scan or duplicate header is never evidence that mail was sent.
   */
  async findSentByCorrelation(correlationId, claimedAtUtc) {
    if (!GUID.test(correlationId ?? '') ||
        typeof claimedAtUtc !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(claimedAtUtc) ||
        !Number.isFinite(Date.parse(claimedAtUtc)) ||
        new Date(claimedAtUtc).toISOString() !== claimedAtUtc) {
      throw new HeldActionError('SENT_SCAN_INPUT_INVALID');
    }
    const lowerBoundEpoch = Date.parse(claimedAtUtc) - SENT_SCAN_LOOKBACK_MS;
    const lowerBound = new Date(lowerBoundEpoch).toISOString();
    if (!/^\d{4}-/.test(lowerBound)) {
      throw new HeldActionError('SENT_SCAN_INPUT_INVALID');
    }
    const filter = `sentDateTime ge ${lowerBound}`;
    const parameters = new URLSearchParams({
      '$select': SENT_SCAN_SELECT, '$filter': filter,
      '$orderby': SENT_SCAN_ORDER, '$top': String(SENT_SCAN_PAGE_SIZE),
    });
    let path = `${SENT_SCAN_PATH}?${parameters}`;
    const visited = new Set();
    const matches = new Set();
    for (let page = 0; page < SENT_SCAN_MAX_PAGES; page++) {
      if (visited.has(path)) throw new HeldActionError('SENT_SCAN_INCOMPLETE');
      visited.add(path);
      const response = await this.request(path, {
        scopes: GRAPH_SCOPES.mail,
        headers: {Prefer: 'IdType="ImmutableId"'},
      });
      const data = response.data;
      if (response.status !== 200 || !Array.isArray(data?.value) ||
          data.value.length > SENT_SCAN_PAGE_SIZE) {
        throw new HeldActionError('SENT_SCAN_INCOMPLETE');
      }
      for (const item of data.value) {
        const sentEpoch = Date.parse(item?.sentDateTime ?? '');
        if (typeof item?.id !== 'string' || item.id.length < 8 ||
            item.id.length > 2048 ||
            !Number.isFinite(sentEpoch) || sentEpoch < lowerBoundEpoch) {
          throw new HeldActionError('SENT_SCAN_INCOMPLETE');
        }
        let headers;
        try { headers = await this.getMessageHeaders(item.id); }
        catch { throw new HeldActionError('SENT_SCAN_INCOMPLETE'); }
        if (correlationIdOf({internetMessageHeaders: headers}) === correlationId) {
          matches.add(item.id);
        }
      }
      if (!data['@odata.nextLink']) {
        if (matches.size > 1) throw new HeldActionError('SENT_SCAN_AMBIGUOUS');
        return [...matches][0] ?? null;
      }
      let next;
      try { next = new URL(data['@odata.nextLink']); }
      catch { throw new HeldActionError('SENT_SCAN_INCOMPLETE'); }
      const keys = [...next.searchParams.keys()];
      const allowedKeys = new Set(['$select', '$filter', '$orderby',
        '$top', '$skiptoken', '$skip']);
      if (next.origin !== 'https://graph.microsoft.com' ||
          next.pathname.toLowerCase() !== SENT_SCAN_PATH.toLowerCase() ||
          keys.some(key => !allowedKeys.has(key)) ||
          new Set(keys).size !== keys.length ||
          next.searchParams.get('$select') !== SENT_SCAN_SELECT ||
          next.searchParams.get('$filter') !== filter ||
          next.searchParams.get('$orderby') !== SENT_SCAN_ORDER ||
          next.searchParams.get('$top') !== String(SENT_SCAN_PAGE_SIZE) ||
          !next.searchParams.has('$skiptoken') &&
            !next.searchParams.has('$skip')) {
        throw new HeldActionError('SENT_SCAN_INCOMPLETE');
      }
      path = next.pathname + next.search;
    }
    throw new HeldActionError('SENT_SCAN_INCOMPLETE');
  }
}

export function correlationIdOf(message) {
  const matches = (message?.internetMessageHeaders ?? []).filter(header =>
    String(header?.name ?? '').toLowerCase() === CORRELATION_HEADER);
  return matches.length === 1 ? matches[0].value : null;
}

export function recipientsOf(message, name = 'toRecipients') {
  if (!Array.isArray(message?.[name])) throw new HeldActionError('MESSAGE_RECIPIENTS_INVALID');
  return message[name].map(recipient => email(recipient?.emailAddress?.address));
}
