import type { RateLimit } from './write/rate-limit';

/** Pending offers plus pending change requests one inspector may have open at once. */
export const INSPECTOR_PENDING_CAP = 100;

/** Expiring live offers removes them from the public catalog; cap how fast an inspector can. */
export const INSPECTOR_EXPIRE_LIMIT: RateLimit = { max: 20, windowSeconds: 60 * 60 };

/** Upper bound for list offsets, so huge numbers cannot reach the database. */
export const MAX_OFFSET = 100_000;
