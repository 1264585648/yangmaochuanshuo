import { describe, it, expect, vi } from 'vitest';
import { createMeStore } from '../../src/app/me-store.js';
import { ApiError } from '../../src/api/client.js';

const HOUR = 60 * 60 * 1000;
const quota = (used, resetsAt) => ({ max: 3, used, day: '2026-11-12', resetsAt });

function setup(load, start = 0) {
  let clock = start;
  const timers = [];
  const changes = [];
  const store = createMeStore({
    load,
    onChange: (state) => changes.push(state),
    now: () => clock,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: vi.fn(),
  });
  return { store, timers, changes, setClock: (t) => (clock = t) };
}

describe('createMeStore', () => {
  it('loads the quota and schedules a refresh just after the reset', async () => {
    const load = vi.fn(async () => ({ user: null, quota: quota(1, 6 * HOUR) }));
    const { store, timers, changes } = setup(load);
    await store.refresh();
    expect(changes[0].status).toBe('loading');
    expect(store.get()).toMatchObject({ status: 'ready', user: null, quota: { used: 1 } });
    expect(timers.at(-1).ms).toBe(6 * HOUR + 1000);
    timers.at(-1).fn();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent refreshes', async () => {
    const load = vi.fn(async () => ({ user: null, quota: quota(0, HOUR) }));
    const { store } = setup(load);
    await Promise.all([store.refresh(), store.refresh()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports errors in words and keeps the last good quota', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ user: null, quota: quota(2, HOUR) })
      .mockRejectedValueOnce(new ApiError('network', 'down'));
    const { store } = setup(load);
    await store.refresh();
    await store.refresh();
    expect(store.get().status).toBe('error');
    expect(store.get().error).toContain('网络连接失败');
    expect(store.get().quota.used).toBe(2);
  });

  it('knows when the quota is stale', async () => {
    const { store, setClock } = setup(async () => ({ user: null, quota: quota(0, HOUR) }));
    expect(store.isStale()).toBe(true);
    await store.refresh();
    expect(store.isStale()).toBe(false);
    setClock(HOUR);
    expect(store.isStale()).toBe(true);
  });

  it('caps the timer for far-away resets and accepts pushed quotas', async () => {
    const { store, timers } = setup(async () => ({ user: null, quota: quota(0, 90 * 24 * HOUR) }));
    await store.refresh();
    expect(timers.at(-1).ms).toBe(24 * HOUR);
    store.applyQuota(quota(3, HOUR));
    expect(store.get().quota.used).toBe(3);
  });

  it('ignores a reply that started before a fresher quota arrived', async () => {
    let finish;
    const load = vi.fn(
      () =>
        new Promise((resolve) => (finish = () => resolve({ user: null, quota: quota(1, HOUR) }))),
    );
    const { store } = setup(load);
    const pending = store.refresh();
    store.applyQuota(quota(2, HOUR));
    finish();
    await pending;
    expect(store.get()).toMatchObject({ status: 'ready', quota: { used: 2 } });
  });

  it('waits at least 30 s when the reset already looks past (client clock ahead)', async () => {
    const { store, timers } = setup(async () => ({ user: null, quota: quota(0, HOUR) }), 2 * HOUR);
    await store.refresh();
    expect(timers.at(-1).ms).toBe(30_000);
  });

  it('retries a failed refresh while the quota is stale', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ user: null, quota: quota(3, HOUR) })
      .mockRejectedValueOnce(new ApiError('network', 'down'))
      .mockResolvedValueOnce({ user: null, quota: quota(0, 25 * HOUR) });
    const { store, timers, setClock } = setup(load);
    await store.refresh();
    setClock(HOUR + 1000);
    timers.at(-1).fn();
    await vi.waitFor(() => expect(store.get().status).toBe('error'));
    expect(timers.at(-1).ms).toBe(30_000);
    timers.at(-1).fn();
    await vi.waitFor(() => expect(store.get().quota.used).toBe(0));
  });
});
