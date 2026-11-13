import { describe, it, expect } from 'vitest';
import {
  normalizePublicPrizes,
  normalizeWonPrize,
  normalizeWonPrizes,
  prizesInStock,
} from '../../src/domain/prize.js';
import { normalizeDrawResult } from '../../src/domain/me.js';

const won = {
  id: 'gift-1',
  title: '会员一个月',
  description: '',
  redeemUrl: 'https://example.com/redeem',
  code: 'CODE-1',
  claimedAt: '2026-11-12T10:00:00Z',
};

const rule = {
  id: 'gift-1',
  title: '会员一个月',
  description: '',
  valueNote: '',
  chance: 0.05,
  total: 3,
  remaining: 1,
  startsAt: null,
  endsAt: null,
};

describe('prize validation', () => {
  it('accepts a won prize and refuses non-https redeem links', () => {
    expect(normalizeWonPrize(won)).toEqual(won);
    expect(normalizeWonPrize({ ...won, redeemUrl: null })?.redeemUrl).toBeNull();
    expect(normalizeWonPrize({ ...won, redeemUrl: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeWonPrize({ ...won, redeemUrl: 'http://example.com' })).toBeNull();
    expect(normalizeWonPrize({ ...won, code: '' })).toBeNull();
    expect(normalizeWonPrize(null)).toBeNull();
  });

  it('drops invalid public rows and filters stock', () => {
    const list = normalizePublicPrizes([
      rule,
      { ...rule, id: 'x', chance: 0 },
      { ...rule, remaining: 4 },
      { ...rule, id: 'gone', remaining: 0 },
    ]);
    expect(list?.map((p) => p.id)).toEqual(['gift-1', 'gone']);
    expect(prizesInStock(list ?? []).map((p) => p.id)).toEqual(['gift-1']);
    expect(normalizePublicPrizes({})).toBeNull();
  });

  it('reads the /api/me/prizes envelope', () => {
    expect(normalizeWonPrizes({ prizes: [won, { bad: true }] })).toEqual([won]);
    expect(normalizeWonPrizes([])).toBeNull();
  });

  it('attaches the prize to a draw result, null when absent', () => {
    const base = {
      draw: {
        id: 'd_1',
        pool: 'ai',
        rarity: 'A',
        createdAt: '2026-11-12T10:00:00Z',
        isNew: true,
        favorite: false,
      },
      offer: {
        id: 'o',
        provider: { id: 'p', name: 'P' },
        pool: 'ai',
        rarity: 'A',
        title: 't',
        retired: true,
      },
      quota: { max: 3, used: 1, day: '2026-11-12', resetsAt: '2026-11-12T16:00:00Z' },
    };
    expect(normalizeDrawResult(base)?.prize).toBeNull();
    expect(normalizeDrawResult({ ...base, prize: won })?.prize).toEqual(won);
  });
});
