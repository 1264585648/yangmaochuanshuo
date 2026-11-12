/* URL design for the public catalog page, shared by the browser and the
   Worker's server-side renderer:

     /offers                         full catalog, page 1
     /offers?pool=ai&studentOnly=true&q=gpu&page=2
     /offers/<offer-id>              one offer

   Parameter names match `GET /api/offers`, so a page URL maps to an API query
   one-to-one. Unlike the API, page URLs are parsed tolerantly: unknown or
   malformed values (tracking params, stale links) are dropped, never errors. */
import { POOL_IDS, RARITY_IDS } from './offer.js';

export const CATALOG_PATH = '/offers';
export const CATALOG_PAGE_SIZE = 20;
/** Pages beyond this are not linked to; keeps offsets bounded. */
export const MAX_PAGE = 500;
export const MAX_QUERY = 100;

export const FLAG_KEYS = Object.freeze([
  'newUsersOnly',
  'studentOnly',
  'requiresPaymentMethod',
  'autoRenews',
]);

/** Serialisation order of URL parameters. */
const ORDER = Object.freeze(['pool', 'rarity', ...FLAG_KEYS, 'q']);

/** Same rule as the Worker's `slugSchema`. */
const SLUG = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @typedef {'true' | 'false'} Flag
 * @typedef {object} CatalogFilters
 * @property {string} [pool]
 * @property {string} [rarity]
 * @property {Flag} [newUsersOnly]
 * @property {Flag} [studentOnly]
 * @property {Flag} [requiresPaymentMethod]
 * @property {Flag} [autoRenews]
 * @property {string} [q]
 * @property {number} page 1-based.
 */

/** @param {string | null} raw */
function parsePage(raw) {
  if (!raw || !/^\d{1,6}$/.test(raw)) return 1;
  return Math.min(Math.max(Number(raw), 1), MAX_PAGE);
}

/**
 * @param {URLSearchParams} params
 * @returns {Readonly<CatalogFilters>}
 */
export function parseCatalogParams(params) {
  /** @type {Record<string, string | number>} */
  const out = {};
  const pool = params.get('pool');
  if (pool && POOL_IDS.includes(/** @type {any} */ (pool))) out.pool = pool;
  const rarity = params.get('rarity');
  if (rarity && RARITY_IDS.includes(/** @type {any} */ (rarity))) out.rarity = rarity;
  for (const key of FLAG_KEYS) {
    const value = params.get(key);
    if (value === 'true' || value === 'false') out[key] = value;
  }
  const q = (params.get('q') ?? '').trim().slice(0, MAX_QUERY).trim();
  if (q) out.q = q;
  out.page = parsePage(params.get('page'));
  return Object.freeze(/** @type {CatalogFilters} */ (out));
}

/**
 * @param {Readonly<CatalogFilters>} filters
 * @returns {string} `?…` in a stable order, or '' for the bare catalog.
 */
export function catalogSearch(filters) {
  const params = new URLSearchParams();
  for (const key of ORDER) {
    const value = filters[key];
    if (value) params.set(key, String(value));
  }
  if (filters.page > 1) params.set('page', String(filters.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** @param {Readonly<CatalogFilters>} filters */
export const catalogHref = (filters) => `${CATALOG_PATH}${catalogSearch(filters)}`;

/** @param {string} id */
export const offerHref = (id) => `${CATALOG_PATH}/${encodeURIComponent(id)}`;

/**
 * @param {Readonly<CatalogFilters>} filters
 * @param {number} [pageSize]
 * @returns {Record<string, string | number>} Query for `GET /api/offers`.
 */
export function toApiQuery(filters, pageSize = CATALOG_PAGE_SIZE) {
  /** @type {Record<string, string | number>} */
  const query = {};
  for (const key of ORDER) {
    const value = filters[key];
    if (value) query[key] = value;
  }
  return { ...query, limit: pageSize, offset: (filters.page - 1) * pageSize };
}

/**
 * @typedef {{ kind: 'list' } | { kind: 'detail', id: string } | { kind: 'missing' }} CatalogRoute
 * @param {string} pathname
 * @returns {CatalogRoute | null} null when the path is not part of the catalog.
 */
export function parseCatalogPath(pathname) {
  const match = /^\/offers(?:\/(.*))?$/.exec(pathname);
  if (!match) return null;
  const rest = (match[1] ?? '').replace(/\/$/, '');
  if (rest === '') return { kind: 'list' };
  let id;
  try {
    id = decodeURIComponent(rest);
  } catch {
    return { kind: 'missing' };
  }
  return SLUG.test(id) ? { kind: 'detail', id } : { kind: 'missing' };
}

/**
 * Search engines index the whole catalog and each pool. Searches and
 * condition combinations stay linkable but are marked noindex to avoid
 * near-duplicate pages.
 * @param {Readonly<CatalogFilters>} filters
 */
export function isIndexable(filters) {
  return !filters.q && !filters.rarity && FLAG_KEYS.every((key) => !filters[key]);
}
