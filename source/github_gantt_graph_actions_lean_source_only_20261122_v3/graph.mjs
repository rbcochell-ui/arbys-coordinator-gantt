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
