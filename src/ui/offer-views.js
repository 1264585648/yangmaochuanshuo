/* HTML builders for live catalog offers. Every data field is escaped and every
   link passes `safeHttpsUrl` before it reaches an href. */
import { escapeHTML as e } from './escape.js';
import { poolIconSVG, EXTERNAL_ICON } from './icons.js';
import { conditionChips, hostOf, safeHttpsUrl, validityLabel, verifiedLabel } from './format.js';
import { offerHref } from '../domain/catalog-query.js';
import { popularityBadge } from './popularity.js';

/** @typedef {import('../domain/offer.js').Offer} Offer */

export const rarityClass = (rarity) => e(String(rarity).toLowerCase());

/**
 * @param {string} rarity
 * @param {string} [extra]
 */
export const rarityChip = (rarity, extra = '') =>
  `<span class="rarity-chip ${rarityClass(rarity)} ${extra}">${e(rarity)}</span>`;

/**
 * @param {import('../domain/offer.js').Conditions} conditions
 * @returns {string}
 */
export function chipsHTML(conditions) {
  const chips = conditionChips(conditions);
  if (chips.length === 0)
    return '<ul class="cond-chips"><li class="cond-chip ok">无特殊门槛</li></ul>';
  return `<ul class="cond-chips">${chips.map((c) => `<li class="cond-chip ${c.tone}">${e(c.label)}</li>`).join('')}</ul>`;
}

/**
 * @param {string} url
 * @param {string} label
 * @param {string} className
 * @param {string} [offerId] Marks the link as an offer's official page, so a
 *   click is counted (see `src/app/official-clicks.js`).
 * @returns {string} Anchor, or '' when the link is not https.
 */
export function externalLink(url, label, className, offerId) {
  const href = safeHttpsUrl(url);
  if (!href) return '';
  const track = offerId ? ` data-official-offer="${e(offerId)}"` : '';
  return `<a class="${className}" href="${e(href)}" target="_blank" rel="noopener noreferrer"${track}>${e(label)}${EXTERNAL_ICON}<span class="sr-only">（在新窗口打开）</span></a>`;
}

/**
 * Face-down card that flips to reveal the offer. Pure CSS animation.
 * @param {Offer} offer
 * @param {string} poolLabel
 * @returns {string}
 */
export function revealCard(offer, poolLabel) {
  return `<div class="reveal rarity-${rarityClass(offer.rarity)}" aria-hidden="true"><div class="reveal-rays"></div><div class="reveal-card"><div class="reveal-face reveal-back"><span class="reveal-back-mark">✦</span></div><div class="reveal-face reveal-front"><span class="result-rank">${e(offer.rarity)}</span><span class="result-icon">${poolIconSVG(offer.pool)}</span><span class="result-provider">${e(offer.provider.name)}</span><span class="result-sub">${e(poolLabel)}</span></div></div></div>`;
}

/**
 * Title, benefit, conditions, freshness and links shared by result and detail views.
 * @param {Offer} offer
 * @param {Date} now
 * @returns {string}
 */
export function offerBody(offer, now) {
  const verified = verifiedLabel(offer.lastVerifiedAt, now);
  const stale = verified === '尚未核验' ? ' is-stale' : '';
  const note = offer.conditions.note ? `<p class="cond-note">${e(offer.conditions.note)}</p>` : '';
  const source = externalLink(offer.sourceUrl, `来源：${hostOf(offer.sourceUrl)}`, 'source-link');
  const page = `<a class="offer-page-link" href="${e(offerHref(offer.id))}">福利页面（可分享）›</a>`;
  return `<div class="offer-body"><div class="reward-name">${e(offer.title)}</div><div class="reward-provider">${e(offer.provider.name)} ${rarityChip(offer.rarity, 'mini')}${popularityBadge(offer, now)}</div><div class="benefit-box"><span class="benefit-label">你能得到</span><strong>${e(offer.benefit)}</strong></div><p class="reward-desc">${e(offer.summary)}</p><div class="dialog-section-title">领取条件</div>${chipsHTML(offer.conditions)}${note}<dl class="offer-facts"><div><dt>核验</dt><dd class="${stale.trim()}">${e(verified)}</dd></div><div><dt>有效期</dt><dd>${e(validityLabel(offer.validUntil))}</dd></div></dl><div class="offer-links">${source}${page}</div></div>`;
}

/**
 * @param {Offer} offer
 * @returns {string}
 */
export function officialButton(offer) {
  return externalLink(
    offer.officialUrl,
    '前往官方页面',
    'modal-button primary official-link',
    offer.id,
  );
}

/** @param {number} n */
export const skeletonRows = (n) =>
  `<ul class="offer-list" aria-hidden="true">${'<li class="skeleton-row"><span class="sk sk-icon"></span><span class="sk-lines"><span class="sk sk-line w70"></span><span class="sk sk-line w45"></span></span></li>'.repeat(n)}</ul>`;

/**
 * @param {string} message
 * @param {string} retryId
 */
export const errorState = (message, retryId) =>
  `<div class="state-box error" role="alert"><p>${e(message)}</p><button type="button" class="modal-button" id="${e(retryId)}">重新加载</button></div>`;
