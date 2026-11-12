/* Server-rendered catalog pages: `/offers` and `/offers/<id>`.
 *
 * The HTML shell is the Vite-built `offers.html` (served by the assets binding
 * at `/offers`), so hashed CSS/JS links stay correct. Two comment-delimited
 * regions are replaced: the head (title, description, robots, canonical) and
 * the main content. Markup comes from the same builders the browser uses
 * after client-side navigation, so the two never drift apart.
 */
import {
  parseCatalogParams,
  parseCatalogPath,
  toApiQuery,
} from '../../../src/domain/catalog-query.js';
import { normalizeOffer, type Offer } from '../../../src/domain/offer.js';
import { catalogDetail, catalogMissing } from '../../../src/ui/catalog-cards.js';
import { catalogMeta, headTags, type PageMeta } from '../../../src/ui/catalog-meta.js';
import { catalogList } from '../../../src/ui/catalog-page.js';
import { parseListQuery } from '../domain/query';
import { PUBLIC_CACHE, NO_STORE } from '../http/respond';
import { getPublicOffer, listPublicOffers } from '../repo/offers';

/** `offers.html` is served at its extensionless path by the assets binding. */
export const TEMPLATE_PATH = '/offers';
const READ_METHODS = 'GET, HEAD';

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

function html(body: string, status: number, cache: string): Response {
  return new Response(body, { status, headers: { ...HTML_HEADERS, 'cache-control': cache } });
}

/** Replace `<!--name-->…<!--/name-->` with `content`. Index slicing, so `$` stays literal. */
export function fillRegion(template: string, name: string, content: string): string {
  const open = `<!--${name}-->`;
  const close = `<!--/${name}-->`;
  const start = template.indexOf(open);
  const end = template.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`template region missing: ${name}`);
  return `${template.slice(0, start)}${content}${template.slice(end + close.length)}`;
}

async function loadTemplate(env: Env, url: URL): Promise<string> {
  const res = await env.ASSETS.fetch(new Request(new URL(TEMPLATE_PATH, url)));
  if (!res.ok) throw new Error(`template fetch failed: ${res.status}`);
  return res.text();
}

const toOffers = (rows: unknown[]): Offer[] =>
  rows.map(normalizeOffer).filter((o): o is Offer => o !== null);

interface Rendered {
  meta: PageMeta;
  body: string;
}

async function renderList(db: Env['DB'], url: URL, today: string): Promise<Rendered> {
  const filters = parseCatalogParams(url.searchParams);
  const apiQuery = Object.entries(toApiQuery(filters)).map(([k, v]) => [k, String(v)]);
  const parsed = parseListQuery(new URLSearchParams(apiQuery));
  // toApiQuery only emits values the API accepts; this is a type-level guard.
  if (!parsed.success) throw new Error('catalog query rejected by API schema');
  const { offers, total } = await listPublicOffers(db, parsed.data, today);
  return {
    meta: catalogMeta({ kind: 'list', filters, total }),
    body: catalogList({ offers: toOffers(offers), total, filters }),
  };
}

async function renderDetail(db: Env['DB'], id: string | null, today: string): Promise<Rendered> {
  const row = id ? await getPublicOffer(db, id, today) : null;
  const offer = row ? normalizeOffer(row) : null;
  return offer
    ? { meta: catalogMeta({ kind: 'detail', offer }), body: catalogDetail(offer) }
    : { meta: catalogMeta({ kind: 'missing' }), body: catalogMissing() };
}

/** Handle `/offers` and `/offers/*`. Never throws; errors become HTML responses. */
export async function routeCatalogPage(
  request: Request,
  env: Env,
  url: URL,
  today: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: READ_METHODS, 'cache-control': NO_STORE },
    });
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const target = new URL(url.pathname.replace(/\/+$/, '') + url.search, url);
    return Response.redirect(target.toString(), 301);
  }
  const route = parseCatalogPath(url.pathname) ?? { kind: 'missing' as const };

  let template: string;
  try {
    template = await loadTemplate(env, url);
  } catch (error: unknown) {
    console.error('catalog_template_error', { error: String(error) });
    return new Response('福利目录暂时不可用，请稍后重试。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NO_STORE },
    });
  }

  try {
    const { meta, body } =
      route.kind === 'list'
        ? await renderList(env.DB, url, today)
        : await renderDetail(env.DB, route.kind === 'detail' ? route.id : null, today);
    const page = fillRegion(
      fillRegion(template, 'catalog-head', headTags(meta, url.origin)),
      'catalog-main',
      body,
    );
    return html(page, meta.status, PUBLIC_CACHE);
  } catch (error: unknown) {
    // Serve the bare template: the browser script renders from /api/offers.
    console.error('catalog_render_error', {
      path: url.pathname,
      error: error instanceof Error ? error.stack : String(error),
    });
    return html(template, 503, NO_STORE);
  }
}
