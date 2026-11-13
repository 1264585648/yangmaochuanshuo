/* Validation for the user API (`/api/me*`, `/api/draws`). The server already
   checks everything; this guards the UI against schema drift. */
import { POOL_IDS, RARITY_IDS, normalizeOffer } from './offer.js';
import { normalizeWonPrize } from './prize.js';

/**
 * @typedef {import('./offer.js').Offer} Offer
 * @typedef {{ max: number, used: number, day: string, resetsAt: number }} Quota
 *   `resetsAt` is epoch milliseconds.
 * @typedef {{ id: string, kind: string }} User
 * @typedef {{ id: string, provider: { id: string, name: string }, pool: string, rarity: string,
 *   title: string, retired: true }} RetiredOffer A card that is no longer public.
 * @typedef {Offer | RetiredOffer} OwnedOffer
 * @typedef {{ id: string, pool: string, rarity: string, createdAt: string, isNew: boolean,
 *   favorite: boolean }} Draw
 * @typedef {{ draw: Draw, offer: OwnedOffer, quota: Quota,
 *   prize: import('./prize.js').WonPrize | null }} DrawResult
 * @typedef {{ offer: OwnedOffer, firstDrawnAt: string, lastDrawnAt: string, drawCount: number,
 *   favorite: boolean, live: boolean }} CollectionCard
 * @typedef {{ found: number, total: number }} Tally
 * @typedef {{ live: Tally, retired: number, byPool: (Tally & { pool: string })[],
 *   byRarity: (Tally & { rarity: string })[] }} Progress
 * @typedef {{ id: string, pool: string, rarity: string, createdAt: string, offer: OwnedOffer,
 *   live: boolean }} HistoryItem
 */

const MAX_TEXT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isPool = (v) => POOL_IDS.includes(v);
const isRarity = (v) => RARITY_IDS.includes(v);

/** @param {unknown} raw @returns {Quota | null} */
export function normalizeQuota(raw) {
  if (!isObject(raw)) return null;
  const { max, used, day, resetsAt } = raw;
  if (!isCount(max) || !isCount(used) || typeof day !== 'string' || !DAY.test(day)) return null;
  if (!isTime(resetsAt)) return null;
  return Object.freeze({ max, used, day, resetsAt: Date.parse(resetsAt) });
}

/** @param {Quota} quota @returns {number} */
export const remainingDraws = (quota) => Math.max(0, quota.max - quota.used);

/** @param {unknown} raw @returns {{ user: User | null, quota: Quota } | null} */
export function normalizeMe(raw) {
  if (!isObject(raw)) return null;
  const quota = normalizeQuota(raw.quota);
  if (!quota) return null;
  if (raw.user === null) return { user: null, quota };
  const { user } = raw;
  if (!isObject(user) || !isText(user.id) || !isText(user.kind)) return null;
  return { user: Object.freeze({ id: user.id, kind: user.kind }), quota };
}

/** @param {unknown} raw @returns {OwnedOffer | null} */
export function normalizeOwnedOffer(raw) {
  if (!isObject(raw) || raw.retired !== true) return normalizeOffer(raw);
  const { id, provider, pool, rarity, title } = raw;
  if (!isText(id) || !isText(title) || !isPool(pool) || !isRarity(rarity)) return null;
  if (!isObject(provider) || !isText(provider.id) || !isText(provider.name)) return null;
  return Object.freeze({
    id,
    provider: Object.freeze({ id: provider.id, name: provider.name }),
    pool,
    rarity,
    title,
    retired: true,
  });
}

/** @param {OwnedOffer} offer @returns {offer is RetiredOffer} */
export const isRetired = (offer) => 'retired' in offer && offer.retired === true;

/** @param {unknown} raw @returns {Draw | null} */
function normalizeDraw(raw) {
  if (!isObject(raw)) return null;
  const { id, pool, rarity, createdAt, isNew, favorite } = raw;
  if (!isText(id) || !isPool(pool) || !isRarity(rarity) || !isTime(createdAt)) return null;
  if (typeof isNew !== 'boolean' || typeof favorite !== 'boolean') return null;
  return Object.freeze({ id, pool, rarity, createdAt, isNew, favorite });
}

/** @param {unknown} raw @returns {DrawResult | null} */
export function normalizeDrawResult(raw) {
  if (!isObject(raw)) return null;
  const draw = normalizeDraw(raw.draw);
  const offer = normalizeOwnedOffer(raw.offer);
  const quota = normalizeQuota(raw.quota);
  // A malformed prize is dropped here; the winner can still see it in the collection.
  const prize = normalizeWonPrize(raw.prize);
  return draw && offer && quota ? { draw, offer, quota, prize } : null;
}

/** @param {unknown} raw @returns {CollectionCard | null} */
function normalizeCard(raw) {
  if (!isObject(raw)) return null;
  const offer = normalizeOwnedOffer(raw.offer);
  const { firstDrawnAt, lastDrawnAt, drawCount, favorite, live } = raw;
  if (!offer || !isTime(firstDrawnAt) || !isTime(lastDrawnAt) || !isCount(drawCount)) return null;
  if (typeof favorite !== 'boolean' || typeof live !== 'boolean') return null;
  // One source of truth for "retired": the flag must match the offer's shape.
  if (live === isRetired(offer)) return null;
  return Object.freeze({ offer, firstDrawnAt, lastDrawnAt, drawCount, favorite, live });
}

/** @param {unknown} raw @returns {Tally | null} */
const normalizeTally = (raw) =>
  isObject(raw) && isCount(raw.found) && isCount(raw.total)
    ? { found: raw.found, total: raw.total }
    : null;

/**
 * @template {'pool' | 'rarity'} K
 * @param {unknown} raw
 * @param {K} key
 * @param {(v: unknown) => boolean} isKey
 */
function normalizeTallies(raw, key, isKey) {
  if (!Array.isArray(raw)) return null;
  const rows = raw.map((row) => {
    const tally = normalizeTally(row);
    return tally && isKey(row[key]) ? { [key]: row[key], ...tally } : null;
  });
  return rows.every(Boolean) ? rows : null;
}

/** @param {unknown} raw @returns {Progress | null} */
function normalizeProgress(raw) {
  if (!isObject(raw) || !isCount(raw.retired)) return null;
  const live = normalizeTally(raw.live);
  const byPool = normalizeTallies(raw.byPool, 'pool', isPool);
  const byRarity = normalizeTallies(raw.byRarity, 'rarity', isRarity);
  if (!live || !byPool || !byRarity) return null;
  return { live, retired: raw.retired, byPool, byRarity };
}

/** Invalid cards are dropped, never rendered. @param {unknown} raw */
export function normalizeCollection(raw) {
  if (!isObject(raw) || !Array.isArray(raw.cards)) return null;
  const progress = normalizeProgress(raw.progress);
  if (!progress) return null;
  return { cards: raw.cards.map(normalizeCard).filter(Boolean), progress };
}

/** @param {unknown} raw @returns {HistoryItem | null} */
function normalizeHistoryItem(raw) {
  if (!isObject(raw)) return null;
  const offer = normalizeOwnedOffer(raw.offer);
  const { id, pool, rarity, createdAt, live } = raw;
  if (!offer || !isText(id) || !isPool(pool) || !isRarity(rarity) || !isTime(createdAt)) {
    return null;
  }
  if (typeof live !== 'boolean' || live === isRetired(offer)) return null;
  return Object.freeze({ id, pool, rarity, createdAt, offer, live });
}

/** @param {unknown} raw @returns {{ items: HistoryItem[], nextCursor: string | null } | null} */
export function normalizeHistory(raw) {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const { nextCursor } = raw;
  if (nextCursor !== null && !isText(nextCursor)) return null;
  return { items: raw.items.map(normalizeHistoryItem).filter(Boolean), nextCursor };
}
