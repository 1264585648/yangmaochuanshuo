import { describe, it, expect } from 'vitest';
import { dayKey, normalizeDaily, remainingDraws, consumeDraw } from '../../src/domain/quota.js';

describe('dayKey', () => {
  it('uses the local calendar date with zero padding', () => {
    expect(dayKey(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 10, 11, 23, 59))).toBe('2026-11-11');
  });

  it('rolls over at local midnight', () => {
    expect(dayKey(new Date(2026, 10, 11, 23, 59, 59))).toBe('2026-11-11');
    expect(dayKey(new Date(2026, 10, 12, 0, 0, 0))).toBe('2026-11-12');
  });
});

describe('normalizeDaily', () => {
  const today = '2026-11-11';

  it('keeps a valid record for today by reference', () => {
    const daily = { day: today, used: 2 };
    expect(normalizeDaily(daily, today)).toBe(daily);
  });

  it('resets a record from a previous day', () => {
    expect(normalizeDaily({ day: '2026-11-10', used: 3 }, today)).toEqual({ day: today, used: 0 });
  });

  it.each([
    null,
    undefined,
    'x',
    42,
    [],
    { day: today },
    { day: today, used: -1 },
    { day: today, used: 1.5 },
    { day: today, used: '1' },
  ])('resets corrupted value %j', (raw) => {
    expect(normalizeDaily(raw, today)).toEqual({ day: today, used: 0 });
  });
});

describe('remainingDraws', () => {
  it('counts down and never goes negative', () => {
    expect(remainingDraws({ day: 'd', used: 0 }, 3)).toBe(3);
    expect(remainingDraws({ day: 'd', used: 2 }, 3)).toBe(1);
    expect(remainingDraws({ day: 'd', used: 3 }, 3)).toBe(0);
    expect(remainingDraws({ day: 'd', used: 9 }, 3)).toBe(0);
  });
});

describe('consumeDraw', () => {
  it('returns a new record without mutating the input', () => {
    const before = Object.freeze({ day: 'd', used: 1 });
    const after = consumeDraw(before);
    expect(after).toEqual({ day: 'd', used: 2 });
    expect(after).not.toBe(before);
  });
});
