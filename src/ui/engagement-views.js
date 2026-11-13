/* Dialog markup for feedback and the community group. Every dynamic value is
   escaped; the QR `src` and the link were checked by the client normalizer. */
import { escapeHTML as e } from './escape.js';
import { EXTERNAL_ICON } from './icons.js';
import { formatDate } from './format.js';

/** Categories the server accepts, with their labels. Order is display order. */
export const OFFER_ISSUES = Object.freeze([
  ['expired', '活动已结束或失效'],
  ['wrong_info', '额度、条件等信息有误'],
  ['link_broken', '链接打不开或跳错'],
  ['other', '其他问题'],
]);

export const GENERAL_TOPICS = Object.freeze([
  ['suggestion', '功能建议'],
  ['want_offer', '想要某类福利'],
  ['bug', '页面出错'],
  ['other', '其他'],
]);

export const FEEDBACK_LIMITS = Object.freeze({ message: 1000, contact: 100 });

/**
 * @param {readonly (readonly [string, string])[]} options
 */
const radios = (options) =>
  options
    .map(
      ([value, label], i) =>
        `<label class="fb-choice"><input type="radio" name="category" value="${e(value)}"${i === 0 ? ' checked' : ''} /><span>${e(label)}</span></label>`,
    )
    .join('');

/**
 * Feedback form. With an offer it reports a problem with that card; without
 * one it collects general feedback, where the message is required.
 * @param {{ offer: { id: string, title: string } | null }} options
 * @returns {string}
 */
export function feedbackDialog({ offer }) {
  const kicker = offer ? 'REPORT AN ISSUE' : 'FEEDBACK';
  const title = offer ? '反馈这张福利的问题' : '意见反馈';
  const lead = offer
    ? `「${offer.title}」`
    : '内测阶段，每一条反馈我们都会看。想要什么福利、哪里不好用，都可以说。';
  const placeholder = offer ? '补充说明（选填），比如你看到的实际规则' : '写下你的想法（必填）';
  return `<div class="dialog-inner feedback-dialog"><div class="dialog-kicker">${kicker}</div><h2 id="dialogTitle" class="dialog-title">${title}</h2><p class="dialog-lead">${e(lead)}</p><form id="feedbackForm" class="fb-form" novalidate><fieldset class="fb-choices"><legend class="dialog-section-title">${offer ? '遇到了什么问题' : '反馈类型'}</legend>${radios(offer ? OFFER_ISSUES : GENERAL_TOPICS)}</fieldset><label class="fb-field"><span class="dialog-section-title">${offer ? '补充说明' : '内容'}</span><textarea name="message" rows="4" maxlength="${FEEDBACK_LIMITS.message}" placeholder="${e(placeholder)}"${offer ? '' : ' required'}></textarea></label><label class="fb-field"><span class="dialog-section-title">联系方式（选填）</span><input name="contact" type="text" maxlength="${FEEDBACK_LIMITS.contact}" autocomplete="off" placeholder="微信号或邮箱，方便我们回复你" /></label><p class="fb-error" id="feedbackError" role="alert" hidden></p><div class="dialog-actions"><button type="submit" class="modal-button primary" id="feedbackSubmit">提交反馈</button></div></form><p class="dialog-fineprint">联系方式只用于回复这条反馈，不会公开。</p></div>`;
}

/** @returns {string} */
export function feedbackThanks() {
  return `<div class="dialog-inner feedback-dialog"><div class="dialog-kicker">THANK YOU</div><h2 id="dialogTitle" class="dialog-title">收到，谢谢你</h2><p class="dialog-lead">我们会尽快核实处理。福利信息有更新时，卡面上的核验日期也会随之刷新。</p><div class="dialog-actions"><button type="button" class="modal-button primary" data-close>好的</button></div></div>`;
}

/**
 * @param {import('../api/engagement-client.js').Community} community
 * @returns {string}
 */
export function communityDialog(community) {
  const expires = community.qr?.expiresAt ? formatDate(community.qr.expiresAt) : '';
  const qr = community.qr
    ? `<figure class="community-qr"><img src="${e(community.qr.src)}" alt="${e(community.title)}的二维码" width="220" height="220" /><figcaption>长按或扫码加入${expires ? `<span class="community-expiry">二维码 ${e(expires)} 前有效</span>` : ''}</figcaption></figure>`
    : '';
  const link = community.link
    ? `<a class="modal-button${community.qr ? '' : ' primary'}" href="${e(community.link)}" target="_blank" rel="noopener noreferrer">${e(community.linkLabel || '打开邀请链接')}${EXTERNAL_ICON}<span class="sr-only">（在新窗口打开）</span></a>`
    : '';
  const description = community.description
    ? `<p class="dialog-lead">${e(community.description)}</p>`
    : '';
  return `<div class="dialog-inner community-dialog"><div class="dialog-kicker">COMMUNITY</div><h2 id="dialogTitle" class="dialog-title">${e(community.title)}</h2>${description}${qr}${link ? `<div class="dialog-actions">${link}</div>` : ''}<p class="dialog-fineprint">群内交流仅代表成员个人经验，领取福利请以官方页面规则为准。</p></div>`;
}
