/* HTML builders for the collection (图鉴) dialog. All data fields are escaped;
   parameters named `body` are trusted markup from other builders. */
import { escapeHTML as e } from './escape.js';
import { poolIconSVG } from './icons.js';
import { rarityChip, rarityClass } from './offer-views.js';
import { basicDialog } from './views.js';

/**
 * @typedef {import('../domain/me.js').CollectionCard} CollectionCard
 * @typedef {import('../domain/me.js').Progress} Progress
 * @typedef {import('../domain/me.js').HistoryItem} HistoryItem
 * @typedef {import('../domain/me.js').RetiredOffer} RetiredOffer
 */

const KICKER = 'YOUR COLLECTION';
const TITLE = '我的福利图鉴';
const FINEPRINT = (text) => `<p class="dialog-fineprint">${text}</p>`;
const STORAGE_NOTE =
  '图鉴、收藏和每日次数保存在服务器，通过本浏览器的 Cookie 识别。清除 Cookie 或换设备后将无法找回。';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Local date and time of a draw, e.g. `11-12 14:05`.
 * @param {string} iso
 * @returns {string}
 */
export function formatDrawTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** @param {number} found @param {number} total */
const percent = (found, total) => (total > 0 ? Math.round((found / total) * 100) : 0);

/**
 * @param {Progress} progress
 * @param {(poolId: string) => string} poolLabel
 */
function progressBars(progress, poolLabel) {
  const rows = progress.byPool
    .filter((p) => p.total > 0 || p.found > 0)
    .map(
      (p) =>
        `<li class="progress-row"><span class="progress-label">${e(poolLabel(p.pool))}</span><span class="progress-track" aria-hidden="true"><span class="progress-fill" data-percent="${percent(p.found, p.total)}"></span></span><span class="progress-count">${e(p.found)} / ${e(p.total)}</span></li>`,
    )
    .join('');
  return rows ? `<ul class="progress-list" aria-label="各卡池收集进度">${rows}</ul>` : '';
}

/** @param {CollectionCard} card */
function cardItem(card) {
  const { offer } = card;
  const retired = !card.live;
  const badges = [
    retired ? '<span class="small-badge is-retired">已下架</span>' : '',
    card.drawCount > 1
      ? `<span class="small-badge" aria-label="获得 ${e(card.drawCount)} 次">×${e(card.drawCount)}</span>`
      : '',
    card.favorite ? '<span class="small-fav" aria-label="已收藏">★</span>' : '',
  ].join('');
  return `<li><button type="button" class="collection-item rarity-${rarityClass(offer.rarity)}${retired ? ' is-retired' : ''}" data-offer-id="${e(offer.id)}"><span class="small-rank">${e(offer.rarity)}</span><span class="small-icon">${poolIconSVG(offer.pool)}</span><span class="small-name">${e(offer.title)}</span><span class="small-provider">${e(offer.provider.name)}</span>${badges}</button></li>`;
}

/**
 * Rows for the draw history; also used to append later pages.
 * @param {readonly HistoryItem[]} items
 * @param {(poolId: string) => string} poolLabel
 */
export function historyRows(items, poolLabel) {
  return items
    .map(
      (item) =>
        `<li class="history-row${item.live ? '' : ' is-retired'}"><time datetime="${e(item.createdAt)}">${e(formatDrawTime(item.createdAt))}</time>${rarityChip(item.rarity)}<span class="history-title">${e(item.offer.title)}</span><span class="history-pool">${e(poolLabel(item.pool))}${item.live ? '' : ' · 已下架'}</span></li>`,
    )
    .join('');
}

/**
 * @param {{ items: readonly HistoryItem[], nextCursor: string | null } | null} history
 *   null when the history could not be loaded.
 * @param {(poolId: string) => string} poolLabel
 */
function historySection(history, poolLabel) {
  const title = '<div class="dialog-section-title">最近抽卡</div>';
  if (!history) return `${title}<p class="dialog-fineprint">抽卡记录暂时无法载入。</p>`;
  if (history.items.length === 0) return '';
  const more = history.nextCursor
    ? '<button type="button" class="modal-button history-more" id="historyMore">加载更多</button>'
    : '';
  return `${title}<ol class="history-list" id="historyList">${historyRows(history.items, poolLabel)}</ol>${more}`;
}

/**
 * @param {{ cards: readonly CollectionCard[], progress: Progress,
 *   history: { items: readonly HistoryItem[], nextCursor: string | null } | null,
 *   poolLabel: (poolId: string) => string, prizesHtml?: string }} props `prizesHtml` is
 *   trusted markup for the user's limited prizes.
 * @returns {string}
 */
export function collectionDialog({ cards, progress, history, poolLabel, prizesHtml = '' }) {
  const favorites = cards.filter((c) => c.favorite).length;
  const list = cards.length
    ? `<ul class="collection-grid">${cards.map(cardItem).join('')}</ul>`
    : '<div class="empty-state">图鉴里还没有卡牌。<br/>选一个喜欢的福利池，打开你的第一个卡包吧。</div>';
  const retired = progress.retired
    ? FINEPRINT(
        `其中 ${e(progress.retired)} 张已下架或过期，仍保留在图鉴中，只显示名称；不计入上面的收集进度。`,
      )
    : '';
  return basicDialog({
    kicker: KICKER,
    title: TITLE,
    lead: `已发现 ${progress.live.found} / ${progress.live.total} 张有效福利 · 收藏 ${favorites} 张`,
    body: `${prizesHtml}${progressBars(progress, poolLabel)}${list}${retired}${historySection(history, poolLabel)}${FINEPRINT(STORAGE_NOTE)}`,
  });
}

/** Shown while the collection loads. */
export function collectionLoadingDialog() {
  return basicDialog({
    kicker: KICKER,
    title: TITLE,
    lead: '正在载入你的图鉴…',
    body: '<div class="state-box" role="status" aria-busy="true">载入中…</div>',
  });
}

/** @param {string} message */
export function collectionUnavailableDialog(message) {
  return basicDialog({
    kicker: KICKER,
    title: TITLE,
    lead: '你的图鉴保存在服务器上，没有丢失。',
    body: `<div class="state-box" role="status">${e(message)}</div><div class="dialog-actions"><button type="button" class="modal-button" id="collectionRetry">重试</button></div>`,
  });
}

/**
 * A card that is no longer public: identifying fields only.
 * @param {{ offer: RetiredOffer, poolLabel: string, backLabel: string }} props
 */
export function retiredDetailDialog({ offer, poolLabel, backLabel }) {
  return `<div class="dialog-inner detail-dialog is-retired"><button type="button" class="back-button" id="dialogBack">‹ ${e(backLabel)}</button><div class="dialog-kicker">${e(poolLabel)} · 已下架</div><h2 id="dialogTitle" class="dialog-title">${e(offer.title)}</h2><div class="detail-emblem pool-${e(offer.pool)}" aria-hidden="true">${poolIconSVG(offer.pool)}</div><p class="dialog-lead">${rarityChip(offer.rarity)} ${e(offer.provider.name)}</p>${FINEPRINT('这张福利已下架或过期，原有链接与领取条件不再展示，以免误导。可以去「发现优惠」看看当前有效的福利。')}<div class="dialog-actions"><a class="modal-button" href="/offers">去发现优惠</a></div></div>`;
}
