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
