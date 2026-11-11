import { describe, it, expect } from 'vitest';
import { RARITIES, drawRarity, pickOffer, cryptoRandom } from '../../src/domain/draw.js';

const fixed = (value) => () => value;

describe('RARITIES', () => {
  it('publishes 70 / 25 / 5 and sums to 1', () => {
    expect(RARITIES.map((r) => [r.id, r.chance])).toEqual([
      ['A', 0.7],
      ['S', 0.25],
      ['SSR', 0.05],
    ]);
    const total = RARITIES.reduce((sum, r) => sum + r.chance, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RARITIES)).toBe(true);
    expect(Object.isFrozen(RARITIES[0])).toBe(true);
  });
});

describe('drawRarity', () => {
  it('maps the random value through cumulative thresholds from the table', () => {
    expect(drawRarity(fixed(0))).toBe('A');
    expect(drawRarity(fixed(0.6999))).toBe('A');
    expect(drawRarity(fixed(0.7))).toBe('S');
    expect(drawRarity(fixed(0.9499))).toBe('S');
    expect(drawRarity(fixed(0.95))).toBe('SSR');
    expect(drawRarity(fixed(0.999999))).toBe('SSR');
  });

  it('falls back to the last rarity when the table sums short of 1', () => {
    const table = [
      { id: 'X', chance: 0.1 },
      { id: 'Y', chance: 0.2 },
    ];
    expect(drawRarity(fixed(0.99), table)).toBe('Y');
  });

  it('follows the table, not hardcoded thresholds', () => {
    const table = [
      { id: 'low', chance: 0.5 },
      { id: 'high', chance: 0.5 },
    ];
    expect(drawRarity(fixed(0.49), table)).toBe('low');
    expect(drawRarity(fixed(0.5), table)).toBe('high');
  });

  it('produces the published distribution over many draws', () => {
    let seed = 42;
    const lcg = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const counts = { A: 0, S: 0, SSR: 0 };
    const runs = 100000;
    for (let i = 0; i < runs; i++) counts[drawRarity(lcg)]++;
    expect(Math.abs(counts.A / runs - 0.7)).toBeLessThan(0.01);
    expect(Math.abs(counts.S / runs - 0.25)).toBeLessThan(0.01);
    expect(Math.abs(counts.SSR / runs - 0.05)).toBeLessThan(0.005);
  });
});

describe('pickOffer', () => {
  const offers = [
    { id: 'a1', pool: 'ai', rarity: 'A' },
    { id: 'a2', pool: 'ai', rarity: 'A' },
    { id: 'c1', pool: 'cloud', rarity: 'A' },
    { id: 's1', pool: 'ai', rarity: 'S' },
  ];

  it('picks only from the matching pool and rarity', () => {
    expect(pickOffer(offers, 'ai', 'A', fixed(0)).id).toBe('a1');
    expect(pickOffer(offers, 'ai', 'A', fixed(0.99)).id).toBe('a2');
    expect(pickOffer(offers, 'ai', 'S', fixed(0.5)).id).toBe('s1');
  });

  it('returns null when nothing matches', () => {
    expect(pickOffer(offers, 'education', 'SSR', fixed(0))).toBeNull();
  });

  it('never indexes past the end', () => {
    expect(pickOffer(offers, 'ai', 'A', fixed(1)).id).toBe('a2');
  });
});

describe('cryptoRandom', () => {
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = cryptoRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
