/* Pure HTML builders for dialogs. Data fields are escaped; parameters named
   `body` are trusted markup produced by other builders. */
import { escapeHTML as e } from './escape.js';
import { poolIconSVG } from './icons.js';
import { offerBody, officialButton, rarityChip, rarityClass, revealCard } from './offer-views.js';
import { GUIDE_ANCHOR } from './guide-view.js';
import { offerHref } from '../domain/catalog-query.js';

/** @typedef {import('../domain/offer.js').Offer} Offer */

const FINEPRINT = (text) => `<p class="dialog-fineprint">${text}</p>`;
const pct = (chance) => `${Math.round(chance * 1000) / 10}%`;

/**
 * @param {{ kicker: string, title: string, lead: string, body: string }} parts
 * @returns {string}
 */
export function basicDialog({ kicker, title, lead, body }) {
  return `<div class="dialog-inner"><div class="dialog-kicker">${e(kicker)}</div><h2 id="dialogTitle" class="dialog-title">${e(title)}</h2><p class="dialog-lead">${e(lead)}</p>${body}</div>`;
}

/**
 * @typedef {{ label: string, odds: readonly import('../domain/catalog.js').PoolOdds[] }} PoolOddsView
 * @param {{ base: readonly import('../domain/draw.js').Rarity[], pools: readonly PoolOddsView[] | null }} props
 *   `pools` is null while the catalog is not loaded.
 * @returns {string}
 */
export function probabilityDialog({ base, pools }) {
  const baseRows = base
    .map((r) => `<div class="prob-row">${rarityChip(r.id)}<strong>${pct(r.chance)}</strong></div>`)
    .join('');
  const poolTable = pools
    ? `<div class="dialog-section-title">各卡池实际概率</div><table class="odds-table"><thead><tr><th scope="col">卡池</th>${base.map((r) => `<th scope="col">${e(r.id)}</th>`).join('')}</tr></thead><tbody>${pools
        .map(
          (p) =>
            `<tr><th scope="row">${e(p.label)}</th>${base
              .map((r) => {
                const tier = p.odds.find((o) => o.id === r.id);
                return tier
                  ? `<td>${pct(tier.chance)}<small>${tier.count} 张</small></td>`
                  : '<td class="muted">—</td>';
              })
              .join('')}</tr>`,
        )
        .join('')}</tbody></table>`
    : '';
  return basicDialog({
    kicker: 'THE ODDS',
    title: '卡池概率',
    lead: '每次打开卡包，从该卡池当前有效的福利中随机抽取一张。',
    body: `${baseRows}${poolTable}${FINEPRINT('某个等级暂时没有有效福利时，该等级的概率按比例分给其余等级，上表即为实际抽取所用的概率。稀有度只表示推荐价值，不代表已获得任何会员、赠金或资格。')}<div class="demo-callout">当前由浏览器在已发布的福利中抽取，次数记录在本机。服务端抽卡将在后续版本上线。</div>`,
  });
}

/**
 * @param {{ remaining: number, max: number }} counts
 * @returns {string}
 */
export function dailyDialog({ remaining, max }) {
  return basicDialog({
    kicker: 'YOUR DAILY PACKS',
    title: '每日免费开包',
    lead: `今天还可以打开 ${remaining} 个卡包`,
    body: `<div class="prob-row"><span>每日额度</span><strong>${e(max)} 次</strong></div><div class="prob-row"><span>重置时间</span><strong>设备本地零点</strong></div><div class="prob-row"><span>付费抽卡</span><strong>不提供</strong></div>${FINEPRINT('次数记录在当前浏览器，清理浏览器数据会重置。福利目录本身全部公开，可在「发现优惠」中直接查看，无需抽卡。')}`,
  });
}

/**
 * Link to the full guide on the offer page; dialogs are too tall to inline it.
 * List responses omit `guide`, and every public offer must carry one, so only
 * an explicit null (known to have none) hides the link.
 * @param {Offer} offer
 * @returns {string}
 */
export function guideLink(offer) {
  if (offer.guide === null) return '';
  return `<p class="guide-entry"><a class="offer-page-link" href="${e(offerHref(offer.id))}#${GUIDE_ANCHOR}">查看领取攻略 ›</a></p>`;
}

/**
 * @param {boolean} isFavorite
 * @returns {string}
 */
export function favoriteLabel(isFavorite) {
  return isFavorite ? '已收藏 ✓' : '☆ 收藏到图鉴';
}

/**
 * @param {{ offer: Offer, poolLabel: string, isFavorite: boolean, canDrawAgain: boolean, now: Date }} props
 * @returns {string}
 */
export function resultDialog({ offer, poolLabel, isFavorite, canDrawAgain, now }) {
  const heading = offer.rarity === 'SSR' ? '发现了一张珍稀福利卡！' : '发现一张新的福利卡';
  return `<div class="dialog-inner result-dialog rarity-${rarityClass(offer.rarity)}"><div class="dialog-kicker">PACK OPENED · ${e(poolLabel)}</div><h2 id="dialogTitle" class="dialog-title">${heading}</h2>${revealCard(offer, poolLabel)}<div class="reveal-details">${offerBody(offer, now)}${guideLink(offer)}<div class="dialog-actions">${officialButton(offer)}<button type="button" class="modal-button" id="favoriteResult" aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button><button type="button" class="modal-button" id="nextDraw">${canDrawAgain ? '继续抽卡' : '返回大厅'}</button></div>${FINEPRINT('卡牌是公开优惠的索引，本站不发放兑换码或资格。领取前请以官方页面的最新规则为准。')}</div></div>`;
}

/**
 * @param {{ offer: Offer, poolLabel: string, isFavorite: boolean, backLabel: string | null, now: Date }} props
 * @returns {string}
 */
export function detailDialog({ offer, poolLabel, isFavorite, backLabel, now }) {
  const back = backLabel
    ? `<button type="button" class="back-button" id="dialogBack">‹ ${e(backLabel)}</button>`
    : '';
  return `<div class="dialog-inner detail-dialog">${back}<div class="dialog-kicker">${e(poolLabel)}</div><h2 id="dialogTitle" class="sr-only">${e(offer.title)}</h2><div class="detail-emblem pool-${e(offer.pool)}" aria-hidden="true">${poolIconSVG(offer.pool)}</div>${offerBody(offer, now)}${guideLink(offer)}<div class="dialog-actions">${officialButton(offer)}<button type="button" class="modal-button" id="favoriteResult" aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button></div>${FINEPRINT('领取前请以官方页面的最新规则为准。发现信息有误？可通过来源链接核对。')}</div>`;
}

/**
 * @param {Offer} offer
 * @param {boolean} isFavorite
 */
const collectionItem = (offer, isFavorite) =>
  `<li><button type="button" class="collection-item rarity-${rarityClass(offer.rarity)}" data-offer-id="${e(offer.id)}"><span class="small-rank">${e(offer.rarity)}</span><span class="small-icon">${poolIconSVG(offer.pool)}</span><span class="small-name">${e(offer.title)}</span><span class="small-provider">${e(offer.provider.name)}</span>${isFavorite ? '<span class="small-fav" aria-label="已收藏">★</span>' : ''}</button></li>`;

/**
 * @param {{ found: readonly Offer[], missing: number, total: number, favorites: readonly string[] }} props
 * @returns {string}
 */
export function collectionDialog({ found, missing, total, favorites }) {
  const favCount = found.filter((o) => favorites.includes(o.id)).length;
  const list = found.length
    ? `<ul class="collection-grid">${found.map((o) => collectionItem(o, favorites.includes(o.id))).join('')}</ul>`
    : '<div class="empty-state">图鉴里还没有卡牌。<br/>选一个喜欢的福利池，打开你的第一个卡包吧。</div>';
  const gone = missing ? FINEPRINT(`另有 ${missing} 张曾抽到的卡已过期或下架，不再显示。`) : '';
  return basicDialog({
    kicker: 'YOUR COLLECTION',
    title: '我的福利图鉴',
    lead: `已发现 ${found.length} / ${total} 张有效福利 · 收藏 ${favCount} 张`,
    body: `${list}${gone}${FINEPRINT('收藏和抽卡记录保存在当前浏览器。')}`,
  });
}

/**
 * Shown instead of the collection while the catalog is loading or unreachable.
 * @param {string} message
 * @returns {string}
 */
export function collectionUnavailableDialog(message) {
  return basicDialog({
    kicker: 'YOUR COLLECTION',
    title: '我的福利图鉴',
    lead: '你的抽卡记录仍保存在本机。',
    body: `<div class="state-box" role="status">${e(message)}</div>`,
  });
}
