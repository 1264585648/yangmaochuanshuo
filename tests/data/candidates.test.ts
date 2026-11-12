import { describe, expect, it } from 'vitest';
import * as schema from '../../worker/src/domain/schema';
import * as urls from '../../worker/src/domain/urls';
import * as guide from '../../worker/src/domain/guide';
import {
  idempotencyKey,
  loadCandidates,
  parseArgs,
  readEnv,
  validateCandidates,
  // @ts-expect-error -- plain ESM script without type declarations
} from '../../scripts/import-candidates.mjs';

interface Entry {
  request: Record<string, unknown> & { id: string };
  review: { fetchedAt: string; evidenceUrls: string[]; quote: string; uncertainties?: string[] };
}

const data = loadCandidates() as { providers: Entry[]; offers: Entry[] };
const domain = { schema, urls, guide };
const MIN_PER_POOL = 10;

describe('candidate catalog', () => {
  it('passes the Worker validators, official-domain checks and guide rule', () => {
    expect(validateCandidates(data, domain)).toEqual([]);
  });

  it('parses every provider and offer with the real schemas', () => {
    for (const p of data.providers) {
      expect(schema.providerSchema.safeParse(p.request).success, p.request.id).toBe(true);
    }
    for (const o of data.offers) {
      const parsed = schema.offerCreateSchema.safeParse(o.request);
      expect(parsed.success, `${o.request.id}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('keeps every official and source link on the provider domains', () => {
    const domains = new Map(
      data.providers.map((p) => [p.request.id, p.request.officialDomains as string[]]),
    );
    for (const o of data.offers) {
      const offer = schema.offerCreateSchema.parse(o.request);
      const allowed = domains.get(offer.providerId) ?? [];
      const links = [
        offer.officialUrl,
        offer.sourceUrl,
        ...Object.values(guide.guideOfficialUrls(offer.guide)),
      ];
      for (const link of links)
        expect(urls.isOfficialUrl(link, allowed), `${offer.id} ${link}`).toBe(true);
    }
  });

  it.each(schema.POOLS)('has at least %s pool candidates', (pool) => {
    const count = data.offers.filter((o) => o.request.pool === pool).length;
    expect(count).toBeGreaterThanOrEqual(MIN_PER_POOL);
  });

  it('records fetch date, evidence and a quote for every offer', () => {
    for (const o of data.offers) {
      expect(o.review.fetchedAt, o.request.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.review.evidenceUrls.length, o.request.id).toBeGreaterThan(0);
      expect(o.review.quote.trim().length, o.request.id).toBeGreaterThan(0);
    }
  });

  it('reports schema, domain and guide problems', () => {
    const bad = structuredClone(data);
    const first = bad.offers[0]!;
    first.request.sourceUrl = 'https://attacker.example/promo';
    first.request.guide = null;
    bad.offers[2]!.request.title = '  untrimmed title ';
    bad.offers.push(structuredClone(bad.offers[1]!));
    const errors = validateCandidates(bad, domain) as string[];
    expect(errors.some((e) => e.includes('sourceUrl'))).toBe(true);
    expect(errors.some((e) => e.includes('guide'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate offer id'))).toBe(true);
    expect(errors.some((e) => e.includes('title not in canonical form'))).toBe(true);
  });
});

describe('import script helpers', () => {
  it('derives deterministic idempotency keys that change with content', () => {
    const body = { id: 'x-offer', title: 'a' };
    const key = idempotencyKey('offer', 'x-offer', body) as string;
    expect(key).toBe(idempotencyKey('offer', 'x-offer', { title: 'a', id: 'x-offer' }));
    expect(key).not.toBe(idempotencyKey('offer', 'x-offer', { ...body, title: 'b' }));
    expect(key).toMatch(/^[A-Za-z0-9_.:-]{1,100}$/);
    const longest = idempotencyKey('provider', 'a'.repeat(64), body) as string;
    expect(longest.length).toBeLessThanOrEqual(100);
  });

  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs(['--dry-run', '--pool', 'ai'])).toEqual({
      dryRun: true,
      pool: 'ai',
      skipProviders: false,
    });
    expect(() => parseArgs(['--pool', 'games'])).toThrow();
    expect(() => parseArgs(['--publish'])).toThrow();
  });

  it('reads base URL and tokens from the environment only', () => {
    expect(() => readEnv({})).toThrow(/DEALDEX_API_BASE/);
    expect(() =>
      readEnv({ DEALDEX_API_BASE: 'http://example.com', DEALDEX_ADMIN_TOKEN: 't' }),
    ).toThrow(/https/);
    expect(() => readEnv({ DEALDEX_API_BASE: 'http://127.0.0.1:8787' })).toThrow(/TOKEN/);
    expect(
      readEnv({ DEALDEX_API_BASE: 'http://127.0.0.1:8787/', DEALDEX_INSPECTOR_TOKEN: 'i' }),
    ).toEqual({ base: 'http://127.0.0.1:8787', admin: null, inspector: 'i' });
  });
});
