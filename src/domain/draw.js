/**
 * @typedef {object} Rarity
 * @property {string} id
 * @property {number} chance Probability in [0, 1]; the table should sum to 1.
 */

/** Single source of truth for published odds. */
/** @type {readonly Rarity[]} */
export const RARITIES = Object.freeze([
  Object.freeze({ id: 'A', chance: 0.7 }),
  Object.freeze({ id: 'S', chance: 0.25 }),
  Object.freeze({ id: 'SSR', chance: 0.05 }),
]);

const UINT32_RANGE = 2 ** 32;

/** @returns {number} Uniform value in [0, 1). */
export function cryptoRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] / UINT32_RANGE;
  }
  return Math.random();
}

/**
 * Pick a rarity by walking cumulative thresholds computed from the table.
 * @param {() => number} [random]
 * @param {readonly Rarity[]} [rarities]
 * @returns {string}
 */
export function drawRarity(random = cryptoRandom, rarities = RARITIES) {
  const roll = random();
  let cumulative = 0;
  for (const rarity of rarities) {
    cumulative += rarity.chance;
    if (roll < cumulative) return rarity.id;
  }
  return rarities[rarities.length - 1].id;
}

/**
 * @template {{ pool: string, rarity: string }} T
 * @param {readonly T[]} offers
 * @param {string} poolId
 * @param {string} rarity
 * @param {() => number} [random]
 * @returns {T | null} null when the pool has no card of that rarity.
 */
export function pickOffer(offers, poolId, rarity, random = cryptoRandom) {
  const options = offers.filter((o) => o.pool === poolId && o.rarity === rarity);
  if (options.length === 0) return null;
  const index = Math.min(options.length - 1, Math.floor(random() * options.length));
  return options[index];
}
