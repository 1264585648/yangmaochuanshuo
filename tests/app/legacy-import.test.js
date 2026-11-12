import { describe, it, expect, vi } from 'vitest';
import { importLegacyOnce, readLegacy } from '../../src/app/legacy-import.js';
import { createStore } from '../../src/storage/local.js';
import { STORAGE_KEYS } from '../../src/config.js';
import { ApiError } from '../../src/api/client.js';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const storage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  return { store: createStore(storage), data };
}

const LEGACY = {
  [STORAGE_KEYS.collection]: [{ id: 'a', ts: 1 }, { id: 'bad' }, { id: 'b', ts: 2 }],
  [STORAGE_KEYS.favorites]: ['a', 'a', 7],
  [STORAGE_KEYS.daily]: { day: '2026-11-12', used: 3 },
};

describe('readLegacy', () => {
  it('keeps valid entries only and caps them', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `c${i}`, ts: i }));
    const { store } = memoryStore({ [STORAGE_KEYS.collection]: many });
    expect(readLegacy(store)?.collection).toHaveLength(100);
    expect(readLegacy(memoryStore(LEGACY).store)).toEqual({
      collection: [
        { id: 'a', ts: 1 },
        { id: 'b', ts: 2 },
      ],
      favorites: ['a'],
    });
  });

  it('is null when there is nothing to move', () => {
    expect(readLegacy(memoryStore().store)).toBeNull();
  });
});

describe('importLegacyOnce', () => {
  it('imports and then removes every legacy key', async () => {
    const { store, data } = memoryStore(LEGACY);
    const importLegacy = vi.fn(async () => ({ imported: 2, favorites: 1 }));
    expect(await importLegacyOnce({ store, importLegacy })).toBe(2);
    expect(importLegacy).toHaveBeenCalledOnce();
    expect(data.size).toBe(0);
  });

  it('drops a lone old daily counter without calling the server', async () => {
    const { store, data } = memoryStore({ [STORAGE_KEYS.daily]: { used: 1 } });
    const importLegacy = vi.fn();
    expect(await importLegacyOnce({ store, importLegacy })).toBe(0);
    expect(importLegacy).not.toHaveBeenCalled();
    expect(data.size).toBe(0);
  });

  it.each(['already_imported', 'invalid_body'])('treats %s as final', async (code) => {
    const { store, data } = memoryStore(LEGACY);
    const importLegacy = vi.fn(async () => {
      throw new ApiError('http', 'x', { status: code === 'invalid_body' ? 400 : 409, code });
    });
    expect(await importLegacyOnce({ store, importLegacy })).toBe(0);
    expect(data.size).toBe(0);
  });

  it.each([
    ['network failure', new ApiError('network', 'x')],
    ['refused origin', new ApiError('http', 'x', { status: 403, code: 'forbidden_origin' })],
    ['missing route', new ApiError('http', 'x', { status: 404, code: 'not_found' })],
    ['edge error page', new ApiError('http', 'x', { status: 408 })],
    ['server error', new ApiError('http', 'x', { status: 503 })],
    ['rate limit', new ApiError('http', 'x', { status: 429, code: 'rate_limited' })],
  ])('keeps the data after a %s', async (_label, error) => {
    const { store, data } = memoryStore(LEGACY);
    const importLegacy = vi.fn(async () => {
      throw error;
    });
    expect(await importLegacyOnce({ store, importLegacy })).toBeNull();
    expect(data.size).toBe(3);
  });
});
