// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createCollectionView } from '../../src/app/collection-view.js';
import { apiOffer } from '../fixtures/offers.js';
import { normalizeOffer } from '../../src/domain/offer.js';

const offer = normalizeOffer(apiOffer({ id: 'a', title: '对话额度' }));
const item = (id) => ({
  id,
  pool: 'ai',
  rarity: 'A',
  createdAt: '2026-11-12T06:00:00Z',
  offer,
  live: true,
});
const collection = {
  cards: [
    {
      offer,
      firstDrawnAt: '2026-11-12T06:00:00Z',
      lastDrawnAt: '2026-11-12T06:00:00Z',
      drawCount: 1,
      favorite: false,
      live: true,
    },
  ],
  progress: {
    live: { found: 1, total: 2 },
    retired: 0,
    byPool: [{ pool: 'ai', found: 1, total: 2 }],
    byRarity: [],
  },
};

/** Mount the controller in a bare host that stands in for the dialog. */
function setup(getHistory) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const toast = vi.fn();
  const view = createCollectionView({
    me: { getCollection: async () => collection, getHistory, getMyPrizes: async () => [] },
    showView: (html) => {
      host.innerHTML = html;
    },
    root: () => host.querySelector('.dialog-inner'),
    poolLabel: (pool) => pool,
    showDetail: vi.fn(),
    toast,
  });
  return { host, toast, view };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const rows = (host) => host.querySelectorAll('.history-row').length;

describe('collection history paging', () => {
  it('appends the next page and removes the button at the end', async () => {
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('d_2')], nextCursor: 'd_2' })
      .mockResolvedValueOnce({ items: [item('d_1')], nextCursor: null });
    const { host, view } = setup(getHistory);
    view.open();
    await flush();
    expect(rows(host)).toBe(1);
    host.querySelector('#historyMore').click();
    await flush();
    expect(getHistory).toHaveBeenLastCalledWith('d_2');
    expect(rows(host)).toBe(2);
    expect(host.querySelector('#historyMore')).toBeNull();
  });

  it('drops a page that arrives after the view was replaced', async () => {
    let finish;
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('d_2')], nextCursor: 'd_2' })
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { host, toast, view } = setup(getHistory);
    view.open();
    await flush();
    host.querySelector('#historyMore').click();
    host.innerHTML = '<div class="dialog-inner"><ol id="historyList"></ol></div>';
    finish({ items: [item('d_1')], nextCursor: null });
    await flush();
    expect(rows(host)).toBe(0);
    expect(toast).not.toHaveBeenCalled();
  });

  it('stays quiet when a page fails after the view was closed', async () => {
    let fail;
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('d_2')], nextCursor: 'd_2' })
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const { host, toast, view } = setup(getHistory);
    view.open();
    await flush();
    host.querySelector('#historyMore').click();
    host.innerHTML = '';
    fail(new Error('offline'));
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the failure while the view is still open', async () => {
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('d_2')], nextCursor: 'd_2' })
      .mockRejectedValueOnce(new Error('offline'));
    const { host, toast, view } = setup(getHistory);
    view.open();
    await flush();
    host.querySelector('#historyMore').click();
    await flush();
    expect(toast).toHaveBeenCalledOnce();
    expect(host.querySelector('#historyMore').disabled).toBe(false);
  });
});
