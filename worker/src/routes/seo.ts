/* Crawler entry points: `/robots.txt` and `/sitemap.xml`. The sitemap lists the
 * home page, the catalog, each pool page and every publicly visible offer, so
 * search engines find offer pages without running JavaScript, and drop
 * withdrawn ones. An offer's `lastmod` is the later of its last change and its
 * last verification, since both alter the rendered page. */
import { catalogHref, offerHref } from '../../../src/domain/catalog-query.js';
import { formatDate } from '../../../src/ui/format.js';
import { POOLS } from '../domain/schema';
import { listSitemapOffers } from '../repo/offers';

/** Hard cap on offers per sitemap (protocol limit is 50 000 URLs). */
const MAX_SITEMAP_OFFERS = 5000;
const SEO_CACHE = 'public, max-age=300';

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const xml = (value: string) => value.replace(/[&<>"']/g, (ch) => XML_ENTITIES[ch] ?? ch);

export function robotsTxt(url: URL): Response {
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': SEO_CACHE },
  });
}

const entry = (loc: string, lastmod = '') =>
  `<url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}</url>`;

export async function sitemapXml(db: Env['DB'], url: URL, today: string): Promise<Response> {
  const offers = await listSitemapOffers(db, today, MAX_SITEMAP_OFFERS);
  const home = entry(`${url.origin}/`);
  const lists = [{ page: 1 }, ...POOLS.map((pool) => ({ pool, page: 1 }))].map((filters) =>
    entry(`${url.origin}${catalogHref(filters)}`),
  );
  const pages = offers.map((o) =>
    entry(`${url.origin}${offerHref(o.id)}`, formatDate(o.lastModified)),
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[home, ...lists, ...pages].join('')}</urlset>\n`;
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': SEO_CACHE },
  });
}
