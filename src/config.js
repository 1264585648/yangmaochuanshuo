/** Daily limit shown until the server reports the real quota (`GET /api/me`). */
export const DEFAULT_DAILY_DRAWS = 3;

/** Cap on legacy browser entries sent by the one-time import (the server accepts 100). */
export const COLLECTION_LIMIT = 100;

/** Pool shown in front on first load (index into POOLS). */
export const DEFAULT_POOL_INDEX = 1;

/** Pre-account browser data, read once by the legacy import and then removed. */
export const STORAGE_KEYS = Object.freeze({
  daily: 'dealdex-daily-v1',
  collection: 'dealdex-collection-v1',
  favorites: 'dealdex-favorites-v1',
});

export const API = Object.freeze({
  /** Same-origin in production; Vite proxies `/api` to `wrangler dev` locally. */
  baseUrl: '',
  timeoutMs: 8000,
  /** The public API caps `limit` at 100. */
  pageSize: 100,
  /** Upper bound on catalog pages fetched for the lobby (1000 offers). */
  maxPages: 10,
  /** Refresh the catalog before a draw when older than this. Matches API cache. */
  catalogTtlMs: 5 * 60 * 1000,
  searchDebounceMs: 250,
});

export const TIMINGS = Object.freeze({
  toastMs: 2600,
  /** Minimum length of the pack-opening sequence. */
  openMs: 1150,
  openReducedMotionMs: 80,
  dialogExitMs: 200,
  /** Longest entrance animation, after which it is switched off. */
  introMs: 1200,
  swipeThresholdPx: 40,
  /** Matches the `fizzle` animation in styles/motion.css. */
  fizzleMs: 450,
});
