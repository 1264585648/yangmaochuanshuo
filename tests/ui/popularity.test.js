import { describe, it, expect } from 'vitest';
import { NEW_OFFER_DAYS, popularity, popularityBadge } from '../../src/ui/popularity.js';

const NOW = new Date('2026-11-20T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

describe('popularity', () => {
  it('prefers the real visitor count when the server sent one', () => {
    expect(popularity({ officialVisitors: 23, publishedAt: ago(1) }, NOW)).toEqual({
      kind: 'hot',
      label: '23 人看过官方页面',
    });
  });

  it('labels recently published offers as new', () => {
    expect(
      popularity({ officialVisitors: null, publishedAt: ago(NEW_OFFER_DAYS - 1) }, NOW),
    ).toEqual({ kind: 'new', label: '新上架' });
  });

  it('says nothing for older offers without enough visitors', () => {
    expect(
      popularity({ officialVisitors: null, publishedAt: ago(NEW_OFFER_DAYS) }, NOW),
    ).toBeNull();
    expect(popularity({ officialVisitors: null, publishedAt: null }, NOW)).toBeNull();
    expect(popularity({ officialVisitors: null, publishedAt: 'garbage' }, NOW)).toBeNull();
  });

  it('renders an escaped badge, or nothing', () => {
    expect(popularityBadge({ officialVisitors: 12, publishedAt: null }, NOW)).toBe(
      '<span class="pop-badge is-hot">12 人看过官方页面</span>',
    );
    expect(popularityBadge({ officialVisitors: null, publishedAt: null }, NOW)).toBe('');
  });
});
