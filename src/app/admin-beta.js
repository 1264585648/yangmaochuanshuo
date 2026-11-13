/* Closed-beta sections of `/admin`: visitor feedback, official-link click
 * stats and the community group. Kept apart from admin-page.js, which owns
 * login, tabs and the offer workflow and calls in here for these tabs.
 * Same rules as the rest of the page: every dynamic value is escaped. */
import { escapeHTML } from '../ui/escape.js';

export const BETA_TABS = Object.freeze([
  { id: 'feedback', label: '用户反馈' },
  { id: 'stats', label: '点击统计' },
  { id: 'community', label: '内测群' },
]);

export const isBetaTab = (tab) => BETA_TABS.some((t) => t.id === tab);

const FEEDBACK_STATUS_LABELS = Object.freeze({
  open: '待处理',
  resolved: '已处理',
  dismissed: '已忽略',
});

const CATEGORY_LABELS = Object.freeze({
  expired: '活动已结束',
  wrong_info: '信息有误',
  link_broken: '链接失效',
  suggestion: '功能建议',
  want_offer: '想要福利',
  bug: '页面出错',
  other: '其他',
});

/** Upload cap enforced by the server, minus headroom; larger files are re-encoded. */
const QR_DIRECT_MAX_BYTES = 480 * 1024;
const QR_MAX_EDGE = 720;
const QR_WARN_HOURS = 24;

const label = (labels, key) => (Object.hasOwn(labels, key) ? labels[key] : String(key));
const statusModifier = (status) =>
  Object.hasOwn(FEEDBACK_STATUS_LABELS, status) ? status : 'unknown';
const dateTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—');

/** @returns {Record<string, unknown>} Initial state for the beta tabs. */
export function initialBetaState() {
  return {
    feedbackStatus: 'open',
    feedback: [],
    feedbackTotal: 0,
    stats: null,
    statsDays: 7,
    community: null,
  };
}

/**
 * Load data for a beta tab. Returns the state fields to merge.
 * @param {ReturnType<typeof import('../api/manage-client.js').createManageClient>} client
 * @param {Record<string, any>} state
 */
export async function loadBetaTab(client, state) {
  if (state.tab === 'feedback') {
    const res = await client.listFeedback({ status: state.feedbackStatus, limit: 100 });
    return { feedback: res.data, feedbackTotal: res.meta?.total ?? res.data.length };
  }
  if (state.tab === 'stats') return { stats: await client.getClickStats(state.statsDays) };
  if (state.tab === 'community') return { community: await client.getCommunity() };
  return {};
}

function renderFeedbackItem(item) {
  const offer = item.offer
    ? `<span>福利：<a class="admin-link" href="/offers/${encodeURIComponent(item.offer.id)}" target="_blank" rel="noopener">${escapeHTML(item.offer.title)}</a> <code>${escapeHTML(item.offer.id)}</code></span>`
    : '<span>整体反馈</span>';
  const actions =
    item.status === 'open'
      ? `<button type="button" class="admin-btn is-small is-ok" data-feedback-action="resolve" data-feedback-id="${escapeHTML(item.id)}">标记已处理</button><button type="button" class="admin-btn is-small" data-feedback-action="dismiss" data-feedback-id="${escapeHTML(item.id)}">忽略</button>`
      : `<button type="button" class="admin-btn is-small" data-feedback-action="reopen" data-feedback-id="${escapeHTML(item.id)}">重新打开</button>`;
  return `
    <article class="admin-card">
      <div class="admin-card-top">
        <div>
          <h2 class="admin-card-title">
            <code>#${escapeHTML(item.id)}</code>
            <span>${escapeHTML(label(CATEGORY_LABELS, item.category))}</span>
            <span class="status-badge is-${statusModifier(item.status)}">${escapeHTML(label(FEEDBACK_STATUS_LABELS, item.status))}</span>
          </h2>
          <div class="admin-meta">
            ${offer}
            <span>提交于 ${escapeHTML(dateTime(item.createdAt))}</span>
            ${item.contact ? `<span>联系方式：<code>${escapeHTML(item.contact)}</code></span>` : ''}
          </div>
        </div>
        <div class="admin-actions">${actions}</div>
      </div>
      ${item.message ? `<p class="admin-feedback-text">${escapeHTML(item.message)}</p>` : '<p class="admin-subtitle">（未填写补充说明）</p>'}
      ${item.note ? `<p class="admin-subtitle">处理备注：${escapeHTML(item.note)}</p>` : ''}
    </article>`;
}

function renderFeedbackTab(state) {
  const statuses = [...Object.entries(FEEDBACK_STATUS_LABELS), ['', '全部']];
  return `
    <section class="admin-panel">
      <div class="admin-toolbar">
        <div class="admin-filters">
          ${statuses
            .map(
              ([value, text]) =>
                `<button type="button" class="admin-pill${state.feedbackStatus === value ? ' is-active' : ''}" data-feedback-status="${escapeHTML(value)}">${escapeHTML(text)}</button>`,
            )
            .join('')}
        </div>
        <span class="admin-subtitle">共 ${escapeHTML(state.feedbackTotal)} 条</span>
      </div>
      ${
        state.feedback.length
          ? `<div class="admin-list">${state.feedback.map(renderFeedbackItem).join('')}</div>`
          : '<div class="empty-state">没有这个状态的反馈。</div>'
      }
    </section>`;
}

function renderStatsTab(state) {
  const stats = state.stats;
  if (!stats)
    return '<section class="admin-panel"><div class="empty-state">暂无数据。</div></section>';
  const ranges = [7, 30, 90];
  const max = Math.max(1, ...stats.daily.map((d) => d.visitors));
  const bars = stats.daily.length
    ? `<ol class="admin-bars">${stats.daily
        .map(
          (d) =>
            `<li><span class="admin-bar-day">${escapeHTML(d.day.slice(5))}</span><meter min="0" max="${max}" value="${escapeHTML(d.visitors)}"></meter><span class="admin-bar-n">${escapeHTML(d.visitors)}</span></li>`,
        )
        .join('')}</ol>`
    : '<div class="empty-state">这段时间还没有人点开官方页面。</div>';
  const rows = stats.topOffers
    .map(
      (o) =>
        `<tr><td><a class="admin-link" href="/offers/${encodeURIComponent(o.id)}" target="_blank" rel="noopener">${escapeHTML(o.title)}</a></td><td>${escapeHTML(o.pool)}</td><td>${escapeHTML(o.visitors)}</td><td>${escapeHTML(o.recentVisitors)}</td></tr>`,
    )
    .join('');
  return `
    <section class="admin-panel">
      <div class="admin-toolbar">
        <div class="admin-filters">
          ${ranges
            .map(
              (d) =>
                `<button type="button" class="admin-pill${state.statsDays === d ? ' is-active' : ''}" data-stats-days="${d}">近 ${d} 天</button>`,
            )
            .join('')}
        </div>
        <span class="admin-subtitle">按北京时间计日，同一网络同一天对同一张卡只计一次</span>
      </div>
      <div class="admin-stat-grid">
        <div class="admin-stat"><strong>${escapeHTML(stats.totals.recentVisitors)}</strong><span>近 ${escapeHTML(state.statsDays)} 天独立访客</span></div>
        <div class="admin-stat"><strong>${escapeHTML(stats.totals.recentClicks)}</strong><span>近 ${escapeHTML(state.statsDays)} 天点击（去重后）</span></div>
        <div class="admin-stat"><strong>${escapeHTML(stats.totals.visitors)}</strong><span>累计独立访客</span></div>
        <div class="admin-stat"><strong>${escapeHTML(stats.totals.clicks)}</strong><span>累计点击（去重后）</span></div>
      </div>
      <h2 class="admin-card-title">每日访客</h2>
      ${bars}
      <h2 class="admin-card-title">热门福利（前 50）</h2>
      ${
        rows
          ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>福利</th><th>卡池</th><th>累计访客</th><th>近期访客</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : '<div class="empty-state">还没有点击记录。</div>'
      }
    </section>`;
}

/** ISO timestamp → value for `<input type="datetime-local">` in local time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** `datetime-local` value → ISO timestamp, or null when empty or invalid. */
export function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function qrStatus(c, now) {
  if (!c?.qr) return '<span class="status-badge is-unknown">未上传</span>';
  if (!c.qrExpiresAt) return '<span class="status-badge is-open">长期有效</span>';
  const left = Date.parse(c.qrExpiresAt) - now.getTime();
  if (left <= 0) return '<span class="status-badge is-dismissed">已过期，前台已隐藏</span>';
  if (left < QR_WARN_HOURS * 3_600_000) {
    return '<span class="status-badge is-pending">24 小时内过期，请尽快更换</span>';
  }
  return `<span class="status-badge is-resolved">有效至 ${escapeHTML(dateTime(c.qrExpiresAt))}</span>`;
}

function renderCommunityTab(state, now = new Date()) {
  const c = state.community;
  const visible =
    c?.qr && c.enabled && (!c.qrExpiresAt || Date.parse(c.qrExpiresAt) > now.getTime());
  const preview = visible
    ? `<img class="admin-qr-preview" src="/api/community/qr?v=${encodeURIComponent(c.qr.sha256.slice(0, 12))}" alt="当前二维码" width="160" height="160" />`
    : '';
  return `
    <section class="admin-panel">
      <p class="admin-subtitle">前台「加入内测群」入口的内容。微信群二维码 7 天过期，过期后前台自动隐藏二维码，只保留链接（若有）。</p>
      <form id="communityForm" class="admin-form">
        <label class="admin-check"><input type="checkbox" name="enabled"${c?.enabled ? ' checked' : ''} /> 在前台显示入口</label>
        <label class="admin-field"><span>群名称</span><input class="admin-input" name="title" maxlength="40" required value="${escapeHTML(c?.title ?? '羊毛传说内测群')}" /></label>
        <label class="admin-field"><span>说明</span><input class="admin-input" name="description" maxlength="200" value="${escapeHTML(c?.description ?? '')}" placeholder="比如：反馈问题、交流羊毛心得" /></label>
        <label class="admin-field"><span>邀请链接（选填，https）</span><input class="admin-input" name="link" type="url" maxlength="500" value="${escapeHTML(c?.link ?? '')}" placeholder="QQ 群、Discord 或 Telegram 邀请链接" /></label>
        <label class="admin-field"><span>链接按钮文字（选填）</span><input class="admin-input" name="linkLabel" maxlength="20" value="${escapeHTML(c?.linkLabel ?? '')}" placeholder="比如：加入 QQ 群" /></label>
        <div class="admin-field"><span>二维码</span><div class="admin-qr-row">${preview}<div>${qrStatus(c, now)}</div></div></div>
        <label class="admin-field"><span>上传新二维码（PNG / JPEG / WebP）</span><input class="admin-input" name="qrFile" type="file" accept="image/png,image/jpeg,image/webp" /></label>
        ${c?.qr ? '<label class="admin-check"><input type="checkbox" name="removeQr" /> 删除当前二维码</label>' : ''}
        <label class="admin-field"><span>二维码过期时间（本地时间，留空表示长期有效）</span><input class="admin-input" name="qrExpiresAt" type="datetime-local" value="${escapeHTML(toLocalInput(c?.qrExpiresAt ?? null))}" /></label>
        <p class="admin-subtitle">上传微信群二维码时，过期时间默认填为 7 天后。</p>
        <div class="admin-actions"><button type="submit" class="admin-btn is-primary">保存</button></div>
      </form>
    </section>`;
}

/** @param {Record<string, any>} state */
export function renderBetaTab(state) {
  if (state.tab === 'feedback') return renderFeedbackTab(state);
  if (state.tab === 'stats') return renderStatsTab(state);
  if (state.tab === 'community') return renderCommunityTab(state);
  return '';
}

/** @param {Blob} blob @returns {Promise<string>} base64 without the data: prefix */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** Shrink a large image to a PNG no wider or taller than QR_MAX_EDGE. */
async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, QR_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'),
  );
}

/** @param {File} file */
async function encodeQr(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw Object.assign(new Error('只支持 PNG、JPEG 或 WebP 图片'), { code: 'invalid_image' });
  }
  const blob = file.size > QR_DIRECT_MAX_BYTES ? await downscale(file) : file;
  if (blob.size > QR_DIRECT_MAX_BYTES) {
    throw Object.assign(new Error('图片太大，请裁剪到只包含二维码后再上传'), {
      code: 'invalid_image',
    });
  }
  return blobToBase64(blob);
}

const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * Build the PUT body from the community form.
 * @param {FormData} data
 * @param {Date} now
 */
export async function buildCommunityBody(data, now = new Date()) {
  const file = data.get('qrFile');
  const hasFile = file instanceof File && file.size > 0;
  let qrExpiresAt = fromLocalInput(String(data.get('qrExpiresAt') ?? ''));
  /** @type {Record<string, unknown>} */
  const body = {
    enabled: data.get('enabled') === 'on',
    title: String(data.get('title') ?? '').trim(),
    description: String(data.get('description') ?? '').trim(),
    link: String(data.get('link') ?? '').trim() || null,
    linkLabel: String(data.get('linkLabel') ?? '').trim(),
  };
  if (hasFile) {
    body.qr = { base64: await encodeQr(/** @type {File} */ (file)) };
    // A fresh WeChat group code lasts 7 days; default to that when left unchanged.
    if (!qrExpiresAt || Date.parse(qrExpiresAt) <= now.getTime()) {
      qrExpiresAt = new Date(now.getTime() + WEEK_MS).toISOString();
    }
  } else if (data.get('removeQr') === 'on') {
    body.qr = null;
  }
  body.qrExpiresAt = qrExpiresAt;
  return body;
}

/**
 * True for buttons owned by the beta tabs. Synchronous, so the page's click
 * handler keeps running synchronously for every other button.
 * @param {HTMLButtonElement} target
 */
export const isBetaButton = (target) =>
  target.dataset.feedbackStatus !== undefined ||
  Boolean(target.dataset.statsDays) ||
  Boolean(target.dataset.feedbackAction && target.dataset.feedbackId);

export const isBetaForm = (form) => form.id === 'communityForm';

/**
 * Handle clicks on beta-tab controls. Returns true when the click was handled.
 * @param {HTMLButtonElement} target
 * @param {{ state: Record<string, any>, client: any, refresh: () => Promise<void>,
 *   showToast: (m: string) => void, handleError: (e: unknown) => void, render: () => void }} ctx
 */
export async function handleBetaClick(target, ctx) {
  const { dataset } = target;
  if (dataset.feedbackStatus !== undefined) {
    ctx.state.feedbackStatus = dataset.feedbackStatus;
    await ctx.refresh();
    return true;
  }
  if (dataset.statsDays) {
    ctx.state.statsDays = Number(dataset.statsDays);
    await ctx.refresh();
    return true;
  }
  if (dataset.feedbackAction && dataset.feedbackId) {
    let note;
    if (dataset.feedbackAction === 'resolve') {
      const typed = globalThis.prompt?.('处理备注（选填）', '');
      if (typed === null) return true;
      note = typed?.trim() || undefined;
    }
    try {
      await ctx.client.transitionFeedback(
        dataset.feedbackId,
        dataset.feedbackAction,
        note ? { note } : {},
      );
      ctx.showToast('反馈状态已更新');
      await ctx.refresh();
    } catch (err) {
      ctx.handleError(err);
      ctx.render();
    }
    return true;
  }
  return false;
}

/**
 * Handle the community form. Returns true when the form was handled.
 * @param {HTMLFormElement} form
 * @param {Parameters<typeof handleBetaClick>[1]} ctx
 */
export async function handleBetaSubmit(form, ctx) {
  if (form.id !== 'communityForm') return false;
  try {
    const body = await buildCommunityBody(new FormData(form));
    ctx.state.community = await ctx.client.putCommunity(body);
    ctx.showToast('内测群设置已保存');
    ctx.render();
  } catch (err) {
    // Keep what was typed: show the error without re-rendering the form,
    // unless the token was rejected and the page returns to login.
    ctx.handleError(err);
    if (/** @type {{ status?: number }} */ (err)?.status === 401) ctx.render();
    else ctx.showToast(`保存失败：${err instanceof Error ? err.message : '请重试'}`);
  }
  return true;
}
