import { describe, it, expect, vi } from 'vitest';
import {
  createStore,
  getBrowserStorage,
  loadCollection,
  loadFavorites,
} from '../../src/storage/local.js';
import { STORAGE_KEYS } from '../../src/config.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

function withLocalStorage(descriptor, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

describe('createStore', () => {
  it('round-trips JSON', () => {
    const store = createStore(fakeStorage());
    expect(store.write('k', { a: 1 })).toBe(true);
    expect(store.read('k', null)).toEqual({ a: 1 });
  });

  it('removes keys, and reports when storage cannot', () => {
    const data = { k: '1' };
    const store = createStore({
      getItem: (k) => data[k] ?? null,
      setItem: () => {},
      removeItem: (k) => delete data[k],
    });
    expect(store.remove('k')).toBe(true);
    expect(data).toEqual({});
    expect(createStore(fakeStorage()).remove('k')).toBe(false);
    expect(createStore(null).remove('k')).toBe(false);
    const throwing = createStore({
      ...fakeStorage(),
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(throwing.remove('k')).toBe(false);
  });

  it('returns the fallback for missing keys and bad JSON', () => {
    const store = createStore(fakeStorage({ bad: '{nope' }));
    expect(store.read('missing', 'fb')).toBe('fb');
    expect(store.read('bad', 'fb')).toBe('fb');
  });

  it('survives storage that throws', () => {
    const store = createStore({
      getItem: vi.fn(() => {
        throw new Error('denied');
      }),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    });
    expect(store.read('k', 'fb')).toBe('fb');
    expect(store.write('k', 1)).toBe(false);
  });

  it('works with no storage at all', () => {
    const store = createStore(null);
    expect(store.read('k', 'fb')).toBe('fb');
    expect(store.write('k', 1)).toBe(false);
  });
});

describe('getBrowserStorage', () => {
  it('returns null when the accessor throws', () => {
    withLocalStorage(
      {
        get() {
          throw new Error('SecurityError');
        },
      },
      () => expect(getBrowserStorage()).toBeNull(),
    );
  });

  it('returns the storage when available', () => {
    const storage = fakeStorage();
    withLocalStorage({ value: storage }, () => expect(getBrowserStorage()).toBe(storage));
  });
});

const storeWith = (key, raw) => createStore(fakeStorage(raw === undefined ? {} : { [key]: raw }));

describe('loadCollection', () => {
  const load = (raw) => loadCollection(storeWith(STORAGE_KEYS.collection, raw));

  it('defaults to empty', () => {
    expect(load(undefined)).toEqual([]);
  });

  it('rejects non-arrays', () => {
    expect(load('{"id":"a"}')).toEqual([]);
  });

  it('drops malformed entries and keeps valid ones', () => {
    const raw = JSON.stringify([{ id: 'a', ts: 1 }, null, 'x', { id: 2, ts: 1 }, { id: 'b' }]);
    expect(load(raw)).toEqual([{ id: 'a', ts: 1 }]);
  });
});

describe('loadFavorites', () => {
  const load = (raw) => loadFavorites(storeWith(STORAGE_KEYS.favorites, raw));

  it('defaults to empty and rejects non-arrays', () => {
    expect(load(undefined)).toEqual([]);
    expect(load('"a"')).toEqual([]);
  });

  it('keeps only unique strings', () => {
    expect(load(JSON.stringify(['a', 1, null, 'b', 'a']))).toEqual(['a', 'b']);
  });
});
