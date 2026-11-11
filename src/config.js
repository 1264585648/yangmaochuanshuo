/** Daily free draws per device. */
export const MAX_DRAWS = 3;

/** Most recent draws kept in the local collection history. */
export const COLLECTION_LIMIT = 100;

/** Pool shown in front on first load (index into POOLS). */
export const DEFAULT_POOL_INDEX = 1;

export const STORAGE_KEYS = Object.freeze({
  daily: 'dealdex-daily-v1',
  collection: 'dealdex-collection-v1',
  favorites: 'dealdex-favorites-v1',
});

export const TIMINGS = Object.freeze({
  toastMs: 2600,
  openMs: 1050,
  openReducedMotionMs: 80,
});
