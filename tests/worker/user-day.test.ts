import { describe, it, expect } from 'vitest';
import { quotaDay, nextReset } from '../../worker/src/users/day';

describe('quota day (Beijing time, UTC+8)', () => {
  it('belongs to the previous day just before 16:00 UTC', () => {
    expect(quotaDay(new Date('2026-11-12T15:59:59.999Z'))).toBe('2026-11-12');
  });

  it('rolls over at 16:00 UTC (Beijing midnight)', () => {
    expect(quotaDay(new Date('2026-11-12T16:00:00Z'))).toBe('2026-11-13');
  });

  it('handles month and year boundaries', () => {
    expect(quotaDay(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });

  it('resets at the next Beijing midnight', () => {
    expect(nextReset(new Date('2026-11-12T03:00:00Z')).toISOString()).toBe(
      '2026-11-12T16:00:00.000Z',
    );
    expect(nextReset(new Date('2026-11-12T16:00:00Z')).toISOString()).toBe(
      '2026-11-13T16:00:00.000Z',
    );
  });
});
