/* HTML builders for limited prizes. Every data field is escaped. */
import { escapeHTML as e } from './escape.js';
import { basicDialog } from './views.js';

/**
 * @typedef {import('../domain/prize.js').PublicPrize} PublicPrize
 * @typedef {import('../domain/prize.js').WonPrize} WonPrize
 */

const pct = (chance) => `${Math.round(chance * 10000) / 100}%`;
const date = (iso) => (iso ? String(iso).slice(0, 10) : '');

export const PRIZE_RULES = [
  '每次免费开包，除了正常抽到一张福利卡，还会额外抽一次限定福利，概率见上表；某份福利抽完后不再参与。',
  '同一浏览器身份最多中奖 1 次，同一网络每天最多中奖 1 次。达到上限后仍可正常抽卡，只是不再中限定福利。',
  '限定福利由站长个人提供，与福利的官方提供方无关。兑换码中奖后立即显示，可在「图鉴」中再次查看，请尽快兑换。',
  '兑换码的使用以官方规则为准，无法兑换时请通过「意见反馈」联系我们。',
];

/**
 * @param {{ prize: WonPrize, idPrefix?: string }} props
 * @returns {string}
 */
export function wonPrizeBlock({ prize, idPrefix = 'prize' }) {
  const redeem = prize.redeemUrl
    ? `<a class="modal-button primary" href="${e(prize.redeemUrl)}" target="_blank" rel="noopener noreferrer">去兑换 ↗</a>`
    : '';
  return `<section class="prize-won" aria-label="限定福利"><div class="prize-won-kicker">LIMITED · 限定福利</div><h3 class="prize-won-title">${e(prize.title)}</h3>${prize.description ? `<p class="prize-won-desc">${e(prize.description)}</p>` : ''}<div class="prize-code-row"><code class="prize-code" id="${e(idPrefix)}Code">${e(prize.code)}</code><button type="button" class="modal-button prize-copy" data-copy-code="${e(prize.code)}">复制</button></div>${redeem ? `<div class="dialog-actions">${redeem}</div>` : ''}<p class="dialog-fineprint">中奖时间 ${e(date(prize.claimedAt))}。兑换码只显示给你，也可以在「图鉴」里再次查看。</p></section>`;
}

/** @param {PublicPrize} p */
function prizeRow(p) {
  const stock = p.remaining > 0 ? `剩余 ${e(p.remaining)} / ${e(p.total)} 份` : '已抽完';
  const until = p.endsAt ? `<small>截止 ${e(date(p.endsAt))}</small>` : '';
  return `<li class="prize-row${p.remaining > 0 ? '' : ' is-soldout'}"><div><strong>${e(p.title)}</strong>${p.valueNote ? `<small>${e(p.valueNote)}</small>` : ''}${p.description ? `<p>${e(p.description)}</p>` : ''}</div><div class="prize-row-odds"><b>${pct(p.chance)}</b><small>${stock}</small>${until}</div></li>`;
}

/**
 * Public rules for the limited prizes.
 * @param {{ prizes: readonly PublicPrize[] }} props
 * @returns {string}
 */
export function prizeRulesDialog({ prizes }) {
  const list = prizes.length
    ? `<ul class="prize-list">${prizes.map(prizeRow).join('')}</ul>`
    : '<div class="empty-state">目前没有进行中的限定福利。</div>';
  const inStock = prizes.filter((p) => p.remaining > 0);
  const total = inStock.reduce((sum, p) => sum + p.chance, 0);
  return basicDialog({
    kicker: 'LIMITED PRIZES',
    title: '限定福利',
    lead: inStock.length
      ? `每次开包额外有 ${pct(total)} 的概率获得一份限定福利`
      : '限定福利暂时都抽完了，下一批会在这里公布',
    body: `${list}<div class="dialog-section-title">活动规则</div><ol class="prize-rules">${PRIZE_RULES.map((r) => `<li>${e(r)}</li>`).join('')}</ol>`,
  });
}

/**
 * Section for the collection dialog.
 * @param {readonly WonPrize[]} prizes
 * @returns {string}
 */
export function myPrizesSection(prizes) {
  if (!prizes.length) return '';
  return `<div class="dialog-section-title">我的限定福利</div>${prizes
    .map((prize, i) => wonPrizeBlock({ prize, idPrefix: `myPrize${i}` }))
    .join('')}`;
}

/**
 * Copy a code on click; falls back to selecting it when the clipboard is unavailable.
 * @param {ParentNode} root
 * @param {(message: string) => void} toast
 */
export function bindCopyButtons(root, toast) {
  for (const button of root.querySelectorAll('[data-copy-code]')) {
    button.addEventListener('click', async () => {
      const code = /** @type {HTMLElement} */ (button).dataset.copyCode ?? '';
      try {
        await navigator.clipboard.writeText(code);
        toast('兑换码已复制');
      } catch {
        const node = button.parentElement?.querySelector('.prize-code');
        if (node) window.getSelection()?.selectAllChildren(node);
        toast('请长按或手动复制兑换码');
      }
    });
  }
}
