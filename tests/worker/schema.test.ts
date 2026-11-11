import { describe, it, expect } from 'vitest';
import {
  offerCreateSchema,
  offerPatchSchema,
  providerSchema,
} from '../../worker/src/domain/schema';
import { validOffer } from './fixtures';

describe('offerCreateSchema', () => {
  it('accepts a complete valid offer', () => {
    const parsed = offerCreateSchema.parse(validOffer());
    expect(parsed.id).toBe('example-ai-credit');
    expect(parsed.conditions.regions).toEqual([]);
  });

  it('fills condition defaults', () => {
    const input = validOffer();
    input.conditions = {};
    const parsed = offerCreateSchema.parse(input);
    expect(parsed.conditions).toEqual({
      newUsersOnly: false,
      studentOnly: false,
      requiresPaymentMethod: false,
      autoRenews: false,
      regions: [],
      note: '',
    });
  });

  it.each([
    ['status', 'published'],
    ['lastVerifiedAt', '2026-11-11T00:00:00Z'],
    ['createdBy', 'someone'],
    ['version', 9],
  ])('rejects server-controlled field %s (mass assignment)', (field, value) => {
    expect(offerCreateSchema.safeParse({ ...validOffer(), [field]: value }).success).toBe(false);
  });

  it.each([
    ['id', 'Has Spaces'],
    ['id', 'ab'],
    ['pool', 'games'],
    ['rarity', 'UR'],
    ['title', ''],
    ['title', 'x'.repeat(61)],
    ['summary', 'x'.repeat(201)],
    ['officialUrl', 'http://example.com/deal'],
    ['officialUrl', 'javascript:alert(1)'],
    ['officialUrl', 'https://user:pass@example.com/'],
    ['sourceUrl', 'not a url'],
    ['validUntil', '2026-13-01'],
  ])('rejects invalid %s = %j', (field, value) => {
    expect(offerCreateSchema.safeParse({ ...validOffer(), [field]: value }).success).toBe(false);
  });

  it('rejects validUntil before validFrom', () => {
    const input = { ...validOffer(), validFrom: '2026-12-01', validUntil: '2026-11-01' };
    expect(offerCreateSchema.safeParse(input).success).toBe(false);
  });

  it('rejects malformed region codes and unknown condition keys', () => {
    const bad = validOffer();
    bad.conditions = { regions: ['usa'] };
    expect(offerCreateSchema.safeParse(bad).success).toBe(false);
    bad.conditions = { free: true };
    expect(offerCreateSchema.safeParse(bad).success).toBe(false);
  });

  it('trims text fields', () => {
    expect(offerCreateSchema.parse({ ...validOffer(), title: '  Hi  ' }).title).toBe('Hi');
  });
});

describe('offerPatchSchema', () => {
  it('accepts a partial content change', () => {
    expect(offerPatchSchema.parse({ title: 'New' })).toEqual({ title: 'New' });
  });

  it('rejects an empty patch', () => {
    expect(offerPatchSchema.safeParse({}).success).toBe(false);
  });

  it.each(['id', 'status', 'lastVerifiedAt', 'providerId'])('rejects %s', (field) => {
    expect(offerPatchSchema.safeParse({ [field]: 'x' }).success).toBe(false);
  });
});

describe('providerSchema', () => {
  it('normalises domains to lowercase', () => {
    const parsed = providerSchema.parse({
      id: 'example',
      name: 'Example',
      officialDomains: ['Example.COM'],
    });
    expect(parsed.officialDomains).toEqual(['example.com']);
  });

  it.each([[[]], [['https://example.com']], [['*.example.com']], [['localhost']]])(
    'rejects domains %j',
    (officialDomains) => {
      const input = { id: 'example', name: 'Example', officialDomains };
      expect(providerSchema.safeParse(input).success).toBe(false);
    },
  );
});
