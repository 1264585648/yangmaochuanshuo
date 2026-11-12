import { describe, it, expect } from 'vitest';
import {
  buildGuideTemplate,
  buildOfferContent,
  diffOfferContent,
  formatApiError,
  isRevertibleAudit,
  parseGuideInput,
  parseListField,
} from '../../src/domain/admin-form.js';

describe('parseListField', () => {
  it('splits commas, spaces and newlines and deduplicates', () => {
    expect(parseListField('us, jp\nUS  de', { upper: true })).toEqual(['US', 'JP', 'DE']);
    expect(parseListField('Example.com, docs.example.com\nexample.com', { lower: true })).toEqual([
      'example.com',
      'docs.example.com',
    ]);
  });
});

describe('parseGuideInput & buildGuideTemplate', () => {
  it('accepts blank as null and rejects invalid JSON or non-objects', () => {
    expect(parseGuideInput('   ')).toEqual({ ok: true, guide: null });
    expect(parseGuideInput('[1, 2]').ok).toBe(false);
    expect(parseGuideInput('{bad').ok).toBe(false);
  });

  it('builds brief and full templates matching rarity', () => {
    const ssr = buildGuideTemplate('SSR');
    expect(ssr.kind).toBe('full');
    expect(Array.isArray(ssr.phases)).toBe(true);

    const s = buildGuideTemplate('S');
    expect(s.kind).toBe('brief');
    expect(s.steps).toHaveLength(3);
  });
});

describe('buildOfferContent & diffOfferContent', () => {
  it('normalizes form values and computes minimal diffs', () => {
    const base = buildOfferContent({
      pool: 'ai',
      rarity: 'S',
      title: 'Title',
      summary: 'Summary',
      benefit: 'Benefit',
      officialUrl: 'https://example.com',
      sourceUrl: 'https://docs.example.com',
      newUsersOnly: true,
      regions: 'us, jp',
      note: 'note',
      validFrom: '',
      validUntil: '2026-12-31',
      guideJson: JSON.stringify(buildGuideTemplate('S')),
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(base.content.validFrom).toBeNull();
    expect(base.content.conditions.regions).toEqual(['US', 'JP']);

    expect(diffOfferContent(base.content, base.content)).toEqual({});

    const updated = {
      ...base.content,
      title: 'Updated Title',
      conditions: { ...base.content.conditions, regions: ['US'] },
    };
    expect(diffOfferContent(base.content, updated)).toEqual({
      title: 'Updated Title',
      conditions: { ...base.content.conditions, regions: ['US'] },
    });

    const sameCopy = structuredClone(base.content);
    expect(diffOfferContent(base.content, sameCopy)).toEqual({});
    const diffKeys = { ...base.content, guide: { kind: 'brief', steps: [] } };
    expect(Object.keys(diffOfferContent(base.content, diffKeys))).toEqual(['guide']);
  });

  it('propagates guide parse errors', () => {
    const res = buildOfferContent({ guideJson: '{broken' });
    expect(res.ok).toBe(false);
  });
});

describe('isRevertibleAudit & formatApiError', () => {
  it('identifies revertible offer audit entries', () => {
    expect(isRevertibleAudit({ entityType: 'offer', action: 'offer.update' })).toBe(true);
    expect(isRevertibleAudit({ entityType: 'offer', action: 'change.apply' })).toBe(true);
    expect(isRevertibleAudit({ entityType: 'offer', action: 'offer.publish' })).toBe(false);
    expect(isRevertibleAudit({ entityType: 'provider', action: 'provider.update' })).toBe(false);
  });

  it('formats API error codes, retryAfter and details', () => {
    expect(
      formatApiError({
        code: 'invalid_body',
        message: 'Bad input',
        retryAfter: 5,
        details: [{ path: 'title', message: 'Required' }],
      }),
    ).toEqual({
      message: '[invalid_body] Bad input（请在 5 秒后重试）',
      details: ['title: Required'],
    });
    expect(formatApiError('plain')).toEqual({ message: 'plain', details: [] });
  });
});
