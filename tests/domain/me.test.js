import { describe, it, expect } from 'vitest';
import {
  normalizeMe,
  normalizeDrawResult,
  normalizeCollection,
  normalizeHistory,
  normalizeOwnedOffer,
  normalizeQuota,
  remainingDraws,
} from '../../src/domain/me.js';
import { apiOffer } from '../fixtures/offers.js';

const QUOTA = { max: 3, used: 1, day: '2026-11-12', resetsAt: '2026-11-12T16:00:00.000Z' };
const RETIRED = {
  id: 'old',
  provider: { id: 'p', name: 'P' },
  pool: 'ai',
  rarity: 'S',
  title: 'Old card',
  retired: true,
};

describe('normalizeQuota', () => {
  it('accepts a valid quota and parses the reset time', () => {
    expect(normalizeQuota(QUOTA)).toEqual({
      max: 3,
      used: 1,
      day: '2026-11-12',
      resetsAt: Date.parse(QUOTA.resetsAt),
    });
  });

  it.each([
    ['negative used', { ...QUOTA, used: -1 }],
    ['fractional max', { ...QUOTA, max: 2.5 }],
    ['bad day', { ...QUOTA, day: '12/11/2026' }],
    ['bad reset', { ...QUOTA, resetsAt: 'soon' }],
    ['not an object', null],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeQuota(raw)).toBeNull();
  });

  it('never reports negative remaining draws', () => {
    expect(remainingDraws({ ...normalizeQuota(QUOTA), used: 5 })).toBe(0);
    expect(remainingDraws(normalizeQuota(QUOTA))).toBe(2);
  });
});

describe('normalizeMe', () => {
  it('accepts an anonymous or guest caller', () => {
    expect(normalizeMe({ user: null, quota: QUOTA })?.user).toBeNull();
    expect(normalizeMe({ user: { id: 'u_1', kind: 'guest' }, quota: QUOTA })?.user).toEqual({
      id: 'u_1',
      kind: 'guest',
    });
  });

  it('rejects malformed users and quotas', () => {
    expect(normalizeMe({ user: { id: 1 }, quota: QUOTA })).toBeNull();
    expect(normalizeMe({ user: null, quota: {} })).toBeNull();
  });
});

describe('normalizeOwnedOffer', () => {
  it('keeps full live offers and retired stubs', () => {
    expect(normalizeOwnedOffer(apiOffer({ id: 'live' }))?.id).toBe('live');
    expect(normalizeOwnedOffer(RETIRED)).toEqual(RETIRED);
  });

  it('rejects a stub with an unknown pool', () => {
    expect(normalizeOwnedOffer({ ...RETIRED, pool: 'games' })).toBeNull();
  });
});

describe('normalizeDrawResult', () => {
  const raw = {
    draw: {
      id: 'd_1',
      pool: 'ai',
      rarity: 'A',
      createdAt: '2026-11-12T03:00:00Z',
      isNew: true,
      favorite: false,
    },
    offer: apiOffer({ id: 'x' }),
    quota: QUOTA,
  };

  it('accepts a full draw result', () => {
    const result = normalizeDrawResult(raw);
    expect(result?.offer.id).toBe('x');
    expect(result?.draw).toMatchObject({ isNew: true, favorite: false });
    expect(result?.quota.used).toBe(1);
  });

  it('rejects results whose offer or flags are malformed', () => {
    expect(normalizeDrawResult({ ...raw, offer: { id: 'x' } })).toBeNull();
    expect(normalizeDrawResult({ ...raw, draw: { ...raw.draw, isNew: 'yes' } })).toBeNull();
  });
});

describe('normalizeCollection', () => {
  const card = (offer, extra = {}) => ({
    offer,
    firstDrawnAt: '2026-11-01T00:00:00Z',
    lastDrawnAt: '2026-11-02T00:00:00Z',
    drawCount: 2,
    favorite: false,
    live: true,
    ...extra,
  });
  const tally = (key, ids) => ids.map((id) => ({ [key]: id, found: 0, total: 1 }));
  const progress = {
    live: { found: 1, total: 4 },
    retired: 1,
    byPool: tally('pool', ['ai', 'cloud', 'software', 'education']),
    byRarity: tally('rarity', ['SSR', 'S', 'A']),
  };

  it('keeps valid cards and drops broken ones', () => {
    const result = normalizeCollection({
      cards: [
        card(apiOffer({ id: 'a' })),
        card(RETIRED, { live: false }),
        card({ id: 'broken' }),
        // The flags disagree: a full offer must not be shown as retired, or vice versa.
        card(apiOffer({ id: 'mismatch' }), { live: false }),
        card(RETIRED),
        card(apiOffer({ id: 'b' }), { drawCount: -1 }),
      ],
      progress,
    });
    expect(result?.cards.map((c) => c.offer.id)).toEqual(['a', 'old']);
    expect(result?.progress.live).toEqual({ found: 1, total: 4 });
  });

  it('rejects a missing progress block', () => {
    expect(normalizeCollection({ cards: [], progress: null })).toBeNull();
  });
});

describe('normalizeHistory', () => {
  it('keeps valid items and the cursor', () => {
    const item = {
      id: 'd_1',
      pool: 'ai',
      rarity: 'A',
      createdAt: '2026-11-12T03:00:00Z',
      offer: apiOffer({ id: 'a' }),
      live: true,
    };
    expect(normalizeHistory({ items: [item, { id: 2 }], nextCursor: 'd_x' })).toEqual({
      items: [expect.objectContaining({ id: 'd_1' })],
      nextCursor: 'd_x',
    });
    expect(normalizeHistory({ items: [], nextCursor: 5 })).toBeNull();
  });
});
