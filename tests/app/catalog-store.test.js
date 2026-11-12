import { describe, it, expect, vi } from 'vitest';
import { createCatalogStore } from '../../src/app/catalog-store.js';

function setup(load, ttlMs = 1000) {
  let clock = 0;
  const changes = [];
  const store = createCatalogStore({
    load,
    ttlMs,
    now: () => clock,
    onChange: (s) => changes.push(s.status),
  });
  return { store, changes, tick: (ms) => (clock += ms) };
}

describe('createCatalogStore', () => {
  it('goes loading → ready and keeps the offers', async () => {
    const { store, changes } = setup(async () => [{ id: 'a' }]);
    const state = await store.refresh();
    expect(state.status).toBe('ready');
    expect(store.get().offers).toEqual([{ id: 'a' }]);
    expect(changes).toEqual(['loading', 'ready']);
  });

  it('shares one request between concurrent callers', async () => {
    const load = vi.fn(async () => []);
    const { store } = setup(load);
    await Promise.all([store.refresh(), store.refresh(), store.ensureFresh()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the first load fails', async () => {
    const boom = new Error('down');
    const { store } = setup(async () => {
      throw boom;
    });
    const state = await store.refresh();
    expect(state).toMatchObject({ status: 'error', error: boom, offers: [] });
  });

  it('keeps stale offers when a later refresh fails', async () => {
    let fail = false;
    const { store, changes } = setup(async () => {
      if (fail) throw new Error('down');
      return [{ id: 'a' }];
    });
    await store.refresh();
    fail = true;
    const state = await store.refresh();
    expect(state.status).toBe('ready');
    expect(state.offers).toEqual([{ id: 'a' }]);
    expect(state.error).toBeInstanceOf(Error);
    // No flash back to "loading" while refreshing usable data.
    expect(changes).toEqual(['loading', 'ready', 'ready']);
  });

  it('only refetches after the TTL', async () => {
    const load = vi.fn(async () => []);
    const { store, tick } = setup(load, 1000);
    await store.ensureFresh();
    tick(999);
    await store.ensureFresh();
    expect(load).toHaveBeenCalledTimes(1);
    tick(1);
    await store.ensureFresh();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('passes an abort signal to the loader', async () => {
    const load = vi.fn(async (signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return [];
    });
    await setup(load).store.refresh();
    expect(load).toHaveBeenCalledOnce();
  });
});
