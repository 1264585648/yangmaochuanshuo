import type { RateLimit } from './write/rate-limit';

/** Pending offers plus pending change requests one inspector may have open at once. */
export const INSPECTOR_PENDING_CAP = 100;

/** Expiring live offers removes them from the public catalog; cap how fast an inspector can. */
export const INSPECTOR_EXPIRE_LIMIT: RateLimit = { max: 20, windowSeconds: 60 * 60 };

/** Upper bound for list offsets, so huge numbers cannot reach the database. */
export const MAX_OFFSET = 100_000;

/** Free draws per user per quota day. */
export const DAILY_DRAWS = 3;

/** The quota day starts at midnight Beijing time (UTC+8, no DST). */
export const QUOTA_UTC_OFFSET_MINUTES = 8 * 60;

export const SESSION = Object.freeze({
  /** Cookie and server-side lifetime. Browsers cap cookies at 400 days. */
  ttlDays: 180,
  /** Extend a session (one write) once it is this old, so active users never expire. */
  renewAfterDays: 30,
});
