import { describe, it, expect } from 'vitest';
import {
  collectionDialog,
  collectionLoadingDialog,
  collectionUnavailableDialog,
  formatDrawTime,
  historyRows,
  retiredDetailDialog,
} from '../../src/ui/collection-views.js';
import { normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';

const EVIL = '<img src=x onerror="alert(1)">';
const BREAKOUT = 'x" onmouseover="alert(1)';
const label = (pool) => `池:${pool}`;
const assertSafe = (html) => {
  expect(html).not.toContain('<img');
  expect(html).not.toContain('" onmouseover=');
};

const live = normalizeOffer(apiOffer({ id: 'deal-1', title: '对话额度' }));
const retired = {
  id: 'old-1',
  provider: { id: 'p', name: '旧提供方' },
  pool: 'cloud',
  rarity: 'S',
  title: '旧福利',
  retired: true,
};
const card = (offer, extra = {}) => ({
  offer,
  firstDrawnAt: '2026-11-01T00:00:00Z',
  lastDrawnAt: '2026-11-02T00:00:00Z',
  drawCount: 1,
  favorite: false,
  live: true,
  ...extra,
});
const progress = (extra = {}) => ({
  live: { found: 1, total: 5 },
  retired: 0,
  byPool: [
    { pool: 'ai', found: 1, total: 3 },
    { pool: 'cloud', found: 0, total: 2 },
    { pool: 'software', found: 0, total: 0 },
    { pool: 'education', found: 0, total: 0 },
  ],
  byRarity: [],
  ...extra,
});
const historyItem = (extra = {}) => ({
  id: 'd_1',
  pool: 'ai',
  rarity: 'A',
  createdAt: '2026-11-12T06:05:00Z',
  offer: live,
  live: true,
  ...extra,
});

describe('collectionDialog', () => {
  it('shows the empty state and zero progress', () => {
    const html = collectionDialog({
      cards: [],
      progress: progress({ live: { found: 0, total: 5 } }),
      history: { items: [], nextCursor: null },
      poolLabel: label,
    });
    expect(html).toContain('图鉴里还没有卡牌');
    expect(html).toContain('已发现 0 / 5 张有效福利 · 收藏 0 张');
    expect(html).not.toContain('最近抽卡');
  });

  it('shows progress for pools that have cards, with data-driven widths', () => {
    const html = collectionDialog({
      cards: [card(live)],
      progress: progress(),
      history: null,
      poolLabel: label,
    });
    expect(html).toContain('池:ai');
    expect(html).toContain('data-percent="33"');
    expect(html).not.toContain('池:software');
    expect(html).not.toContain('style=');
  });

  it('marks favorites, repeats and retired cards', () => {
    const html = collectionDialog({
      cards: [card(live, { favorite: true, drawCount: 3 }), card(retired, { live: false })],
      progress: progress({ retired: 1 }),
      history: { items: [historyItem()], nextCursor: 'd_0' },
      poolLabel: label,
    });
    expect(html).toContain('收藏 1 张');
    expect(html).toContain('aria-label="已收藏"');
    expect(html).toContain('×3');
    expect(html).toContain('collection-item rarity-s is-retired');
    expect(html).toContain('其中 1 张已下架或过期');
    expect(html).toContain('id="historyMore"');
    expect(html).toContain('Cookie');
  });

  it('says when the history could not load', () => {
    const html = collectionDialog({
      cards: [card(live)],
      progress: progress(),
      history: null,
      poolLabel: label,
    });
    expect(html).toContain('抽卡记录暂时无法载入');
  });

  it('escapes every data field', () => {
    const hostile = { ...retired, id: BREAKOUT, title: EVIL, provider: { id: 'p', name: EVIL } };
    assertSafe(
      collectionDialog({
        cards: [card(hostile, { live: false })],
        progress: progress(),
        history: { items: [historyItem({ offer: hostile, createdAt: EVIL })], nextCursor: null },
        poolLabel: () => EVIL,
      }),
    );
  });
});

describe('history rows', () => {
  it('formats local time and flags retired cards', () => {
    const html = historyRows([historyItem({ live: false, offer: retired })], label);
    expect(html).toContain('is-retired');
    expect(html).toContain('已下架');
    expect(html).toContain('旧福利');
  });

  it('formats draw times as MM-DD HH:mm and tolerates bad input', () => {
    expect(formatDrawTime('2026-11-12T06:05:00Z')).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatDrawTime('not a date')).toBe('');
  });
});

describe('other collection states', () => {
  it('renders loading, unavailable and retired detail views safely', () => {
    expect(collectionLoadingDialog()).toContain('aria-busy="true"');
    const unavailable = collectionUnavailableDialog(EVIL);
    expect(unavailable).toContain('id="collectionRetry"');
    assertSafe(unavailable);
    const detail = retiredDetailDialog({
      offer: retired,
      poolLabel: '云服务器',
      backLabel: '返回图鉴',
    });
    expect(detail).toContain('已下架');
    expect(detail).toContain('id="dialogBack"');
    expect(detail).not.toContain('official-link');
    assertSafe(
      retiredDetailDialog({
        offer: { ...retired, title: EVIL, pool: BREAKOUT },
        poolLabel: EVIL,
        backLabel: EVIL,
      }),
    );
  });
});
