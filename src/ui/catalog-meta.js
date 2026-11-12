/* Per-page metadata for the catalog: title, description, canonical URL and
   robots policy. The Worker writes it into the HTML head; the browser script
   updates the same tags after client-side navigation. */
import { escapeHTML as e } from './escape.js';
import { poolLabel } from '../data/pools.js';
import { CATALOG_PAGE_SIZE, catalogHref, isIndexable, offerHref } from '../domain/catalog-query.js';

/** @typedef {import('../domain/offer.js').Offer} Offer */
/** @typedef {import('../domain/catalog-query.js').CatalogFilters} CatalogFilters */

/**
 * @typedef {{ kind: 'list', filters: Readonly<CatalogFilters>, total: number }
 *   | { kind: 'detail', offer: Offer } | { kind: 'missing' }} CatalogView
 * @typedef {{ title: string, description: string, path: string | null, robots: string,
 *   status: number }} PageMeta
 */

const SITE = 'DealDex';
/** Share image served from `public/og-image.png`; made absolute with the request origin. */
export const OG_IMAGE_PATH = '/og-image.png';
const TWITTER_CARD = 'summary_large_image';
const GENERIC_DESCRIPTION =
  'DealDex 数字福利目录：AI、云服务器、软件工具与教育优惠，每张注明官方来源与最后核验日期，过期自动下架。';
const MAX_DESCRIPTION = 150;
const INDEX = 'index, follow';
const NOINDEX = 'noindex, follow';

/** @param {string} text */
function clip(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1)}…` : flat;
}

/**
 * Never claims every card is verified: cards state their own verification date.
 * @param {string} label pool label, or '' for the whole catalog
 * @param {number} total
 */
function listDescription(label, total) {
  const tail = '每张注明官方来源与最后核验日期，过期自动下架。';
  if (label) {
    return total > 0
      ? `DealDex ${label}目录：收录 ${total} 张福利，${tail}`
      : `DealDex ${label}目录：${tail}`;
  }
  return total > 0
    ? `DealDex 收录 ${total} 张数字福利，涵盖 AI、云服务器、软件工具与教育优惠，${tail}`
    : GENERIC_DESCRIPTION;
}

/**
 * @param {Readonly<CatalogFilters>} filters
 * @param {number} total
 * @returns {PageMeta}
 */
function listMeta(filters, total) {
  const label = filters.pool ? poolLabel(filters.pool) : '';
  const base = label ? `${label}目录` : '发现优惠 · 数字福利目录';
  const page = filters.page > 1 ? ` · 第 ${filters.page} 页` : '';
  const description = listDescription(label, total);
  const pastEnd = filters.page > 1 && (filters.page - 1) * CATALOG_PAGE_SIZE >= total;
  return {
    title: `${base}${page} | ${SITE}`,
    description,
    path: catalogHref(filters),
    robots: isIndexable(filters) && !pastEnd && total > 0 ? INDEX : NOINDEX,
    status: 200,
  };
}

/**
 * @param {CatalogView} view
 * @returns {PageMeta}
 */
export function catalogMeta(view) {
  if (view.kind === 'list') return listMeta(view.filters, view.total);
  if (view.kind === 'detail') {
    const { offer } = view;
    return {
      title: `${offer.title} · ${offer.provider.name} | ${SITE}`,
      description: clip(`${offer.benefit}。${offer.summary}`),
      path: offerHref(offer.id),
      robots: INDEX,
      status: 200,
    };
  }
  return {
    title: `福利已下架 | ${SITE}`,
    description: '这张福利已过期、失效或不存在。DealDex 只展示仍在有效期内的福利。',
    path: null,
    robots: NOINDEX,
    status: 404,
  };
}

/**
 * Head markup for the server-rendered page.
 * @param {PageMeta} meta
 * @param {string} origin e.g. `https://dealdex.example`
 * @returns {string}
 */
export function headTags(meta, origin) {
  const url = meta.path ? `${origin}${meta.path}` : '';
  const canonical = url
    ? `<link rel="canonical" href="${e(url)}"><meta property="og:url" content="${e(url)}">`
    : '';
  const share = `<meta property="og:image" content="${e(`${origin}${OG_IMAGE_PATH}`)}"><meta name="twitter:card" content="${TWITTER_CARD}">`;
  return `<title>${e(meta.title)}</title><meta name="description" content="${e(meta.description)}"><meta name="robots" content="${e(meta.robots)}">${canonical}<meta property="og:type" content="website"><meta property="og:site_name" content="${SITE}"><meta property="og:title" content="${e(meta.title)}"><meta property="og:description" content="${e(meta.description)}">${share}`;
}

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {string} attr
 * @param {string} key
 * @returns {HTMLElement}
 */
function ensureTag(doc, tag, attr, key) {
  const found = doc.head.querySelector(`${tag}[${attr}="${key}"]`);
  if (found instanceof HTMLElement) return found;
  const el = doc.createElement(tag);
  el.setAttribute(attr, key);
  doc.head.append(el);
  return el;
}

/**
 * Update the live document after client-side navigation.
 * @param {Document} doc
 * @param {PageMeta} meta
 * @param {string} origin
 */
export function applyMeta(doc, meta, origin) {
  doc.title = meta.title;
  ensureTag(doc, 'meta', 'name', 'description').setAttribute('content', meta.description);
  ensureTag(doc, 'meta', 'name', 'robots').setAttribute('content', meta.robots);
  ensureTag(doc, 'meta', 'property', 'og:title').setAttribute('content', meta.title);
  ensureTag(doc, 'meta', 'property', 'og:description').setAttribute('content', meta.description);
  ensureTag(doc, 'meta', 'property', 'og:type').setAttribute('content', 'website');
  ensureTag(doc, 'meta', 'property', 'og:site_name').setAttribute('content', SITE);
  ensureTag(doc, 'meta', 'property', 'og:image').setAttribute(
    'content',
    `${origin}${OG_IMAGE_PATH}`,
  );
  ensureTag(doc, 'meta', 'name', 'twitter:card').setAttribute('content', TWITTER_CARD);
  if (meta.path) {
    const url = `${origin}${meta.path}`;
    ensureTag(doc, 'link', 'rel', 'canonical').setAttribute('href', url);
    ensureTag(doc, 'meta', 'property', 'og:url').setAttribute('content', url);
  } else {
    doc.head.querySelector('link[rel="canonical"]')?.remove();
    doc.head.querySelector('meta[property="og:url"]')?.remove();
  }
}
