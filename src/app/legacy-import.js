/* One-time move of the pre-account browser data (collection and favorites in
   localStorage) to the server. The server decides what is kept; once it has
   answered definitively, the old keys are removed so this never runs again. */
import { COLLECTION_LIMIT, STORAGE_KEYS } from '../config.js';
import { ApiError } from '../api/client.js';
import { loadCollection, loadFavorites } from '../storage/local.js';

/**
 * Refusals that will never change for this data. Anything else (network,
 * 5xx, 429, a refused origin, an edge error page) keeps the data for later.
 */
const FINAL_CODES = new Set([
  'already_imported',
  'invalid_body',
  'invalid_json',
  'payload_too_large',
]);

/** @param {unknown} error */
const isFinalRefusal = (error) => error instanceof ApiError && FINAL_CODES.has(error.code ?? '');

/**
 * @typedef {import('../storage/local.js').Store} Store
 * @typedef {{ collection: { id: string, ts: number }[], favorites: string[] }} LegacyPayload
 */

/**
 * The legacy data worth sending, or null when there is none.
 * @param {Store} store
 * @returns {LegacyPayload | null}
 */
export function readLegacy(store) {
  const collection = loadCollection(store)
    .slice(0, COLLECTION_LIMIT)
    .map(({ id, ts }) => ({ id, ts }));
  const favorites = loadFavorites(store).slice(0, COLLECTION_LIMIT);
  return collection.length || favorites.length ? { collection, favorites } : null;
}

/** @param {Store} store */
function clearLegacy(store) {
  for (const key of Object.values(STORAGE_KEYS)) store.remove(key);
}

/**
 * Import once. Resolves to the number of cards moved (0 when nothing was
 * imported), or null when the outcome is unknown and the data was kept for
 * the next visit.
 * @param {{ store: Store, importLegacy: (payload: LegacyPayload) => Promise<{ imported: number }> }} deps
 * @returns {Promise<number | null>}
 */
export async function importLegacyOnce({ store, importLegacy }) {
  try {
    const payload = readLegacy(store);
    if (!payload) {
      // The old daily counter is meaningless now; drop it with the rest.
      clearLegacy(store);
      return 0;
    }
    const { imported } = await importLegacy(payload);
    clearLegacy(store);
    return imported;
  } catch (error) {
    if (!isFinalRefusal(error)) return null;
    clearLegacy(store);
    return 0;
  }
}
