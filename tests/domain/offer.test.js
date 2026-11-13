import { describe, it, expect } from 'vitest';
import { normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';

describe('normalizeOffer', () => {
  it('accepts a well-formed API offer and freezes it', () => {
    const offer = normalizeOffer(apiOffer({ id: 'ok', rarity: 'SSR', pool: 'cloud' }));
    expect(offer).toMatchObject({ id: 'ok', rarity: 'SSR', pool: 'cloud' });
    expect(Object.isFrozen(offer)).toBe(true);
    expect(Object.isFrozen(offer.conditions)).toBe(true);
    expect(Object.isFrozen(offer.provider)).toBe(true);
  });

  it.each([
    ['non-object', null],
    ['array', []],
    ['unknown pool', apiOffer({ id: 'x', pool: 'games' })],
    ['unknown rarity', apiOffer({ id: 'x', rarity: 'UR' })],
    ['empty title', apiOffer({ id: 'x', title: '  ' })],
    ['missing benefit', apiOffer({ id: 'x', benefit: undefined })],
    ['oversized text', apiOffer({ id: 'x', summary: 'a'.repeat(501) })],
    ['missing provider', apiOffer({ id: 'x', provider: null })],
    ['provider without name', apiOffer({ id: 'x', provider: { id: 'p' } })],
    ['numeric date', apiOffer({ id: 'x', validUntil: 20261231 })],
    ['missing conditions', apiOffer({ id: 'x', conditions: undefined })],
    [
      'non-boolean flag',
      apiOffer({ id: 'x', conditions: { ...apiOffer({ id: 'y' }).conditions, autoRenews: 'no' } }),
    ],
  ])('rejects %s', (_name, raw) => {
    expect(normalizeOffer(raw)).toBeNull();
  });

  it('drops malformed region codes and defaults note and dates', () => {
    const base = apiOffer({ id: 'r' });
    const offer = normalizeOffer({
      ...base,
      validFrom: undefined,
      lastVerifiedAt: undefined,
      conditions: { ...base.conditions, regions: ['US', 'usa', 3, 'JP'], note: 42 },
    });
    expect(offer.conditions.regions).toEqual(['US', 'JP']);
    expect(offer.conditions.note).toBe('');
    expect(offer.validFrom).toBeNull();
    expect(offer.lastVerifiedAt).toBeNull();
  });

  it('keeps valid interest fields and drops bad ones without rejecting the offer', () => {
    const good = normalizeOffer(
      apiOffer({ id: 'p', publishedAt: '2026-11-12T00:00:00Z', officialVisitors: 12 }),
    );
    expect(good).toMatchObject({ publishedAt: '2026-11-12T00:00:00Z', officialVisitors: 12 });
    for (const officialVisitors of [0, -3, 1.5, '12', null, undefined]) {
      const offer = normalizeOffer(apiOffer({ id: 'p', publishedAt: 5, officialVisitors }));
      expect(offer).toMatchObject({ publishedAt: null, officialVisitors: null });
    }
  });

  it('treats a non-array regions value as unrestricted', () => {
    const base = apiOffer({ id: 'r' });
    const offer = normalizeOffer({ ...base, conditions: { ...base.conditions, regions: 'US' } });
    expect(offer.conditions.regions).toEqual([]);
  });

  it('drops unknown fields', () => {
    const offer = normalizeOffer({ ...apiOffer({ id: 'x' }), status: 'draft', html: '<b>' });
    expect(offer).not.toHaveProperty('status');
    expect(offer).not.toHaveProperty('html');
  });
});
