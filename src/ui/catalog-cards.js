/* Offer cards and the offer page of the public catalog (`/offers`). Rendered
   by the Worker for the first response and by the browser after navigation,
   so both produce identical markup. Every data field is escaped and every
   external link passes `safeHttpsUrl` (inside `externalLink`). */
import { escapeHTML as e } from './escape.js';
import { poolIconSVG } from './icons.js';
import { formatDate, hostOf, validityLabel } from './format.js';
import { chipsHTML, externalLink, rarityChip, rarityClass } from './offer-views.js';
import { guideSection } from './guide-view.js';
import { popularityBadge } from './popularity.js';
import { poolLabel } from '../data/pools.js';
import { CATALOG_PATH, offerHref } from '../domain/catalog-query.js';

/** @typedef {import('../domain/offer.js').Offer} Offer */

/**
 * Absolute date, so a cached page never claims "today" days later.
 * @param {string | null} iso
 * @returns {string}
 */
export function verifiedDateHTML(iso) {
  const date = formatDate(iso);
  if (!date || Number.isNaN(Date.parse(date))) return '<span class="is-stale">尚未核验</span>';
  return `<time datetime="${e(date)}">核验于 ${e(date)}</time>`;
}

/** @param {Offer} offer */
const sourceLink = (offer) =>
  externalLink(offer.sourceUrl, `来源：${hostOf(offer.sourceUrl)}`, 'source-link');

/**
 * Opens the feedback form for this offer. Needs the page script, so it is
 * hidden until the script marks the page (`.js-only`).
 * @param {Offer} offer
 */
const reportButton = (offer) =>
  `<button type="button" class="text-link report-link js-only" data-report-offer="${e(offer.id)}" data-report-title="${e(offer.title)}">信息有误？反馈问题</button>`;

/**
 * One card in the catalog grid.
 * @param {Offer} offer
 * @param {Date} [now]
 * @returns {string}
 */
export function catalogCard(offer, now = new Date()) {
  const official = externalLink(offer.officialUrl, '官方页面', 'catalog-official', offer.id);
  return `<li><article class="catalog-card rarity-${rarityClass(offer.rarity)}"><header class="catalog-card-head"><span class="offer-row-icon pool-${e(offer.pool)}" aria-hidden="true">${poolIconSVG(offer.pool)}</span><div class="catalog-card-heading"><h2 class="catalog-card-title"><a href="${e(offerHref(offer.id))}" data-route>${e(offer.title)}</a></h2><p class="catalog-card-provider">${e(offer.provider.name)} · ${e(poolLabel(offer.pool))} ${rarityChip(offer.rarity, 'mini')}${popularityBadge(offer, now)}</p></div></header><p class="catalog-card-benefit">${e(offer.benefit)}</p>${chipsHTML(offer.conditions)}<footer class="catalog-card-foot"><span class="catalog-verified">${verifiedDateHTML(offer.lastVerifiedAt)}</span><span class="catalog-validity">${e(validityLabel(offer.validUntil))}</span><span class="catalog-links">${sourceLink(offer)}${official}</span></footer></article></li>`;
}

const backLink = `<a class="back-button" href="${CATALOG_PATH}" data-route>‹ 返回福利目录</a>`;

/**
 * Standalone page for one offer.
 * @param {Offer} offer
 * @param {Date} [now]
 * @returns {string}
 */
export function catalogDetail(offer, now = new Date()) {
  const note = offer.conditions.note ? `<p class="cond-note">${e(offer.conditions.note)}</p>` : '';
  const official = externalLink(
    offer.officialUrl,
    '前往官方页面',
    'modal-button primary official-link',
    offer.id,
  );
  return `<div class="catalog-view" data-view="detail">${backLink}<article class="catalog-detail rarity-${rarityClass(offer.rarity)}"><div class="dialog-kicker">${e(poolLabel(offer.pool))}</div><div class="detail-emblem pool-${e(offer.pool)}" aria-hidden="true">${poolIconSVG(offer.pool)}</div><h1 class="catalog-title" id="catalogTitle" tabindex="-1">${e(offer.title)}</h1><p class="reward-provider">${e(offer.provider.name)} ${rarityChip(offer.rarity, 'mini')}${popularityBadge(offer, now)}</p><div class="benefit-box"><span class="benefit-label">你能得到</span><strong>${e(offer.benefit)}</strong></div><p class="reward-desc">${e(offer.summary)}</p><h2 class="dialog-section-title">领取条件</h2>${chipsHTML(offer.conditions)}${note}<dl class="offer-facts"><div><dt>最后核验</dt><dd>${verifiedDateHTML(offer.lastVerifiedAt)}</dd></div><div><dt>有效期</dt><dd>${e(validityLabel(offer.validUntil))}</dd></div></dl>${sourceLink(offer)}${guideSection(offer.guide)}<div class="dialog-actions">${official}</div>${reportButton(offer)}<p class="dialog-fineprint">本站只整理公开优惠信息，不发放兑换码或资格。领取前请以官方页面的最新规则为准；过期或失效的福利会自动下架。</p></article></div>`;
}

/** @returns {string} Body of the 404 page for withdrawn or unknown offers. */
export function catalogMissing() {
  return `<div class="catalog-view" data-view="missing">${backLink}<div class="catalog-missing"><h1 class="catalog-title" id="catalogTitle" tabindex="-1">这张福利已下架或不存在</h1><p class="dialog-lead">福利过期、失效或未通过核验时会自动下架。可以回到目录看看其他仍然有效的福利。</p><a class="modal-button primary" href="${CATALOG_PATH}" data-route>浏览福利目录</a></div></div>`;
}
