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

/**
 * Per-IP limits for the draw API. Clearing cookies yields a fresh guest, so
 * these cap how far one address can farm draws. Generous enough for shared
 * campus and office NAT. IPs are only ever stored as keyed hashes.
 */
export const USER_LIMITS = Object.freeze({
  guestsPerIp: Object.freeze({ max: 20, windowSeconds: 60 * 60 }),
  drawsPerIp: Object.freeze({ max: 120, windowSeconds: 60 * 60 }),
  /** Favorite toggles and imports per user. */
  writesPerUser: Object.freeze({ max: 60, windowSeconds: 60 }),
});

/** Daily maintenance run by the cron trigger in wrangler.jsonc. */
export const CLEANUP = Object.freeze({
  /** Rate-limit windows older than this are dropped; must exceed every configured window. */
  rateLimitRetentionSeconds: 24 * 60 * 60,
  /** Guests with no draws, favorites or import are removed once this old. */
  emptyGuestGraceDays: 7,
  /** Rows removed per table per run; leftovers go on the next run. */
  batchSize: 5_000,
});

/** Below this many distinct visitors an offer shows no count, never a made-up one. */
export const POPULARITY_MIN_VISITORS = 10;

/** Feedback submissions per network. */
export const FEEDBACK_LIMIT: RateLimit = Object.freeze({ max: 10, windowSeconds: 60 * 60 });

/** Community QR image: decoded size cap, and the request cap for the base64 upload. */
export const COMMUNITY_QR_MAX_BYTES = 512 * 1024;
export const COMMUNITY_BODY_MAX_BYTES = 768 * 1024;

/** Limited prizes (owner-held redemption codes rolled on each draw). */
export const PRIZE_LIMITS = Object.freeze({
  /** Highest chance per draw for one prize. */
  maxChance: 0.2,
  /** Highest sum of chances over active prizes; the rest of each roll is "no prize". */
  maxTotalChance: 0.2,
  title: 60,
  description: 500,
  valueNote: 60,
  codeMax: 200,
  codesPerUpload: 500,
  /** Safety valve against farming: wins across all prizes per Beijing day. */
  maxWinsPerDay: 30,
});

/** Request cap for a code upload (500 codes of up to 200 characters, JSON-encoded). */
export const PRIZE_CODES_BODY_MAX_BYTES = 160 * 1024;
