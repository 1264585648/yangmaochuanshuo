import { QUOTA_UTC_OFFSET_MINUTES } from '../config';

const OFFSET_MS = QUOTA_UTC_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Quota day, YYYY-MM-DD, in the fixed reset timezone (Beijing time, no DST).
 * Offer validity windows stay in UTC (`utcDay`); only the draw quota uses this.
 */
export function quotaDay(now: Date): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of the next quota day, as an absolute instant. */
export function nextReset(now: Date): Date {
  const shifted = now.getTime() + OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS + 1) * DAY_MS - OFFSET_MS);
}
