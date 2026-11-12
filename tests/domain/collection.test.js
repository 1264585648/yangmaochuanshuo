import { describe, it, expect } from 'vitest';
import { recordDraw, toggleFavorite } from '../../src/domain/collection.js';

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
