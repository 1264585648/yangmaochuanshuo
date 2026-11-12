import { describe, it, expect } from 'vitest';
import {
  conditionChips,
  formatDate,
  hostOf,
  safeHttpsUrl,
  validityLabel,
  verifiedLabel,
} from '../../src/ui/format.js';

describe('safeHttpsUrl', () => {
  it('allows https and canonicalises', () => {
    expect(safeHttpsUrl('https://Example.com')).toBe('https://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'http://example.com',
    'data:text/html,hi',
    'https://user:pw@example.com',
    '//example.com',
    'not a url',
    42,
    null,
  ])('rejects %s', (value) => {
    expect(safeHttpsUrl(value)).toBeNull();
  });
});

describe('hostOf', () => {
  it('strips www and tolerates bad input', () => {
    expect(hostOf('https://www.example.com/a')).toBe('example.com');
    expect(hostOf('https://docs.example.com')).toBe('docs.example.com');
    expect(hostOf('::')).toBe('');
  });
});

describe('dates', () => {
  const now = new Date('2026-11-11T12:00:00Z');

  it('formats dates and timestamps', () => {
    expect(formatDate('2026-11-05')).toBe('2026-11-05');
    expect(formatDate('2026-11-05T08:00:00Z')).toBe('2026-11-05');
    expect(formatDate(null)).toBe('');
    expect(formatDate('soon')).toBe('');
  });

  it('describes verification recency', () => {
    expect(verifiedLabel('2026-11-11T01:00:00Z', now)).toBe('今天核验');
    expect(verifiedLabel('2026-11-08T12:00:00Z', now)).toBe('3 天前核验');
    expect(verifiedLabel('2026-01-02T00:00:00Z', now)).toBe('核验于 2026-01-02');
    expect(verifiedLabel(null, now)).toBe('尚未核验');
    expect(verifiedLabel('garbage', now)).toBe('尚未核验');
    // Clock skew must not produce negative days.
    expect(verifiedLabel('2026-11-12T00:00:00Z', now)).toBe('今天核验');
  });

  it('describes validity', () => {
    expect(validityLabel('2026-12-31')).toBe('有效至 2026-12-31');
    expect(validityLabel(null)).toBe('长期有效');
  });
});

describe('conditionChips', () => {
  const none = {
    newUsersOnly: false,
    studentOnly: false,
    requiresPaymentMethod: false,
    autoRenews: false,
    regions: [],
    note: '',
  };

  it('is empty when there are no conditions', () => {
    expect(conditionChips(none)).toEqual([]);
  });

  it('flags money-related conditions as warnings', () => {
    const chips = conditionChips({
      ...none,
      newUsersOnly: true,
      studentOnly: true,
      requiresPaymentMethod: true,
      autoRenews: true,
    });
    expect(chips.map((c) => c.label)).toEqual([
      '仅限新用户',
      '需学生身份',
      '需绑定支付方式',
      '到期自动续费',
    ]);
    expect(chips.filter((c) => c.tone === 'warn')).toHaveLength(2);
  });

  it('names up to three regions and summarises the rest', () => {
    const [one] = conditionChips({ ...none, regions: ['JP'] });
    expect(one.label).toMatch(/^限 /);
    const [many] = conditionChips({ ...none, regions: ['US', 'JP', 'DE', 'FR', 'SG'] });
    expect(many.label).toContain('等 5 地');
  });
});
