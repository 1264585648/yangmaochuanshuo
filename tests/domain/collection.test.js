import { describe, it, expect } from 'vitest';
import {
  recordDraw,
  toggleFavorite,
  discoveredOffers,
  searchOffers,
} from '../../src/domain/collection.js';

const offers = [
  { id: 'a', pool: 'ai', title: 'AI 模型', description: '体验' },
  { id: 'b', pool: 'cloud', title: 'VPS', description: 'Server 折扣' },
];
const pools = [
  { id: 'ai', label: 'AI 福利' },
  { id: 'cloud', label: '云服务器' },
];

describe('recordDraw', () => {
  it('prepends the newest draw without mutating', () => {
    const before = Object.freeze([{ id: 'x', ts: 1 }]);
    expect(recordDraw(before, 'y', 2, 10)).toEqual([
      { id: 'y', ts: 2 },
      { id: 'x', ts: 1 },
    ]);
  });

  it('caps the history length', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, ts: i }));
    const result = recordDraw(many, 'new', 99, 5);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe('new');
    expect(result.at(-1).id).toBe('o3');
  });
});

describe('toggleFavorite', () => {
  it('adds and removes without mutating', () => {
    const added = toggleFavorite(Object.freeze([]), 'a');
    expect(added).toEqual(['a']);
    expect(toggleFavorite(Object.freeze(added), 'a')).toEqual([]);
  });
});

describe('discoveredOffers', () => {
  it('lists unique known offers in first-seen order', () => {
    const history = [
      { id: 'b', ts: 3 },
      { id: 'a', ts: 2 },
      { id: 'b', ts: 1 },
      { id: 'gone', ts: 0 },
    ];
    expect(discoveredOffers(history, offers).map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('searchOffers', () => {
  it('returns everything for an empty query', () => {
    expect(searchOffers(offers, pools, '   ')).toHaveLength(2);
  });

  it('matches title, description and pool label, case-insensitively', () => {
    expect(searchOffers(offers, pools, '模型').map((o) => o.id)).toEqual(['a']);
    expect(searchOffers(offers, pools, 'server').map((o) => o.id)).toEqual(['b']);
    expect(searchOffers(offers, pools, '云服务器').map((o) => o.id)).toEqual(['b']);
  });

  it('does not match against a missing pool label', () => {
    const orphan = [{ id: 'z', pool: 'none', title: 't', description: 'd' }];
    expect(searchOffers(orphan, pools, 'undefined')).toEqual([]);
  });
});
