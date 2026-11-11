/* Pure HTML builders. Data fields are escaped; parameters named `body` are
   trusted markup produced by other builders in this file. */
import { escapeHTML as e } from './escape.js';

const FINEPRINT = (text) => `<p class="dialog-fineprint">${text}</p>`;
const rarityClass = (rarity) => e(String(rarity).toLowerCase());

/**
 * @param {{ kicker: string, title: string, lead: string, body: string }} parts
 * @returns {string}
 */
export function basicDialog({ kicker, title, lead, body }) {
  return `<div class="dialog-inner"><div class="dialog-kicker">${e(kicker)}</div><h2 id="dialogTitle" class="dialog-title">${e(title)}</h2><p class="dialog-lead">${e(lead)}</p>${body}</div>`;
}

/**
 * @param {readonly import('../domain/draw.js').Rarity[]} rarities
 * @returns {string}
 */
export function probabilityDialog(rarities) {
  const rows = rarities
    .map(
      (r) =>
        `<div class="prob-row"><span class="rarity-chip ${rarityClass(r.id)}">${e(r.id)}</span><strong>${Math.round(r.chance * 100)}%</strong></div>`,
    )
    .join('');
  return basicDialog({
    kicker: 'THE ODDS',
    title: '卡池概率',
    lead: '每次打开卡包，将随机发现一张福利卡。',
    body: `${rows}${FINEPRINT('四个主题卡池在当前演示版使用相同概率；不同等级只表示内容的推荐价值，不意味着已获得付费产品、会员资格或代金券。')}<div class="demo-callout">演示版概率由浏览器本地抽取。正式版将由服务端判定抽卡结果，并根据实际可抽库存与资格筛选公示真实概率。</div>`,
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
    body: `<div class="prob-row"><span>每日额度</span><strong>${e(max)} 次</strong></div><div class="prob-row"><span>重置时间</span><strong>设备本地零点</strong></div><div class="prob-row"><span>付费抽卡</span><strong>不提供</strong></div>${FINEPRINT('正式上线后抽取次数由账户系统统一记录；当前阶段使用本地浏览器存储，清理浏览器数据可能重置演示记录。')}`,
  });
}

/**
 * @param {boolean} isFavorite
 * @returns {string}
 */
export function favoriteLabel(isFavorite) {
  return isFavorite ? '已收藏 ✓' : '☆ 收藏到图鉴';
}

/**
 * @param {{ offer: import('../data/offers.js').Offer, poolLabel: string, isFavorite: boolean, canDrawAgain: boolean }} props
 * @returns {string}
 */
export function resultDialog({ offer, poolLabel, isFavorite, canDrawAgain }) {
  const heading = offer.rarity === 'SSR' ? '发现了一张珍稀福利卡！' : '发现一张新的福利卡';
  const label = e(poolLabel);
  return `<div class="dialog-inner"><div class="dialog-kicker">PACK OPENED · ${label}</div><h2 id="dialogTitle" class="dialog-title">${heading}</h2><div class="result-visual rarity-${rarityClass(offer.rarity)}"><span class="result-rank">${e(offer.rarity)}</span><span class="result-icon" aria-hidden="true">${e(offer.icon)}</span><span class="result-sub">${label}</span></div><div class="reward-name">${e(offer.title)}</div><p class="reward-desc">${e(offer.description)}</p><div class="demo-callout">这是交互演示卡片，并非已核验活动。卡牌不等于兑换码或领取资格；正式版会提供官方来源、领取条件与有效期。</div><div class="dialog-actions"><button type="button" class="modal-button" id="favoriteResult">${favoriteLabel(isFavorite)}</button><button type="button" class="modal-button primary" id="nextDraw">${canDrawAgain ? '继续抽卡' : '返回大厅'}</button></div></div>`;
}

/**
 * @param {import('../data/offers.js').Offer} offer
 * @param {boolean} isFavorite
 */
const collectionItem = (offer, isFavorite) =>
  `<div class="collection-item"><span class="small-rank">${e(offer.rarity)}</span><div class="small-icon">${e(offer.icon)}</div><div class="small-name">${e(offer.title)}</div><div class="small-name">${isFavorite ? '★ 已收藏' : '已发现'}</div></div>`;

/**
 * @param {{ seen: readonly import('../data/offers.js').Offer[], total: number, favorites: readonly string[] }} props
 * @returns {string}
 */
export function collectionDialog({ seen, total, favorites }) {
  const list = seen.length
    ? `<div class="collection-grid">${seen.map((o) => collectionItem(o, favorites.includes(o.id))).join('')}</div>`
    : '<div class="empty-state">图鉴里还没有卡牌。<br/>选一个喜欢的福利池，打开你的第一个卡包吧。</div>';
  return basicDialog({
    kicker: 'YOUR COLLECTION',
    title: '我的福利图鉴',
    lead: `已发现 ${seen.length} / ${total} 张演示卡牌 · 收藏 ${favorites.length} 张`,
    body:
      list + FINEPRINT('收藏和抽卡记录仅保存在当前浏览器。后续将接入账号系统同步真实福利图鉴。'),
  });
}

/** @returns {string} */
export function discoverDialog() {
  return basicDialog({
    kicker: 'DISCOVER DEALS',
    title: '发现数字福利',
    lead: '除了开卡包，也能直接检索公开的福利信息。',
    body: `<label for="offerSearch" class="dialog-section-title">搜索演示福利</label><input class="search-input" id="offerSearch" type="search" placeholder="输入 AI、服务器、软件、教育…" autocomplete="off"><div id="offerResults"></div>${FINEPRINT('当前展示的是占位示例，并非在线领取信息。正式版的福利目录将独立提供活动核验、条件筛选与领取教程。')}`,
  });
}

/**
 * @param {readonly import('../data/offers.js').Offer[]} offers
 * @returns {string}
 */
export function offerRows(offers) {
  if (!offers.length) return '<div class="empty-state">没有找到匹配的演示卡牌</div>';
  return offers
    .map(
      (o) =>
        `<div class="offer-row"><strong>${e(o.title)} <span class="rarity-chip ${rarityClass(o.rarity)}" style="min-width:33px;font-size:11px;padding:2px 6px">${e(o.rarity)}</span></strong><small>${e(o.description)} · ${e(o.requirement)}</small></div>`,
    )
    .join('');
}
