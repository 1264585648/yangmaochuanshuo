/**
 * @typedef {object} CollectionEntry
 * @property {string} id Offer id.
 * @property {number} ts Draw time, epoch milliseconds.
 */

/**
 * @param {readonly CollectionEntry[]} collection
 * @param {string} offerId
 * @param {number} ts
 * @param {number} limit
 * @returns {CollectionEntry[]} Newest first, capped at `limit`.
 */
export function recordDraw(collection, offerId, ts, limit) {
  return [{ id: offerId, ts }, ...collection].slice(0, limit);
}

/**
 * @param {readonly string[]} favorites
 * @param {string} offerId
 * @returns {string[]}
 */
export function toggleFavorite(favorites, offerId) {
  return favorites.includes(offerId)
    ? favorites.filter((id) => id !== offerId)
    : [...favorites, offerId];
}

/**
 * @template {{ id: string }} T
 * @param {readonly CollectionEntry[]} collection
 * @param {readonly T[]} offers
 * @returns {T[]} Unique known offers, most recently first seen order.
 */
export function discoveredOffers(collection, offers) {
  return [...new Set(collection.map((entry) => entry.id))]
    .map((id) => offers.find((o) => o.id === id))
    .filter(Boolean);
}

/**
 * @template {{ pool: string, title: string, description: string }} T
 * @param {readonly T[]} offers
 * @param {readonly { id: string, label: string }[]} pools
 * @param {string} query
 * @returns {T[]}
 */
export function searchOffers(offers, pools, query) {
  const q = query.trim().toLowerCase();
  return offers.filter((o) => {
    const label = pools.find((p) => p.id === o.pool)?.label ?? '';
    return `${o.title}${o.description}${label}`.toLowerCase().includes(q);
  });
}
