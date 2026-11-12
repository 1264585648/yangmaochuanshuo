// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyMeta, catalogMeta } from '../../src/ui/catalog-meta.js';
import { normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';

const ORIGIN = 'https://dealdex.test';
const offer = normalizeOffer(apiOffer({ id: 'deal-1' }));

describe('applyMeta', () => {
  it('keeps Open Graph URL, image and Twitter card in step with client navigation', () => {
    const doc = globalThis.document.implementation.createHTMLDocument('x');
    const prop = (name) =>
      doc.head.querySelector(`meta[property="${name}"]`)?.getAttribute('content');

    applyMeta(doc, catalogMeta({ kind: 'detail', offer }), ORIGIN);
    expect(prop('og:url')).toBe(`${ORIGIN}/offers/deal-1`);
    expect(prop('og:image')).toBe(`${ORIGIN}/og-image.png`);
    expect(prop('og:type')).toBe('website');
    expect(prop('og:site_name')).toBe('羊毛传说');
    expect(doc.head.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe(
      'summary_large_image',
    );

    applyMeta(doc, catalogMeta({ kind: 'list', filters: { page: 1 }, total: 2 }), ORIGIN);
    expect(prop('og:url')).toBe(`${ORIGIN}/offers`);

    applyMeta(doc, catalogMeta({ kind: 'missing' }), ORIGIN);
    expect(prop('og:url')).toBeUndefined();
    expect(doc.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(prop('og:image')).toBe(`${ORIGIN}/og-image.png`);
  });
});
