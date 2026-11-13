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
    body: `${baseRows}${poolTable}${FINEPRINT('某个等级暂时没有有效福利时，该等级的概率按比例分给其余等级，上表即为实际抽取所用的概率。稀有度只表示推荐价值，不代表已获得任何会员、赠金或资格。')}<div class="demo-callout">抽卡在服务器完成，使用的正是上表的概率；结果记录在你的图鉴中。</div>`,
  });
}

/**
 * @param {{ remaining: number | null, max: number }} counts `remaining` is null until loaded.
 * @returns {string}
 */
export function dailyDialog({ remaining, max }) {
  return basicDialog({
    kicker: 'YOUR DAILY PACKS',
    title: '每日免费开包',
    lead: remaining === null ? '正在读取今天的剩余次数…' : `今天还可以打开 ${remaining} 个卡包`,
    body: `<div class="prob-row"><span>每日额度</span><strong>${e(max)} 次</strong></div><div class="prob-row"><span>重置时间</span><strong>北京时间 0 点</strong></div><div class="prob-row"><span>付费抽卡</span><strong>不提供</strong></div>${FINEPRINT('次数由服务器记录，通过本浏览器的 Cookie 识别。福利目录本身全部公开，可在「发现优惠」中直接查看，无需抽卡。')}`,
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

/** @param {Offer} offer @param {boolean} isNew */
function resultHeading(offer, isNew) {
  if (!isNew) return '再次抽到这张福利卡';
  return offer.rarity === 'SSR' ? '发现了一张珍稀福利卡！' : '发现一张新的福利卡';
}

/**
 * @param {{ offer: Offer, poolLabel: string, isFavorite: boolean, canDrawAgain: boolean,
 *   isNew?: boolean, now: Date, prizeHtml?: string }} props `isNew` is false when the card
 *   was already owned. `prizeHtml` is trusted markup for a limited prize won with this draw.
 * @returns {string}
 */
export function resultDialog({
  offer,
  poolLabel,
  isFavorite,
  canDrawAgain,
  isNew = true,
  now,
  prizeHtml = '',
}) {
  const heading = prizeHtml ? '恭喜！额外抽中了一份限定福利' : resultHeading(offer, isNew);
  const fineprint = prizeHtml
    ? '上面的福利卡是公开优惠的索引，领取前请以官方页面的最新规则为准；限定福利的兑换码由站长提供。'
    : '卡牌是公开优惠的索引，本站不发放兑换码或资格。领取前请以官方页面的最新规则为准。';
  return `<div class="dialog-inner result-dialog rarity-${rarityClass(offer.rarity)}"><div class="dialog-kicker">PACK OPENED · ${e(poolLabel)}</div><h2 id="dialogTitle" class="dialog-title">${heading}</h2>${prizeHtml}${revealCard(offer, poolLabel)}<div class="reveal-details">${offerBody(offer, now)}${guideLink(offer)}<div class="dialog-actions">${officialButton(offer)}<button type="button" class="modal-button" id="favoriteResult" aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button><button type="button" class="modal-button" id="nextDraw">${canDrawAgain ? '继续抽卡' : '返回大厅'}</button></div><button type="button" class="text-link report-link" id="reportOffer">信息有误？反馈问题</button>${FINEPRINT(fineprint)}</div></div>`;
}

/**
 * @param {{ offer: Offer, poolLabel: string, isFavorite: boolean, backLabel: string | null, now: Date }} props
 * @returns {string}
 */
export function detailDialog({ offer, poolLabel, isFavorite, backLabel, now }) {
  const back = backLabel
    ? `<button type="button" class="back-button" id="dialogBack">‹ ${e(backLabel)}</button>`
    : '';
  return `<div class="dialog-inner detail-dialog">${back}<div class="dialog-kicker">${e(poolLabel)}</div><h2 id="dialogTitle" class="sr-only">${e(offer.title)}</h2><div class="detail-emblem pool-${e(offer.pool)}" aria-hidden="true">${poolIconSVG(offer.pool)}</div>${offerBody(offer, now)}${guideLink(offer)}<div class="dialog-actions">${officialButton(offer)}<button type="button" class="modal-button" id="favoriteResult" aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button></div><button type="button" class="text-link report-link" id="reportOffer">信息有误？反馈问题</button>${FINEPRINT('领取前请以官方页面的最新规则为准。发现信息过期或有误，点上方「反馈问题」告诉我们。')}</div>`;
}
