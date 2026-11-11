/**
 * @typedef {object} Daily
 * @property {string} day Local calendar date, YYYY-MM-DD.
 * @property {number} used Draws spent on that day.
 */

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {Date} date
 * @returns {string} Local calendar date, YYYY-MM-DD.
 */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Return the record unchanged when it is valid for today, otherwise a fresh one.
 * Callers can compare by reference to know whether to persist.
 * @param {unknown} raw
 * @param {string} today
 * @returns {Daily}
 */
export function normalizeDaily(raw, today) {
  const valid =
    raw !== null &&
    typeof raw === 'object' &&
    /** @type {Daily} */ (raw).day === today &&
    Number.isInteger(/** @type {Daily} */ (raw).used) &&
    /** @type {Daily} */ (raw).used >= 0;
  return valid ? /** @type {Daily} */ (raw) : { day: today, used: 0 };
}

/**
 * @param {Daily} daily
 * @param {number} max
 * @returns {number}
 */
export function remainingDraws(daily, max) {
  return Math.max(0, max - daily.used);
}

/**
 * @param {Daily} daily
 * @returns {Daily}
 */
export function consumeDraw(daily) {
  return { ...daily, used: daily.used + 1 };
}
