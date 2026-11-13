/* 「限定福利」 tab of `/admin`: create prizes, add redemption codes, switch
 * them on and off, and see who won (codes masked by the server). Wired in
 * through admin-beta.js. Every dynamic value is escaped; codes typed into the
 * textarea are sent once and never rendered back. */
import { escapeHTML } from '../ui/escape.js';
import { fromLocalInput, toLocalInput } from './admin-time.js';

export const PRIZE_TAB = Object.freeze({ id: 'prizes', label: '限定福利' });

const STATUS_LABELS = Object.freeze({
  draft: '草稿',
  active: '进行中',
  paused: '已暂停',
  ended: '已结束',
});
const STATUS_BADGE = Object.freeze({
  draft: 'unknown',
  active: 'resolved',
  paused: 'pending',
  ended: 'dismissed',
});

const ACTIONS = Object.freeze({
  draft: [
    ['activate', '开始'],
    ['end', '结束'],
  ],
  active: [
    ['pause', '暂停'],
    ['end', '结束'],
  ],
  paused: [
    ['activate', '恢复'],
    ['end', '结束'],
  ],
  ended: [],
});

const label = (map, key) => (Object.hasOwn(map, key) ? map[key] : String(key));
const pct = (chance) => `${Math.round(Number(chance) * 10000) / 100}%`;
const dateTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—');

/** Split pasted codes: one per line, blank lines and surrounding spaces dropped. */
export function parseCodes(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/\r?\n/)
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];
}

/** Percent typed in the form (e.g. "5") → chance in [0, 1]; NaN when invalid. */
export function chanceFromPercent(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 10000 : Number.NaN;
}

/** @param {FormData} data */
export function buildPrizeBody(data, { withId }) {
  /** @type {Record<string, unknown>} */
  const body = {
    title: String(data.get('title') ?? '').trim(),
    description: String(data.get('description') ?? '').trim(),
    valueNote: String(data.get('valueNote') ?? '').trim(),
    redeemUrl: String(data.get('redeemUrl') ?? '').trim() || null,
    chance: chanceFromPercent(data.get('chancePercent')),
    startsAt: fromLocalInput(String(data.get('startsAt') ?? '')),
    endsAt: fromLocalInput(String(data.get('endsAt') ?? '')),
  };
  if (withId) body.id = String(data.get('id') ?? '').trim();
  return body;
}

export function initialPrizeState() {
  return { prizes: [], prizeWinners: {}, prizeEditing: null };
}

/** @param {any} client */
export async function loadPrizeTab(client) {
  return { prizes: await client.listPrizes(), prizeWinners: {} };
}

function prizeFields(p) {
  return `
    <label class="admin-field"><span>名称</span><input class="admin-input" name="title" maxlength="60" required value="${escapeHTML(p?.title ?? '')}" placeholder="比如：某 AI 会员一个月兑换码" /></label>
    <label class="admin-field"><span>兑换说明（公示页所有人可见，不要填兑换码或带口令的链接）</span><input class="admin-input" name="description" maxlength="500" value="${escapeHTML(p?.description ?? '')}" placeholder="比如：打开兑换页，登录后输入兑换码" /></label>
    <label class="admin-field"><span>价值说明（选填，公示用）</span><input class="admin-input" name="valueNote" maxlength="60" value="${escapeHTML(p?.valueNote ?? '')}" placeholder="比如：价值约 20 元" /></label>
    <label class="admin-field"><span>兑换页面（选填，https）</span><input class="admin-input" name="redeemUrl" type="url" maxlength="500" value="${escapeHTML(p?.redeemUrl ?? '')}" /></label>
    <label class="admin-field"><span>每次开包的中奖概率（%，最高 20，所有进行中的合计也不超过 20）</span><input class="admin-input" name="chancePercent" type="number" min="0.01" max="20" step="0.01" required value="${escapeHTML(p ? Math.round(p.chance * 10000) / 100 : 2)}" /></label>
    <label class="admin-field"><span>开始时间（选填，本地时间）</span><input class="admin-input" name="startsAt" type="datetime-local" value="${escapeHTML(toLocalInput(p?.startsAt ?? null))}" /></label>
    <label class="admin-field"><span>截止时间（选填，本地时间）</span><input class="admin-input" name="endsAt" type="datetime-local" value="${escapeHTML(toLocalInput(p?.endsAt ?? null))}" /></label>`;
}

function winnersList(winners) {
  if (!winners) return '';
  if (!winners.length) return '<p class="admin-subtitle">还没有人中奖。</p>';
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>兑换码</th><th>中奖时间</th><th>用户</th></tr></thead><tbody>${winners
    .map(
      (w) =>
        `<tr><td><code>${escapeHTML(w.code)}</code></td><td>${escapeHTML(dateTime(w.claimedAt))}</td><td><code>${escapeHTML(w.user)}</code></td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}

function prizeCard(p, state) {
  const id = escapeHTML(p.id);
  const actions = (ACTIONS[p.status] ?? [])
    .map(
      ([action, text]) =>
        `<button type="button" class="admin-btn is-small${action === 'activate' ? ' is-ok' : ''}" data-prize-action="${action}" data-prize-id="${id}">${text}</button>`,
    )
    .join('');
  const editable = p.status !== 'ended';
  const editing = state.prizeEditing === p.id;
  return `
    <article class="admin-card">
      <div class="admin-card-top">
        <div>
          <h2 class="admin-card-title"><span>${escapeHTML(p.title)}</span><code>${id}</code><span class="status-badge is-${label(STATUS_BADGE, p.status)}">${escapeHTML(label(STATUS_LABELS, p.status))}</span></h2>
          <div class="admin-meta">
            <span>概率 ${escapeHTML(pct(p.chance))}</span>
            <span>库存 ${escapeHTML(p.total - p.claimed)} / ${escapeHTML(p.total)}（已发出 ${escapeHTML(p.claimed)}）</span>
            <span>时间 ${escapeHTML(dateTime(p.startsAt))} → ${escapeHTML(dateTime(p.endsAt))}</span>
          </div>
        </div>
        <div class="admin-actions">${actions}${editable ? `<button type="button" class="admin-btn is-small" data-prize-edit="${id}">${editing ? '收起' : '编辑'}</button>` : ''}<button type="button" class="admin-btn is-small" data-prize-winners="${id}">中奖记录</button></div>
      </div>
      ${editing ? `<form class="admin-form" data-prize-form="edit" data-prize-id="${id}">${prizeFields(p)}<div class="admin-actions"><button type="submit" class="admin-btn is-primary">保存修改</button></div></form>` : ''}
      ${
        editable
          ? `<form class="admin-form" data-prize-form="codes" data-prize-id="${id}">
        <label class="admin-field"><span>追加兑换码（每行一个，最多 500 个；提交后不会再显示完整内容）</span><textarea class="admin-input" name="codes" rows="3" autocomplete="off" spellcheck="false"></textarea></label>
        <div class="admin-actions"><button type="submit" class="admin-btn">追加库存</button></div>
      </form>`
          : ''
      }
      ${winnersList(state.prizeWinners[p.id])}
    </article>`;
}

/** @param {Record<string, any>} state */
export function renderPrizeTab(state) {
  const list = state.prizes.length
    ? `<div class="admin-list">${state.prizes.map((p) => prizeCard(p, state)).join('')}</div>`
    : '<div class="empty-state">还没有限定福利。</div>';
  return `
    <section class="admin-panel">
      <p class="admin-subtitle">每次免费开包会额外抽一次限定福利。中奖后兑换码直接显示给中奖者；每人最多中 1 次，同一网络每天最多中 1 次。公示页会显示名称、说明、价值、概率与剩余数量。</p>
      ${list}
      <h2 class="admin-card-title">新建限定福利</h2>
      <form class="admin-form" data-prize-form="create">
        <label class="admin-field"><span>ID（小写字母、数字和连字符）</span><input class="admin-input" name="id" required minlength="3" maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
        ${prizeFields(null)}
        <p class="admin-subtitle">新建后是草稿，追加兑换码后点「开始」才会参与抽奖。</p>
        <div class="admin-actions"><button type="submit" class="admin-btn is-primary">新建</button></div>
      </form>
    </section>`;
}

export const isPrizeButton = (target) =>
  Boolean(
    (target.dataset.prizeAction && target.dataset.prizeId) ||
    target.dataset.prizeEdit ||
    target.dataset.prizeWinners,
  );

export const isPrizeForm = (form) => Boolean(form.dataset?.prizeForm);

const CONFIRM = Object.freeze({
  end: '结束后不能再恢复、编辑或追加库存，未发出的兑换码不会再参与抽奖。确定结束？',
});

/** @param {HTMLButtonElement} target @param {any} ctx */
export async function handlePrizeClick(target, ctx) {
  const { dataset } = target;
  try {
    if (dataset.prizeEdit) {
      ctx.state.prizeEditing =
        ctx.state.prizeEditing === dataset.prizeEdit ? null : dataset.prizeEdit;
      ctx.render();
      return true;
    }
    if (dataset.prizeWinners) {
      const winners = await ctx.client.listPrizeWinners(dataset.prizeWinners);
      ctx.state.prizeWinners = { ...ctx.state.prizeWinners, [dataset.prizeWinners]: winners };
      ctx.render();
      return true;
    }
    if (dataset.prizeAction && dataset.prizeId) {
      const warning = CONFIRM[dataset.prizeAction];
      if (warning && !globalThis.confirm?.(warning)) return true;
      await ctx.client.transitionPrize(dataset.prizeId, dataset.prizeAction);
      ctx.showToast('状态已更新');
      await ctx.refresh();
      return true;
    }
  } catch (err) {
    ctx.handleError(err);
    ctx.render();
    return true;
  }
  return false;
}

/** @param {HTMLFormElement} form @param {any} ctx */
export async function handlePrizeSubmit(form, ctx) {
  const kind = form.dataset.prizeForm;
  if (!kind) return false;
  const data = new FormData(form);
  const id = form.dataset.prizeId ?? '';
  try {
    if (kind === 'create') {
      await ctx.client.createPrize(buildPrizeBody(data, { withId: true }));
      ctx.showToast('已新建，追加兑换码后点「开始」');
    } else if (kind === 'edit') {
      await ctx.client.editPrize(id, buildPrizeBody(data, { withId: false }));
      ctx.state.prizeEditing = null;
      ctx.showToast('已保存');
    } else if (kind === 'codes') {
      const codes = parseCodes(data.get('codes'));
      if (!codes.length) {
        ctx.showToast('请先粘贴兑换码，每行一个');
        return true;
      }
      const res = await ctx.client.addPrizeCodes(id, codes);
      ctx.showToast(`已追加 ${res.added} 个，库存共 ${res.total - res.claimed} 个`);
    }
    await ctx.refresh();
  } catch (err) {
    // Keep what was typed: show the error without re-rendering the form.
    ctx.handleError(err);
    if (/** @type {{ status?: number }} */ (err)?.status === 401) ctx.render();
    else ctx.showToast(`保存失败：${err instanceof Error ? err.message : '请重试'}`);
  }
  return true;
}
