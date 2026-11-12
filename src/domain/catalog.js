/* Pure helpers over the live catalog: per-pool odds and draws. */
import { RARITIES, drawRarity, pickOffer, cryptoRandom } from './draw.js';

/**
 * @typedef {import('./offer.js').Offer} Offer
 * @typedef {{ id: string, chance: number, count: number }} PoolOdds
 */

/**
 * @param {readonly Offer[]} offers
 * @returns {Record<string, number>} Offer count per pool id.
 */
export function countByPool(offers) {
  return offers.reduce((acc, o) => ({ ...acc, [o.pool]: (acc[o.pool] ?? 0) + 1 }), {});
}

/**
 * Odds for one pool. Tiers with no live card are removed and the remaining base
 * chances are scaled to sum to 1, so the published odds always match the draw.
 * @param {readonly Offer[]} offers
 * @param {string} poolId
 * @param {readonly import('./draw.js').Rarity[]} [rarities]
 * @returns {PoolOdds[]} Empty when the pool has no cards.
 */
export function poolOdds(offers, poolId, rarities = RARITIES) {
  const inPool = offers.filter((o) => o.pool === poolId);
  const present = rarities
    .map((r) => ({ ...r, count: inPool.filter((o) => o.rarity === r.id).length }))
    .filter((r) => r.count > 0 && r.chance > 0);
  const weight = present.reduce((sum, r) => sum + r.chance, 0);
  return present.map((r) => ({ id: r.id, chance: r.chance / weight, count: r.count }));
}

/**
 * @param {readonly Offer[]} offers
 * @param {string} poolId
 * @param {() => number} [random]
 * @returns {Offer | null} null when the pool is empty.
 */
export function drawFromPool(offers, poolId, random = cryptoRandom) {
  const odds = poolOdds(offers, poolId);
  if (odds.length === 0) return null;
  return pickOffer(offers, poolId, drawRarity(random, odds), random);
}

/**
 * Resolve stored collection ids against the live catalog.
 * @param {readonly { id: string }[]} collection
 * @param {readonly Offer[]} offers
 * @returns {{ found: Offer[], missing: number }} Unique ids, most recent first.
 */
export function resolveCollection(collection, offers) {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const ids = [...new Set(collection.map((entry) => entry.id))];
  const found = ids.map((id) => byId.get(id)).filter(Boolean);
  return { found, missing: ids.length - found.length };
}
