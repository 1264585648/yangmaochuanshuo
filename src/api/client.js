/* Client for the public catalog API (`/api/offers`). Every response is checked
   against the `{ success, data, error, meta }` envelope and every offer is
   validated before it reaches the UI. */
import { normalizeOffer } from '../domain/offer.js';

/** @typedef {'network' | 'timeout' | 'aborted' | 'http' | 'invalid'} ApiErrorKind */

export class ApiError extends Error {
  /**
   * @param {ApiErrorKind} kind
   * @param {string} message
   * @param {{ status?: number, code?: string }} [details]
   */
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * Message suitable for showing to people. Never includes raw server text.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (!(error instanceof ApiError)) return '出现了意外错误，请稍后再试。';
  switch (error.kind) {
    case 'network':
      return '网络连接失败，请检查网络后重试。';
    case 'timeout':
      return '服务器响应超时，请稍后重试。';
    case 'http':
      return error.status && error.status >= 500
        ? '服务暂时不可用，请稍后重试。'
        : '请求未被接受，请刷新页面后重试。';
    default:
      return '收到的数据格式异常，请稍后重试。';
  }
}

const QUERY_KEYS = Object.freeze([
  'pool',
  'rarity',
  'provider',
  'newUsersOnly',
  'studentOnly',
  'requiresPaymentMethod',
  'autoRenews',
  'q',
  'limit',
  'offset',
]);

/**
 * Build a query string from known keys, dropping empty values.
 * @param {Record<string, unknown>} query
 * @returns {string}
 */
export function toQueryString(query) {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = query[key];
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

const isObject = (value) => value !== null && typeof value === 'object';

/**
 * @param {unknown} meta
 * @returns {{ total: number, limit: number, offset: number } | null}
 */
function parseMeta(meta) {
  if (!isObject(meta)) return null;
  const { total, limit, offset } = /** @type {Record<string, unknown>} */ (meta);
  const valid = [total, limit, offset].every((n) => Number.isInteger(n) && Number(n) >= 0);
  return valid ? { total: Number(total), limit: Number(limit), offset: Number(offset) } : null;
}

/**
 * Link an optional caller signal and a timeout to one controller.
 * @param {AbortSignal | undefined} outer
 * @param {number} timeoutMs
 */
function linkedAbort(outer, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * @param {{ baseUrl?: string, timeoutMs: number, fetchImpl?: typeof fetch }} options
 */
export function createApiClient({ baseUrl = '', timeoutMs, fetchImpl }) {
  // Resolve fetch lazily so tests and polyfills installed later are honoured.
  const doFetch = (...args) => (fetchImpl ?? globalThis.fetch)(...args);

  /**
   * @param {string} path
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ data: unknown, meta: ReturnType<typeof parseMeta> }>}
   */
  async function getJson(path, { signal } = {}) {
    // The timeout covers the whole exchange, body included: a server that
    // sends headers and then stalls must not hang the caller forever.
    const abort = linkedAbort(signal, timeoutMs);
    const failure = () => {
      if (abort.timedOut()) return new ApiError('timeout', 'Request timed out');
      if (signal?.aborted) return new ApiError('aborted', 'Request aborted');
      return null;
    };
    try {
      let response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          headers: { accept: 'application/json' },
          signal: abort.signal,
        });
      } catch {
        throw failure() ?? new ApiError('network', 'Network request failed');
      }

      let body;
      try {
        body = await response.json();
      } catch {
        throw (
          failure() ??
          new ApiError(response.ok ? 'invalid' : 'http', 'Response is not JSON', {
            status: response.status,
          })
        );
      }
      if (!isObject(body) || typeof body.success !== 'boolean') {
        throw new ApiError('invalid', 'Unexpected response envelope', { status: response.status });
      }
      if (!response.ok || !body.success) {
        const code =
          isObject(body.error) && typeof body.error.code === 'string' ? body.error.code : '';
        throw new ApiError('http', `Request failed (${response.status})`, {
          status: response.status,
          code,
        });
      }
      return { data: body.data, meta: parseMeta(body.meta) };
    } finally {
      abort.dispose();
    }
  }

  /**
   * One page of public offers. Invalid rows are dropped, never rendered.
   * @param {Record<string, unknown>} query
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function listOffers(query = {}, options = {}) {
    const { data, meta } = await getJson(`/api/offers${toQueryString(query)}`, options);
    if (!Array.isArray(data) || !meta) {
      throw new ApiError('invalid', 'Offer list has an unexpected shape');
    }
    const offers = data.map(normalizeOffer).filter(Boolean);
    // `received` counts raw rows, so paging stays correct when rows are dropped.
    return {
      offers,
      received: data.length,
      total: meta.total,
      limit: meta.limit,
      offset: meta.offset,
    };
  }

  /**
   * One public offer. A withdrawn or unknown id rejects with an http 404 ApiError.
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function getOffer(id, options = {}) {
    const { data } = await getJson(`/api/offers/${encodeURIComponent(id)}`, options);
    const offer = normalizeOffer(data);
    if (!offer) throw new ApiError('invalid', 'Offer has an unexpected shape');
    return offer;
  }

  /**
   * Every public offer, page by page, up to `maxPages`.
   * @param {{ pageSize: number, maxPages: number, signal?: AbortSignal }} options
   */
  async function listAllOffers({ pageSize, maxPages, signal }) {
    const all = [];
    for (let page = 0; page < maxPages; page++) {
      const result = await listOffers({ limit: pageSize, offset: page * pageSize }, { signal });
      all.push(...result.offers);
      const fetched = result.offset + result.received;
      if (result.received === 0 || fetched >= result.total) break;
    }
    return all;
  }

  return { listOffers, getOffer, listAllOffers };
}
