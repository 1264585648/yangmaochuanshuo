import { STORAGE_KEYS } from '../config.js';

/**
 * @typedef {Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>} StorageLike
 * @typedef {{ read: (key: string, fallback: unknown) => unknown, write: (key: string, value: unknown) => boolean, remove: (key: string) => boolean }} Store
 */

/**
 * Reading `localStorage` itself can throw (blocked cookies, sandboxed iframes).
 * @returns {StorageLike | null}
 */
export function getBrowserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * JSON store that never throws. When storage is unavailable or full the demo
 * keeps running from in-memory state, so failures are reported via return
 * values instead of exceptions.
 * @param {StorageLike | null} storage
 * @returns {Store}
 */
export function createStore(storage) {
  return {
    read(key, fallback) {
      try {
        const raw = storage?.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      if (!storage) return false;
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      if (!storage?.removeItem) return false;
      try {
        storage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** @param {unknown} entry */
const isCollectionEntry = (entry) =>
  entry !== null &&
  typeof entry === 'object' &&
  typeof entry.id === 'string' &&
  Number.isFinite(entry.ts);

/**
 * @param {Store} store
 * @returns {{ id: string, ts: number }[]} Legacy draw history, newest first.
 */
export function loadCollection(store) {
  const raw = store.read(STORAGE_KEYS.collection, []);
  return Array.isArray(raw) ? raw.filter(isCollectionEntry) : [];
}

/**
 * @param {Store} store
 * @returns {string[]}
 */
export function loadFavorites(store) {
  const raw = store.read(STORAGE_KEYS.favorites, []);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id) => typeof id === 'string'))];
}
