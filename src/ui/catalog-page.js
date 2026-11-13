/* List view of the public catalog: heading, filter form, result grid and
   pagination. The filter form is a plain GET form and pagination is made of
   real links, so the page works and is crawlable without JavaScript; the
   browser script only intercepts them. */
import { escapeHTML as e } from './escape.js';
import { catalogCard } from './catalog-cards.js';
import { POOLS, poolLabel } from '../data/pools.js';
import { RARITY_IDS } from '../domain/offer.js';
import {
  CATALOG_PAGE_SIZE,
  CATALOG_PATH,
  FLAG_KEYS,
  catalogHref,
} from '../domain/catalog-query.js';

/** @typedef {import('../domain/offer.js').Offer} Offer */
/** @typedef {import('../domain/catalog-query.js').CatalogFilters} CatalogFilters */

/** Tri-state condition filters: 不限 / true / false. */
const CONDITION_FILTERS = Object.freeze([
  { key: 'newUsersOnly', label: '新用户', yes: '仅限新用户', no: '老用户也能领' },
  { key: 'studentOnly', label: '学生身份', yes: '需学生身份', no: '无需学生身份' },
  { key: 'requiresPaymentMethod', label: '支付方式', yes: '需绑定支付方式', no: '无需支付方式' },
  { key: 'autoRenews', label: '自动续费', yes: '会自动续费', no: '不自动续费' },
]);

/** Lobby link shown when the catalog itself is empty. */
const LOBBY_HREF = '/';

/**
 * Filters folded into 更多筛选 on narrow screens: rarity and the conditions.
 * @param {Readonly<CatalogFilters>} filters
 * @returns {boolean}
 */
export function hasAdvancedFilters(filters) {
  return Boolean(filters.rarity) || FLAG_KEYS.some((key) => Boolean(filters[key]));
}

/**
 * Any narrowing at all: search, pool, rarity or a condition.
 * @param {Readonly<CatalogFilters>} filters
 * @returns {boolean}
 */
export function hasActiveFilters(filters) {
  return Boolean(filters.q) || Boolean(filters.pool) || hasAdvancedFilters(filters);
}

/**
 * @param {string} value
 * @param {string} label
 * @param {string | undefined} current
 */
const option = (value, label, current) =>
  `<option value="${e(value)}"${(current ?? '') === value ? ' selected' : ''}>${e(label)}</option>`;

/**
 * @param {string} name
 * @param {string} label
 * @param {[string, string][]} options value/label pairs, first is "any".
 * @param {string | undefined} current
 */
const select = (name, label, options, current) =>
  `<label class="catalog-select"><span>${e(label)}</span><select name="${e(name)}">${options.map(([v, l]) => option(v, l, current)).join('')}</select></label>`;

/**
 * @param {Readonly<CatalogFilters>} filters
 * @returns {string}
 */
export function catalogFilters(filters) {
  const pools = [{ id: '', label: '全部' }, ...POOLS]
    .map(
      (p) =>
        `<label class="pool-radio"><input type="radio" name="pool" value="${e(p.id)}"${(filters.pool ?? '') === p.id ? ' checked' : ''}><span class="filter-chip">${e(p.label)}</span></label>`,
    )
    .join('');
  const rarity = select(
    'rarity',
    '稀有度',
    [['', '不限'], ...RARITY_IDS.map((r) => /** @type {[string, string]} */ ([r, r]))],
    filters.rarity,
  );
  const conditions = CONDITION_FILTERS.map((c) =>
    select(
      c.key,
      c.label,
      [
        ['', '不限'],
        ['true', c.yes],
        ['false', c.no],
      ],
      filters[c.key],
    ),
  ).join('');
  return `<form class="catalog-filters" method="get" action="${CATALOG_PATH}" role="search"><label for="catalogSearch" class="sr-only">搜索福利</label><input class="search-input" id="catalogSearch" name="q" type="search" value="${e(filters.q ?? '')}" placeholder="搜索标题、权益或提供方…" autocomplete="off" maxlength="100"><fieldset class="filter-row"><legend class="sr-only">卡池</legend>${pools}</fieldset><details class="catalog-more"${hasAdvancedFilters(filters) ? ' open' : ''}><summary class="filter-chip catalog-more-toggle">更多筛选</summary><div class="catalog-more-body"><fieldset class="catalog-selects"><legend class="sr-only">稀有度与领取条件</legend>${rarity}${conditions}</fieldset><button type="submit" class="modal-button catalog-submit">筛选</button></div></details></form>`;
}

/**
 * Previous / next links. Empty when everything fits on one page.
 * @param {Readonly<CatalogFilters>} filters
 * @param {number} total
 * @param {number} pageSize
 * @returns {string}
 */
export function pagination(filters, total, pageSize) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return '';
  const page = filters.page;
  const link = (target, rel, label) =>
    `<a class="modal-button page-link" href="${e(catalogHref({ ...filters, page: target }))}" data-route rel="${rel}">${label}</a>`;
  const prev = page > 1 ? link(Math.min(page - 1, pages), 'prev', '‹ 上一页') : '';
  const next = page < pages ? link(page + 1, 'next', '下一页 ›') : '';
  return `<nav class="catalog-pagination" aria-label="分页">${prev}<span class="page-status">第 ${page} / ${pages} 页</span>${next}</nav>`;
}

/**
 * @typedef {{ offers: readonly Offer[], total: number, filters: Readonly<CatalogFilters>,
 *   pageSize?: number }} ListData
 * @param {ListData} data
 * @returns {string} Count, cards (or an empty state) and pagination.
 */
export function catalogResults({ offers, total, filters, pageSize = CATALOG_PAGE_SIZE }) {
  const status = `<p class="result-count" id="catalogStatus" role="status">共 ${total} 张</p>`;
  if (offers.length > 0) {
    return `${status}<ul class="catalog-grid">${offers.map((offer) => catalogCard(offer)).join('')}</ul>${pagination(filters, total, pageSize)}`;
  }
  if (total > 0) {
    const first = e(catalogHref({ ...filters, page: 1 }));
    return `${status}<div class="empty-state">这一页没有内容。<br/><a class="text-link" href="${first}" data-route>回到第 1 页</a></div>`;
  }
  if (hasActiveFilters(filters)) {
    return `${status}<div class="empty-state">没有找到符合条件的福利。<br/>换个关键词或放宽筛选试试。</div>`;
  }
  return `${status}<div class="empty-state catalog-empty"><strong class="catalog-empty-title">福利还在整理中</strong><br/>我们正在逐条核对官方页面，核对完就会上架。<br/><a class="text-link" href="${LOBBY_HREF}">回到抽卡大厅</a></div>`;
}

/** @param {Readonly<CatalogFilters>} filters */
export function catalogHeading(filters) {
  return filters.pool ? `${poolLabel(filters.pool)}目录` : '发现数字福利';
}

/**
 * Whole list view: heading, filters and results.
 * @param {ListData} data
 * @returns {string}
 */
export function catalogList(data) {
  return `<div class="catalog-view" data-view="list"><header class="catalog-hero"><div class="dialog-kicker">DISCOVER DEALS</div><h1 class="catalog-title" id="catalogTitle" tabindex="-1">${e(catalogHeading(data.filters))}</h1><p class="dialog-lead">所有已发布且在有效期内的福利都在这里，不必抽卡也能查看。每张卡注明来源与最后核验日期，过期或失效的福利会自动下架。</p></header>${catalogFilters(data.filters)}<div id="catalogResults" class="catalog-results">${catalogResults(data)}</div></div>`;
}
