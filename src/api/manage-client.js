/* Authenticated client for `/api/manage/*`. Attaches Bearer tokens, generates
   Idempotency-Key headers for writes, and surfaces structured API errors. */

/**
 * Error raised when a `/api/manage/*` request fails or returns `success: false`.
 */
export class ManageApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: unknown[], retryAfter?: number | null }} [info]
   */
  constructor(
    message,
    { status = 0, code = 'request_failed', details = [], retryAfter = null } = {},
  ) {
    super(message);
    this.name = 'ManageApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

/**
 * Build a query string from defined, non-empty parameters.
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function buildManageQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Create a management API client bound to a token getter.
 * @param {{
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   getToken: () => string,
 *   fetchImpl?: typeof fetch,
 *   newKey?: () => string,
 * }} options
 */
export function createManageClient({
  baseUrl = '',
  timeoutMs = 15_000,
  getToken,
  fetchImpl,
  newKey = () => `web-${globalThis.crypto.randomUUID()}`,
}) {
  const doFetch = (...args) => (fetchImpl ?? globalThis.fetch)(...args);

  /**
   * @param {'GET' | 'POST' | 'PATCH' | 'PUT'} method
   * @param {string} path
   * @param {unknown} [body]
   */
  async function request(method, path, body) {
    const token = getToken().trim();
    if (!token) {
      throw new ManageApiError('请先输入管理令牌', { status: 401, code: 'unauthorized' });
    }
    const headers = { authorization: `Bearer ${token}` };
    const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (method !== 'GET') {
      headers['idempotency-key'] = newKey();
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }

    let response;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      throw new ManageApiError(isTimeout ? '请求超时，请重试' : '网络连接失败，请检查网络', {
        code: isTimeout ? 'timeout' : 'network',
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ManageApiError(`服务端返回了无效响应 (${response.status})`, {
        status: response.status,
        code: 'invalid_response',
      });
    }

    if (!response.ok || !payload?.success) {
      const err = payload?.error ?? {};
      const retryHeader = response.headers.get('retry-after');
      const retryAfter = retryHeader ? Number(retryHeader) : null;
      throw new ManageApiError(err.message || `请求失败 (${response.status})`, {
        status: response.status,
        code: typeof err.code === 'string' ? err.code : 'http_error',
        details: Array.isArray(err.details) ? err.details : [],
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
      });
    }

    return { data: payload.data, meta: payload.meta ?? null };
  }

  return {
    getMe: () => request('GET', '/api/manage/me').then((r) => r.data),
    listProviders: () => request('GET', '/api/manage/providers').then((r) => r.data),
    createProvider: (body) => request('POST', '/api/manage/providers', body).then((r) => r.data),
    updateProvider: (id, body) =>
      request('PATCH', `/api/manage/providers/${encodeURIComponent(id)}`, body).then((r) => r.data),
    listOffers: (params = {}) => request('GET', `/api/manage/offers${buildManageQuery(params)}`),
    getOffer: (id) =>
      request('GET', `/api/manage/offers/${encodeURIComponent(id)}`).then((r) => r.data),
    createOffer: (body) => request('POST', '/api/manage/offers', body).then((r) => r.data),
    editOffer: (id, body) =>
      request('PATCH', `/api/manage/offers/${encodeURIComponent(id)}`, body).then((r) => r.data),
    transitionOffer: (id, action, body = {}) =>
      request('POST', `/api/manage/offers/${encodeURIComponent(id)}/${action}`, body).then(
        (r) => r.data,
      ),
    proposeChange: (id, body) =>
      request('POST', `/api/manage/offers/${encodeURIComponent(id)}/changes`, body).then(
        (r) => r.data,
      ),
    listChanges: (params = {}) =>
      request('GET', `/api/manage/changes${buildManageQuery(params)}`).then((r) => r.data),
    applyChange: (id) =>
      request('POST', `/api/manage/changes/${encodeURIComponent(id)}/apply`, {}).then(
        (r) => r.data,
      ),
    rejectChange: (id) =>
      request('POST', `/api/manage/changes/${encodeURIComponent(id)}/reject`, {}).then(
        (r) => r.data,
      ),
    listAudit: (params = {}) =>
      request('GET', `/api/manage/audit${buildManageQuery(params)}`).then((r) => r.data),
    revertAudit: (id) =>
      request('POST', `/api/manage/audit/${encodeURIComponent(String(id))}/revert`, {}).then(
        (r) => r.data,
      ),
    listFeedback: (params = {}) =>
      request('GET', `/api/manage/feedback${buildManageQuery(params)}`),
    /** @param {number | string} id @param {'resolve' | 'dismiss' | 'reopen'} action */
    transitionFeedback: (id, action, body = {}) =>
      request(
        'POST',
        `/api/manage/feedback/${encodeURIComponent(String(id))}/${action}`,
        body,
      ).then((r) => r.data),
    getClickStats: (days = 7) =>
      request('GET', `/api/manage/stats/clicks?days=${encodeURIComponent(String(days))}`).then(
        (r) => r.data,
      ),
    getCommunity: () => request('GET', '/api/manage/community').then((r) => r.data),
    putCommunity: (body) => request('PUT', '/api/manage/community', body).then((r) => r.data),
    listPrizes: () => request('GET', '/api/manage/prizes').then((r) => r.data),
    createPrize: (body) => request('POST', '/api/manage/prizes', body).then((r) => r.data),
    editPrize: (id, body) =>
      request('PATCH', `/api/manage/prizes/${encodeURIComponent(id)}`, body).then((r) => r.data),
    /** @param {string} id @param {string[]} codes */
    addPrizeCodes: (id, codes) =>
      request('POST', `/api/manage/prizes/${encodeURIComponent(id)}/codes`, { codes }).then(
        (r) => r.data,
      ),
    listPrizeWinners: (id) =>
      request('GET', `/api/manage/prizes/${encodeURIComponent(id)}/winners`).then((r) => r.data),
    /** @param {string} id @param {'activate' | 'pause' | 'end'} action */
    transitionPrize: (id, action) =>
      request('POST', `/api/manage/prizes/${encodeURIComponent(id)}/${action}`, {}).then(
        (r) => r.data,
      ),
  };
}
