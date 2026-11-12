import { describe, it, expect } from 'vitest';
import {
  countByPool,
  drawFromPool,
  poolOdds,
  resolveCollection,
} from '../../src/domain/catalog.js';

const offer = (id, pool, rarity) => ({ id, pool, rarity });
const fixed = (value) => () => value;

const full = [
  offer('a1', 'ai', 'A'),
  offer('a2', 'ai', 'A'),
  offer('s1', 'ai', 'S'),
  offer('x1', 'ai', 'SSR'),
  offer('c1', 'cloud', 'A'),
  offer('c2', 'cloud', 'S'),
];

describe('countByPool', () => {
  it('counts offers per pool', () => {
    expect(countByPool(full)).toEqual({ ai: 4, cloud: 2 });
    expect(countByPool([])).toEqual({});
  });
});

describe('poolOdds', () => {
  it('uses the published table when every tier has cards', () => {
    expect(poolOdds(full, 'ai')).toEqual([
      { id: 'A', chance: 0.7, count: 2 },
      { id: 'S', chance: 0.25, count: 1 },
      { id: 'SSR', chance: 0.05, count: 1 },
    ]);
  });

  it('redistributes missing tiers proportionally and still sums to 1', () => {
    const odds = poolOdds(full, 'cloud');
    expect(odds.map((o) => o.id)).toEqual(['A', 'S']);
    expect(odds[0].chance).toBeCloseTo(0.7 / 0.95, 10);
    expect(odds[1].chance).toBeCloseTo(0.25 / 0.95, 10);
    expect(odds.reduce((sum, o) => sum + o.chance, 0)).toBeCloseTo(1, 10);
  });

  it('is empty for a pool without cards', () => {
    expect(poolOdds(full, 'education')).toEqual([]);
  });

  it('ignores tiers with zero base chance', () => {
    const table = [
      { id: 'A', chance: 1 },
      { id: 'S', chance: 0 },
    ];
    expect(poolOdds(full, 'ai', table)).toEqual([{ id: 'A', chance: 1, count: 2 }]);
  });
});

describe('drawFromPool', () => {
  it('never returns a card from another pool', () => {
    for (const r of [0, 0.5, 0.75, 0.99]) {
      expect(drawFromPool(full, 'cloud', fixed(r)).pool).toBe('cloud');
    }
  });

  it('can always draw when some tier is empty', () => {
    // 0.99 would be SSR under the base table; cloud has none.
    expect(drawFromPool(full, 'cloud', fixed(0.99)).id).toBe('c2');
  });

  it('returns null for an empty pool', () => {
    expect(drawFromPool(full, 'education', fixed(0))).toBeNull();
  });
});

describe('resolveCollection', () => {
  it('keeps unique live offers in recency order and counts the rest as missing', () => {
    const history = [
      { id: 's1', ts: 4 },
      { id: 'gone', ts: 3 },
      { id: 'a1', ts: 2 },
      { id: 's1', ts: 1 },
    ];
    const { found, missing } = resolveCollection(history, full);
    expect(found.map((o) => o.id)).toEqual(['s1', 'a1']);
    expect(missing).toBe(1);
  });
});
