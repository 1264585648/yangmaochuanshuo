import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTestDb, type TestDb } from './helpers/db';
import { seedOffers, seedProvider } from './helpers/seed';
import { createHandler } from '../../worker/src/app';

const NOW = new Date('2026-11-11T12:00:00Z');
const ORIGIN = 'https://dealdex.test';
const EVIL = '<script>alert(1)</script>';

let t: TestDb;
let template: string;
let assetPaths: string[] = [];
let assetsDown = false;
let handle: (path: string, init?: RequestInit) => Promise<Response>;
let brokenDb: (path: string) => Promise<Response>;

beforeAll(async () => {
  template = await readFile(resolve(process.cwd(), 'offers.html'), 'utf8');
  t = await createTestDb();
  await seedProvider(t.db);
  await seedOffers(t.db, [
    { id: 'ai-ssr', pool: 'ai', rarity: 'SSR', title: 'GPU 赠金' },
    { id: 'ai-student', pool: 'ai', rarity: 'A', title: 'Student plan', studentOnly: true },
    { id: 'cloud-vps', pool: 'cloud', rarity: 'S', title: 'VPS $& credit' },
    { id: 'hostile-1', pool: 'software', title: EVIL, summary: EVIL },
    { id: 'never-checked', pool: 'education', lastVerifiedAt: null },
    { id: 'ai-expired', pool: 'ai', status: 'expired', title: 'Expired deal' },
    { id: 'ai-draft', pool: 'ai', status: 'draft', title: 'Secret draft' },
    { id: 'ai-past', pool: 'ai', validUntil: '2026-11-10', title: 'Past deal' },
    ...Array.from({ length: 22 }, (_, i) => ({
      id: `bulk-${String(i).padStart(2, '0')}`,
      pool: 'education',
      title: `Bulk ${String(i).padStart(2, '0')}`,
    })),
  ]);
  const app = createHandler({ now: () => NOW });
  const assets = {
    fetch: async (input: Request | string) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assetPaths.push(url.pathname);
      if (assetsDown) return new Response('down', { status: 500 });
      return url.pathname === '/offers'
        ? new Response(template, { headers: { 'content-type': 'text/html' } })
        : new Response('asset');
    },
  };
  const env = { DB: t.db, ASSETS: assets } as unknown as Env;
  handle = (path, init) => app.fetch(new Request(`${ORIGIN}${path}`, init), env);
  const failingDb = {
    prepare: () => {
      throw new Error('db down');
    },
    batch: () => Promise.reject(new Error('db down')),
  };
  const brokenEnv = { DB: failingDb, ASSETS: assets } as unknown as Env;
  brokenDb = (path) => app.fetch(new Request(`${ORIGIN}${path}`), brokenEnv);
}, 60_000);

afterAll(async () => {
  await t?.dispose();
});

const page = async (path: string) => {
  const res = await handle(path);
  return { res, html: await res.text() };
};

describe('GET /offers (server-rendered catalog)', () => {
  it('renders published offers into the page template as HTML', async () => {
    const { res, html } = await page('/offers');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('max-age=');
    expect(html).toContain('<title>发现优惠 · 数字福利目录 | 羊毛传说</title>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/offers">`);
    expect(html).toContain('<meta name="robots" content="index, follow">');
    expect(html).toContain('data-view="list"');
    expect(html).toContain('href="/offers/ai-ssr"');
    expect(html).toContain('共 27 张');
    // Template defaults and markers are replaced, not duplicated.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('<!--catalog-main-->');
    expect(html).not.toContain('正在载入福利目录');
    expect(html).toContain('src="/src/catalog.js"');
  });

  it('shows the source link and last-verified date on every card', async () => {
    const { html } = await page('/offers?pool=ai');
    expect(html).toContain('来源：docs.example.com');
    expect(html).toContain('<time datetime="2026-11-10">核验于 2026-11-10</time>');
    const { html: edu } = await page('/offers?pool=education&q=never');
    expect(edu).toContain('尚未核验');
  });

  it('never lists expired, unpublished or out-of-window offers', async () => {
    const { html } = await page('/offers?pool=ai');
    expect(html).toContain('GPU 赠金');
    for (const hidden of ['Expired deal', 'Secret draft', 'Past deal']) {
      expect(html).not.toContain(hidden);
    }
  });

  it('applies filters from the URL and reflects them in the form', async () => {
    const { res, html } = await page('/offers?pool=ai&studentOnly=true');
    expect(res.status).toBe(200);
    expect(html).toContain('Student plan');
    expect(html).not.toContain('GPU 赠金');
    expect(html).toContain('<title>AI 福利目录 | 羊毛传说</title>');
    expect(html).toMatch(/name="pool" value="ai" checked/);
    expect(html).toContain('<option value="true" selected>需学生身份</option>');
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).toContain(`href="${ORIGIN}/offers?pool=ai&amp;studentOnly=true"`);
  });

  it('ignores unknown and malformed parameters instead of failing', async () => {
    const { res, html } = await page('/offers?utm_source=x&pool=moon&page=-1');
    expect(res.status).toBe(200);
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/offers">`);
  });

  it('paginates with real links', async () => {
    const first = await page('/offers?pool=education');
    expect(first.html).toContain('href="/offers?pool=education&amp;page=2" data-route rel="next"');
    const second = await page('/offers?pool=education&page=2');
    expect(second.html).toContain('第 2 / 2 页');
    expect(second.html).toContain('<title>教育优惠目录 · 第 2 页 | 羊毛传说</title>');
    expect(second.html).toContain('rel="prev"');
  });

  it('escapes offer content and keeps `$` patterns literal', async () => {
    const { html } = await page('/offers?pool=software');
    expect(html).not.toContain(EVIL);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const { html: cloud } = await page('/offers?pool=cloud');
    expect(cloud).toContain('VPS $&amp; credit');
  });

  it('redirects a trailing slash to the canonical path', async () => {
    const res = await handle('/offers/?pool=ai');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/offers?pool=ai`);
    const detail = await handle('/offers/ai-ssr/');
    expect(detail.headers.get('location')).toBe(`${ORIGIN}/offers/ai-ssr`);
  });

  it('answers HEAD and rejects writes', async () => {
    expect((await handle('/offers', { method: 'HEAD' })).status).toBe(200);
    const post = await handle('/offers', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('GET /offers/:id', () => {
  it('renders one offer with its own title, description and canonical URL', async () => {
    const { res, html } = await page('/offers/ai-ssr');
    expect(res.status).toBe(200);
    expect(html).toContain('<title>GPU 赠金 · Example | 羊毛传说</title>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/offers/ai-ssr">`);
    expect(html).toContain('data-view="detail"');
    expect(html).toContain('最后核验');
    expect(html).toContain('href="https://docs.example.com/deal"');
  });

  it.each(['ai-expired', 'ai-draft', 'ai-past', 'no-such-offer', 'Bad_Id', 'a/b'])(
    'returns a noindex 404 page for %s',
    async (id) => {
      const { res, html } = await page(`/offers/${id}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('<meta name="robots" content="noindex, follow">');
      expect(html).toContain('已下架');
      expect(html).not.toContain('rel="canonical"');
    },
  );

  it('escapes hostile offer content in the head and body', async () => {
    const { html } = await page('/offers/hostile-1');
    expect(html).not.toContain(EVIL);
    expect(html).toContain('<title>&lt;script&gt;');
  });
});

describe('failure handling', () => {
  it('falls back to the client-rendered template when the database fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await brokenDb('/offers');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('正在载入福利目录');
    expect(html).toContain('src="/src/catalog.js"');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns a plain 503 when the template itself is unavailable', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assetsDown = true;
    try {
      const res = await handle('/offers');
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('暂时不可用');
    } finally {
      assetsDown = false;
      spy.mockRestore();
    }
  });

  it('fetches the template from the static assets', async () => {
    assetPaths = [];
    await handle('/offers/ai-ssr');
    expect(assetPaths).toEqual(['/offers']);
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('points crawlers at the sitemap and away from the API', async () => {
    const res = await handle('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('Disallow: /api/');
    expect(text).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('lists the home page, the catalog, every pool and every visible offer', async () => {
    const res = await handle('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toMatch(/<urlset[^>]*><url><loc>https:\/\/dealdex\.test\/<\/loc><\/url>/);
    expect(xml).toContain(`<loc>${ORIGIN}/offers</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/offers?pool=cloud</loc>`);
    // lastmod is the later of the last change (seeded 2026-11-01) and the last verification.
    expect(xml).toContain(`<loc>${ORIGIN}/offers/ai-ssr</loc><lastmod>2026-11-10</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/offers/bulk-21</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/offers/never-checked</loc><lastmod>2026-11-01</lastmod>`);
    expect(xml).not.toContain('ai-expired');
    expect(xml).not.toContain('ai-draft');
  });

  it('rejects writes', async () => {
    expect((await handle('/sitemap.xml', { method: 'POST' })).status).toBe(405);
  });
});
