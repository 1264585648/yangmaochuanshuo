import { describe, it, expect } from 'vitest';
import {
  catalogCard,
  catalogDetail,
  catalogMissing,
  verifiedDateHTML,
} from '../../src/ui/catalog-cards.js';
import {
  catalogFilters,
  catalogList,
  catalogResults,
  catalogHeading,
  pagination,
} from '../../src/ui/catalog-page.js';
import { OG_IMAGE_PATH, catalogMeta, headTags } from '../../src/ui/catalog-meta.js';
import { normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';

const EVIL = '<img src=x onerror="alert(1)">';
const BREAKOUT = 'x" onmouseover="alert(1)';
const offer = (patch = {}) => normalizeOffer(apiOffer({ id: 'deal-1', ...patch }));
const hostile = offer({
  title: EVIL,
  summary: EVIL,
  benefit: EVIL,
  provider: { id: 'p', name: EVIL },
  conditions: { ...apiOffer({ id: 'x' }).conditions, note: EVIL },
});

/** No raw markup or attribute breakout from data reaches the output. */
function assertSafe(html) {
  expect(html).not.toContain('<img');
  expect(html).not.toContain('" onmouseover=');
  expect(html).not.toContain('" onerror=');
}

describe('verifiedDateHTML', () => {
  it('shows the absolute last-verified date in a machine-readable time element', () => {
    expect(verifiedDateHTML('2026-11-10T08:00:00Z')).toBe(
      '<time datetime="2026-11-10">核验于 2026-11-10</time>',
    );
  });

  it('flags offers that were never verified', () => {
    expect(verifiedDateHTML(null)).toContain('尚未核验');
    expect(verifiedDateHTML('garbage')).toContain('尚未核验');
  });
});

describe('catalogCard', () => {
  it('links the title to the offer page and shows source, official link and verified date', () => {
    const html = catalogCard(offer({ title: 'GPU 赠金', rarity: 'SSR', pool: 'cloud' }));
    expect(html).toContain('<a href="/offers/deal-1" data-route>GPU 赠金</a>');
    expect(html).toContain('href="https://docs.example.com/deal"');
    expect(html).toContain('来源：docs.example.com');
    expect(html).toContain('href="https://www.example.com/deal"');
    expect(html).toContain('核验于 2026-11-10');
    expect(html).toContain('rarity-chip ssr');
    expect(html).toContain('云服务器');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows condition chips, including regions', () => {
    const conditions = { ...offer().conditions, studentOnly: true, regions: ['US'] };
    const html = catalogCard(offer({ conditions }));
    expect(html).toContain('需学生身份');
    expect(html).toContain('限 ');
  });

  it('never links a non-https source', () => {
    const html = catalogCard(offer({ sourceUrl: 'javascript:alert(1)' }));
    expect(html).not.toContain('javascript:');
  });

  it('escapes every data field', () => {
    assertSafe(catalogCard(hostile));
    assertSafe(catalogCard(offer({ id: BREAKOUT })));
  });
});

describe('catalogDetail', () => {
  it('renders a full page for one offer with a way back', () => {
    const html = catalogDetail(offer({ validUntil: '2026-12-31' }));
    expect(html).toContain('data-view="detail"');
    expect(html).toContain('<h1');
    expect(html).toContain('href="/offers" data-route');
    expect(html).toContain('最后核验');
    expect(html).toContain('<time datetime="2026-11-10">');
    expect(html).toContain('有效至 2026-12-31');
    expect(html).toContain('来源：docs.example.com');
    expect(html).toContain('前往官方页面');
  });

  it('escapes every data field', () => {
    assertSafe(catalogDetail(hostile));
  });
});

describe('catalogMissing', () => {
  it('explains that the offer was withdrawn and links back', () => {
    const html = catalogMissing();
    expect(html).toContain('data-view="missing"');
    expect(html).toContain('已下架');
    expect(html).toContain('href="/offers"');
  });
});

describe('catalogFilters', () => {
  it('is a GET form that works without JavaScript and reflects current filters', () => {
    const html = catalogFilters({ pool: 'ai', studentOnly: 'true', q: 'gpu', page: 2 });
    expect(html).toContain('<form class="catalog-filters" method="get" action="/offers"');
    expect(html).toContain('name="q" type="search" value="gpu"');
    expect(html).toMatch(/name="pool" value="ai" checked/);
    expect(html).toMatch(/name="pool" value=""(?! checked)/);
    expect(html).toMatch(/<option value="true" selected>需学生身份<\/option>/);
    expect(html).toContain('name="rarity"');
    expect(html).toContain('name="newUsersOnly"');
    expect(html).toContain('name="requiresPaymentMethod"');
    expect(html).toContain('name="autoRenews"');
    expect(html).toContain('type="submit"');
  });

  it('keeps the search box and pools visible and folds the other filters into 更多筛选', () => {
    const html = catalogFilters({ page: 1 });
    expect(html).toMatch(/<details class="catalog-more"><summary[^>]*>更多筛选<\/summary>/);
    const inside = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    expect(inside).toContain('name="rarity"');
    expect(inside).toContain('name="autoRenews"');
    expect(inside).toContain('type="submit"');
    expect(inside).not.toContain('name="q"');
    expect(inside).not.toContain('name="pool"');
  });

  it.each([[{ rarity: 'SSR' }], [{ newUsersOnly: 'false' }], [{ autoRenews: 'true' }]])(
    'opens 更多筛选 when %o is active',
    (patch) => {
      expect(catalogFilters({ page: 1, ...patch })).toContain(
        '<details class="catalog-more" open>',
      );
    },
  );

  it('keeps 更多筛选 closed for search and pool only', () => {
    expect(catalogFilters({ page: 1, q: 'x', pool: 'ai' })).not.toContain(
      '<details class="catalog-more" open>',
    );
  });

  it('selects "all" when no pool is chosen and escapes the query', () => {
    const html = catalogFilters({ q: BREAKOUT, page: 1 });
    expect(html).toMatch(/name="pool" value="" checked/);
    assertSafe(html);
  });
});

describe('pagination', () => {
  it('links neighbouring pages and keeps filters', () => {
    const html = pagination({ pool: 'ai', page: 2 }, 50, 20);
    expect(html).toContain('href="/offers?pool=ai" data-route rel="prev"');
    expect(html).toContain('href="/offers?pool=ai&amp;page=3" data-route rel="next"');
    expect(html).toContain('第 2 / 3 页');
  });

  it('is omitted for a single page and has no next link on the last page', () => {
    expect(pagination({ page: 1 }, 20, 20)).toBe('');
    expect(pagination({ page: 3 }, 50, 20)).not.toContain('rel="next"');
  });
});

describe('catalogResults / catalogList', () => {
  it('lists cards with a count', () => {
    const html = catalogResults({
      offers: [offer()],
      total: 1,
      filters: { page: 1 },
      pageSize: 20,
    });
    expect(html).toContain('共 1 张');
    expect(html).toContain('class="catalog-grid"');
  });

  it('says the catalog is still being stocked when nothing is published and no filter is set', () => {
    const none = catalogResults({ offers: [], total: 0, filters: { page: 1 }, pageSize: 20 });
    expect(none).toContain('福利还在整理中');
    expect(none).toContain('我们正在逐条核对官方页面，核对完就会上架。');
    expect(none).toContain('href="/"');
    expect(none).toContain('抽卡大厅');
    expect(none).not.toContain('data-route');
    expect(none).not.toContain('没有找到符合条件的福利');
  });

  it.each([
    [{ pool: 'ai', page: 1 }],
    [{ q: 'gpu', page: 1 }],
    [{ rarity: 'SSR', page: 1 }],
    [{ studentOnly: 'true', page: 1 }],
  ])('suggests loosening the filters when %o matches nothing', (filters) => {
    const none = catalogResults({ offers: [], total: 0, filters, pageSize: 20 });
    expect(none).toContain('没有找到符合条件的福利');
    expect(none).not.toContain('福利还在整理中');
  });

  it('shows a way back from a page past the end', () => {
    const past = catalogResults({ offers: [], total: 3, filters: { page: 5 }, pageSize: 20 });
    expect(past).toContain('这一页没有内容');
    expect(past).toContain('href="/offers"');
  });

  it('wraps heading, filters and results in a list view', () => {
    const html = catalogList({ offers: [], total: 0, filters: { pool: 'education', page: 1 } });
    expect(html).toContain('data-view="list"');
    expect(html).toContain('<h1 class="catalog-title" id="catalogTitle" tabindex="-1">教育优惠');
    expect(html).toContain('id="catalogResults"');
  });

  it('names the heading after the pool', () => {
    expect(catalogHeading({ page: 1 })).toBe('发现数字福利');
    expect(catalogHeading({ pool: 'ai', page: 1 })).toBe('AI 福利目录');
  });
});

describe('catalogMeta', () => {
  it('describes the full catalog as indexable', () => {
    const meta = catalogMeta({ kind: 'list', filters: { page: 1 }, total: 12 });
    expect(meta.title).toBe('发现优惠 · 数字福利目录 | 羊毛传说');
    expect(meta.description).toContain('12');
    expect(meta.path).toBe('/offers');
    expect(meta.robots).toBe('index, follow');
    expect(meta.status).toBe(200);
  });

  it('does not claim every card is verified', () => {
    for (const filters of [{ page: 1 }, { pool: 'ai', page: 1 }]) {
      const { description } = catalogMeta({ kind: 'list', filters, total: 12 });
      expect(description).not.toContain('已核验');
      expect(description).toContain('收录 12 张');
      expect(description).toContain('每张注明官方来源与最后核验日期');
    }
  });

  it('uses a generic description for an empty catalog', () => {
    for (const filters of [{ page: 1 }, { pool: 'ai', page: 1 }]) {
      const { description } = catalogMeta({ kind: 'list', filters, total: 0 });
      expect(description).not.toContain('收录 0');
      expect(description).not.toContain('已核验');
      expect(description).toContain('每张注明官方来源与最后核验日期');
    }
  });

  it('names pool pages and later pages, and keeps them indexable', () => {
    const meta = catalogMeta({ kind: 'list', filters: { pool: 'ai', page: 2 }, total: 30 });
    expect(meta.title).toBe('AI 福利目录 · 第 2 页 | 羊毛传说');
    expect(meta.path).toBe('/offers?pool=ai&page=2');
    expect(meta.robots).toBe('index, follow');
  });

  it('keeps searches and pages past the end out of the index', () => {
    expect(catalogMeta({ kind: 'list', filters: { q: 'x', page: 1 }, total: 1 }).robots).toBe(
      'noindex, follow',
    );
    expect(catalogMeta({ kind: 'list', filters: { page: 9 }, total: 1 }).robots).toBe(
      'noindex, follow',
    );
  });

  it('keeps an empty catalog out of the index', () => {
    expect(catalogMeta({ kind: 'list', filters: { page: 1 }, total: 0 }).robots).toBe(
      'noindex, follow',
    );
  });

  it('describes one offer from its own fields', () => {
    const meta = catalogMeta({ kind: 'detail', offer: offer({ title: 'GPU', summary: 's' }) });
    expect(meta.title).toBe('GPU · 示例提供方 | 羊毛传说');
    expect(meta.description).toContain('benefit');
    expect(meta.path).toBe('/offers/deal-1');
    expect(meta.robots).toBe('index, follow');
  });

  it('caps long descriptions', () => {
    const meta = catalogMeta({ kind: 'detail', offer: offer({ summary: '长'.repeat(400) }) });
    expect(meta.description.length).toBeLessThanOrEqual(160);
  });

  it('returns a 404 for a missing offer', () => {
    const meta = catalogMeta({ kind: 'missing' });
    expect(meta.status).toBe(404);
    expect(meta.robots).toBe('noindex, follow');
  });
});

describe('headTags', () => {
  it('emits title, description, canonical, robots and Open Graph tags', () => {
    const meta = catalogMeta({ kind: 'list', filters: { pool: 'ai', page: 2 }, total: 30 });
    const html = headTags(meta, 'https://dealdex.test');
    expect(html).toContain('<title>AI 福利目录 · 第 2 页 | 羊毛传说</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://dealdex.test/offers?pool=ai&amp;page=2">',
    );
    expect(html).toContain('<meta name="robots" content="index, follow">');
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('<meta name="description"');
  });

  it.each([
    ['list', catalogMeta({ kind: 'list', filters: { page: 1 }, total: 3 }), '/offers'],
    ['detail', catalogMeta({ kind: 'detail', offer: offer() }), '/offers/deal-1'],
  ])('emits the full Open Graph and Twitter card set for a %s page', (_, meta, path) => {
    const html = headTags(meta, 'https://dealdex.test');
    expect(html).toContain(`<meta property="og:url" content="https://dealdex.test${path}">`);
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:site_name" content="羊毛传说">');
    expect(html).toContain(`<meta property="og:title" content="${meta.title}">`);
    expect(html).toContain('<meta property="og:description"');
    expect(html).toContain(
      `<meta property="og:image" content="https://dealdex.test${OG_IMAGE_PATH}">`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(OG_IMAGE_PATH).toBe('/og-image.png');
  });

  it('still emits the share image for a missing offer', () => {
    const html = headTags(catalogMeta({ kind: 'missing' }), 'https://dealdex.test');
    expect(html).not.toContain('og:url');
    expect(html).toContain('og:image');
    expect(html).toContain('twitter:card');
  });

  it('escapes offer text', () => {
    const meta = catalogMeta({ kind: 'detail', offer: hostile });
    assertSafe(headTags(meta, 'https://dealdex.test'));
    expect(headTags(meta, 'https://dealdex.test')).not.toContain('<img');
  });
});
