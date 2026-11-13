/* Validation for limited prizes: the public rules (`/api/prizes`) and a won
   prize with its code (draw reply, `/api/me/prizes`). */

/**
 * @typedef {{ id: string, title: string, description: string, valueNote: string,
 *   chance: number, total: number, remaining: number, startsAt: string | null,
 *   endsAt: string | null }} PublicPrize
 * @typedef {{ id: string, title: string, description: string, redeemUrl: string | null,
 *   code: string, claimedAt: string }} WonPrize
 */

const MAX_TEXT = 500;
const MAX_CHANCE = 1;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;
const isOptionalText = (v) => typeof v === 'string' && v.length <= MAX_TEXT;
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isOptionalTime = (v) => v === null || isTime(v);

/** Only https links are ever rendered. @param {unknown} v */
function httpsOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  try {
    return new URL(v).protocol === 'https:' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** @param {unknown} raw @returns {WonPrize | null} */
export function normalizeWonPrize(raw) {
  if (!isObject(raw)) return null;
  const { id, title, description, code, claimedAt } = raw;
  const redeemUrl = httpsOrNull(raw.redeemUrl);
  if (!isText(id) || !isText(title) || !isOptionalText(description)) return null;
  if (!isText(code) || !isTime(claimedAt) || redeemUrl === undefined) return null;
  return Object.freeze({ id, title, description, redeemUrl, code, claimedAt });
}

/** @param {unknown} raw @returns {PublicPrize | null} */
function normalizePublicPrize(raw) {
  if (!isObject(raw)) return null;
  const { id, title, description, valueNote, chance, total, remaining, startsAt, endsAt } = raw;
  if (!isText(id) || !isText(title) || !isOptionalText(description)) return null;
  if (!isOptionalText(valueNote) || typeof chance !== 'number') return null;
  if (!(chance > 0 && chance <= MAX_CHANCE) || !isCount(total) || !isCount(remaining)) return null;
  if (remaining > total || !isOptionalTime(startsAt) || !isOptionalTime(endsAt)) return null;
  return Object.freeze({
    id,
    title,
    description,
    valueNote,
    chance,
    total,
    remaining,
    startsAt,
    endsAt,
  });
}

/** Invalid rows are dropped. @param {unknown} raw @returns {PublicPrize[] | null} */
export function normalizePublicPrizes(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map(normalizePublicPrize).filter(Boolean);
}

/** @param {unknown} raw @returns {WonPrize[] | null} */
export function normalizeWonPrizes(raw) {
  if (!isObject(raw) || !Array.isArray(raw.prizes)) return null;
  return raw.prizes.map(normalizeWonPrize).filter(Boolean);
}

/** Prizes that can still be won. @param {readonly PublicPrize[]} prizes */
export const prizesInStock = (prizes) => prizes.filter((p) => p.remaining > 0);
