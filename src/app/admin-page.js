/* Interactive controller for `/admin` (`admin.html`).
 * Strictly CSP-safe: no inline scripts, no inline styles, all dynamic text escaped. */
import { createManageClient } from '../api/manage-client.js';
import {
  CHANGE_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  POOL_LABELS,
  buildGuideTemplate,
  buildOfferContent,
  diffOfferContent,
  formatApiError,
  isRevertibleAudit,
  parseListField,
} from '../domain/admin-form.js';
import { escapeHTML } from '../ui/escape.js';
import { formatDate } from '../ui/format.js';

const TOKEN_STORAGE_KEY = 'dealdex_admin_token';
const PAGE_SIZE = 20;

/** Badge modifier from a known enum only, so server data cannot inject extra classes. */
const statusClass = (labels, status) => (Object.hasOwn(labels, status) ? status : 'unknown');

const safeUrl = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : '');

const formatDateTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 19) : '—');

const jsonBlock = (value) =>
  `<pre class="admin-pre">${escapeHTML(JSON.stringify(value, null, 2))}</pre>`;

function renderAlert(err) {
  if (!err) return '';
  const { message, details } = formatApiError(err);
  const items = details.length
    ? `<ul>${details.map((d) => `<li>${escapeHTML(d)}</li>`).join('')}</ul>`
    : '';
  return `<div class="admin-alert is-error" role="alert"><strong>${escapeHTML(message)}</strong>${items}</div>`;
}

function renderLogin() {
  return `
    <section class="admin-panel">
      <div class="admin-head">
        <div>
          <h1 class="admin-title">羊毛传说 管理后台</h1>
          <p class="admin-subtitle">使用管理员或巡检员令牌连接线上管理接口，所有写操作均会写入审计日志。</p>
        </div>
      </div>
      <div class="admin-login-box">
        <form id="adminLoginForm" class="admin-login-form">
          <label class="sr-only" for="adminTokenInput">管理令牌</label>
          <input
            id="adminTokenInput"
            name="token"
            type="password"
            class="admin-input"
            placeholder="粘贴 Bearer 令牌（ddx_...）"
            autocomplete="off"
            required
          />
          <button type="submit" class="admin-btn is-primary">连接后台</button>
        </form>
        <p class="admin-subtitle">令牌仅保存在当前标签页的会话存储（sessionStorage）中，关闭标签页后自动清除。</p>
        <pre class="admin-code-hint">node scripts/manage-token.mjs issue --name "Owner" --scope admin --remote</pre>
      </div>
    </section>
  `;
}

function renderHeader(state) {
  const scopeLabel = state.me.scope === 'admin' ? '管理员 (admin)' : '巡检员 (inspector)';
  const scopeClass = state.me.scope === 'inspector' ? 'scope-badge is-inspector' : 'scope-badge';
  const tabs = [
    { id: 'offers', label: '福利卡管理' },
    { id: 'providers', label: '提供方' },
    { id: 'changes', label: '变更审核' },
    ...(state.me.scope === 'admin' ? [{ id: 'audit', label: '审计日志' }] : []),
  ];
  return `
    <section class="admin-panel">
      <div class="admin-head">
        <div>
          <h1 class="admin-title">羊毛传说 管理工作台</h1>
          <p class="admin-subtitle">管理提供方、福利卡生命周期、变更申请与审计回滚。</p>
        </div>
        <div class="admin-auth-bar">
          <div class="admin-identity">
            <span>操作者：<code>${escapeHTML(state.me.id)}</code></span>
            <span class="${scopeClass}">${escapeHTML(scopeLabel)}</span>
          </div>
          <button type="button" class="admin-btn is-small" data-action="refresh">刷新数据</button>
          <button type="button" class="admin-btn is-small is-danger" data-action="logout">退出登录</button>
        </div>
      </div>
      <nav class="admin-tabs" aria-label="后台功能区">
        ${tabs
          .map(
            (t) =>
              `<button type="button" class="admin-tab${state.tab === t.id ? ' is-active' : ''}" data-tab="${t.id}">${escapeHTML(t.label)}</button>`,
          )
          .join('')}
      </nav>
    </section>
  `;
}

function offerActionsHtml(offer, isAdmin) {
  const buttons = [];
  if (isAdmin) {
    buttons.push(
      `<button type="button" class="admin-btn is-small" data-offer-edit="${escapeHTML(offer.id)}">编辑</button>`,
    );
  } else {
    buttons.push(
      `<button type="button" class="admin-btn is-small" data-offer-propose="${escapeHTML(offer.id)}">提出变更</button>`,
    );
  }
  if (offer.status === 'draft') {
    buttons.push(
      `<button type="button" class="admin-btn is-small is-primary" data-offer-action="submit" data-offer-id="${escapeHTML(offer.id)}">提交审核</button>`,
    );
  }
  if (offer.status === 'pending_review' && isAdmin) {
    buttons.push(
      `<button type="button" class="admin-btn is-small is-ok" data-offer-action="publish" data-offer-id="${escapeHTML(offer.id)}">发布</button>`,
      `<button type="button" class="admin-btn is-small is-danger" data-offer-action="reject" data-offer-id="${escapeHTML(offer.id)}">驳回</button>`,
    );
  }
  if (offer.status === 'published') {
    buttons.push(
      `<button type="button" class="admin-btn is-small is-ok" data-offer-action="verify" data-offer-id="${escapeHTML(offer.id)}">记录核验</button>`,
      `<button type="button" class="admin-btn is-small is-danger" data-offer-action="expire" data-offer-id="${escapeHTML(offer.id)}">标记失效</button>`,
    );
  }
  if (offer.status === 'expired' && isAdmin) {
    buttons.push(
      `<button type="button" class="admin-btn is-small is-primary" data-offer-action="restore" data-offer-id="${escapeHTML(offer.id)}">恢复发布</button>`,
    );
  }
  return buttons.join('');
}

function renderOfferCard(offer, isAdmin) {
  const statusText = OFFER_STATUS_LABELS[offer.status] ?? offer.status;
  const poolText = POOL_LABELS[offer.pool] ?? offer.pool;
  const rarityClass = offer.rarity === 'SSR' ? 'ssr' : offer.rarity === 'S' ? 's' : '';
  const verifiedText = offer.lastVerifiedAt
    ? `核验于 ${formatDate(offer.lastVerifiedAt)}`
    : '尚未核验';
  const officialHref = safeUrl(offer.officialUrl);
  const sourceHref = safeUrl(offer.sourceUrl);
  const guideLabel = offer.guide ? `攻略：${offer.guide.kind}` : '无攻略';
  const publicLink =
    offer.status === 'published'
      ? `<a class="admin-link" href="/offers/${encodeURIComponent(offer.id)}" target="_blank" rel="noopener noreferrer">前台页面</a>`
      : '';

  return `
    <article class="admin-card">
      <div class="admin-card-top">
        <div>
          <h2 class="admin-card-title">
            <span>${escapeHTML(offer.title)}</span>
            <span class="rarity-chip mini ${rarityClass}">${escapeHTML(offer.rarity)}</span>
            <span class="status-badge is-${statusClass(OFFER_STATUS_LABELS, offer.status)}">${escapeHTML(statusText)}</span>
            <code>${escapeHTML(offer.id)}</code>
            <code>v${escapeHTML(offer.version)}</code>
          </h2>
          <div class="admin-meta">
            <span>卡池：${escapeHTML(poolText)}</span>
            <span>提供方：${escapeHTML(offer.providerName)} (<code>${escapeHTML(offer.providerId)}</code>)</span>
            <span>${escapeHTML(verifiedText)}</span>
            <span>${escapeHTML(guideLabel)}</span>
            <span>有效期：${escapeHTML(offer.validFrom || '不限')} ~ ${escapeHTML(offer.validUntil || '长期')}</span>
          </div>
        </div>
        <div class="admin-actions">${offerActionsHtml(offer, isAdmin)}</div>
      </div>
      <div class="admin-meta">
        <span>权益：<strong>${escapeHTML(offer.benefit)}</strong></span>
        <span>${escapeHTML(offer.summary)}</span>
      </div>
      <div class="admin-meta">
        ${officialHref ? `<a class="admin-link" href="${escapeHTML(officialHref)}" target="_blank" rel="noopener noreferrer">官方链接</a>` : ''}
        ${sourceHref ? `<a class="admin-link" href="${escapeHTML(sourceHref)}" target="_blank" rel="noopener noreferrer">来源依据</a>` : ''}
        ${publicLink}
        <span>更新于 ${escapeHTML(formatDateTime(offer.updatedAt))}</span>
      </div>
    </article>
  `;
}

function renderOffersTab(state) {
  const isAdmin = state.me.scope === 'admin';
  const statuses = [
    { value: '', label: '全部' },
    { value: 'draft', label: '草稿' },
    { value: 'pending_review', label: '待审核' },
    { value: 'published', label: '已发布' },
    { value: 'expired', label: '已失效' },
  ];
  const keyword = state.offerQuery.trim().toLowerCase();
  const filtered = keyword
    ? state.offers.filter((o) =>
        `${o.id} ${o.title} ${o.providerName} ${o.providerId}`.toLowerCase().includes(keyword),
      )
    : state.offers;
  const total = state.offerMeta?.total ?? state.offers.length;
  const hasPrev = state.offerOffset > 0;
  const hasNext = state.offerOffset + PAGE_SIZE < total;

  return `
    <section class="admin-panel">
      <div class="admin-toolbar">
        <div class="admin-filters" role="group" aria-label="按状态筛选">
          ${statuses
            .map(
              (s) =>
                `<button type="button" class="admin-pill${state.offerStatus === s.value ? ' is-active' : ''}" data-offer-status="${escapeHTML(s.value)}">${escapeHTML(s.label)}</button>`,
            )
            .join('')}
        </div>
        <div class="admin-actions">
          <input
            id="offerFilterInput"
            type="search"
            class="admin-input is-compact"
            placeholder="本页过滤 ID / 标题…"
            value="${escapeHTML(state.offerQuery)}"
          />
          <button type="button" class="admin-btn is-primary" data-offer-new="1">+ 新建福利卡</button>
        </div>
      </div>

      ${
        filtered.length
          ? `<div class="admin-list">${filtered.map((o) => renderOfferCard(o, isAdmin)).join('')}</div>`
          : '<div class="empty-state">当前条件下没有福利卡。</div>'
      }

      <div class="admin-pager">
        <span>共 ${escapeHTML(total)} 条（当前偏移 ${escapeHTML(state.offerOffset)}）</span>
        <div class="admin-actions">
          <button type="button" class="admin-btn is-small" data-offer-page="prev" ${hasPrev ? '' : 'disabled'}>上一页</button>
          <button type="button" class="admin-btn is-small" data-offer-page="next" ${hasNext ? '' : 'disabled'}>下一页</button>
        </div>
      </div>
    </section>
  `;
}

function renderProvidersTab(state) {
  const isAdmin = state.me.scope === 'admin';
  return `
    <section class="admin-panel">
      <div class="admin-toolbar">
        <span class="admin-subtitle">共 ${escapeHTML(state.providers.length)} 个提供方</span>
        ${isAdmin ? '<button type="button" class="admin-btn is-primary" data-provider-new="1">+ 新建提供方</button>' : ''}
      </div>
      ${
        state.providers.length
          ? `<div class="admin-list">${state.providers
              .map(
                (p) => `
            <article class="admin-card">
              <div class="admin-card-top">
                <div>
                  <h2 class="admin-card-title">${escapeHTML(p.name)} <code>${escapeHTML(p.id)}</code></h2>
                  <div class="admin-meta">
                    <span>官方域名：${p.officialDomains.map((d) => `<code>${escapeHTML(d)}</code>`).join(' ')}</span>
                    <span>更新于 ${escapeHTML(formatDateTime(p.updatedAt))}</span>
                  </div>
                </div>
                ${
                  isAdmin
                    ? `<button type="button" class="admin-btn is-small" data-provider-edit="${escapeHTML(p.id)}">编辑</button>`
                    : ''
                }
              </div>
            </article>`,
              )
              .join('')}</div>`
          : '<div class="empty-state">暂无提供方，请先创建一个提供方后再录入福利卡。</div>'
      }
    </section>
  `;
}

function renderChangesTab(state) {
  const isAdmin = state.me.scope === 'admin';
  const statuses = [
    { value: 'pending', label: '待处理' },
    { value: 'applied', label: '已采纳' },
    { value: 'rejected', label: '已驳回' },
    { value: '', label: '全部' },
  ];
  return `
    <section class="admin-panel">
      <div class="admin-toolbar">
        <div class="admin-filters">
          ${statuses
            .map(
              (s) =>
                `<button type="button" class="admin-pill${state.changeStatus === s.value ? ' is-active' : ''}" data-change-status="${escapeHTML(s.value)}">${escapeHTML(s.label)}</button>`,
            )
            .join('')}
        </div>
        <form id="changeFilterForm" class="admin-actions">
          <input
            name="offerId"
            type="text"
            class="admin-input is-compact"
            placeholder="按福利 ID 筛选…"
            value="${escapeHTML(state.changeOfferId)}"
          />
          <button type="submit" class="admin-btn is-small">筛选</button>
        </form>
      </div>
      ${
        state.changes.length
          ? `<div class="admin-list">${state.changes
              .map((c) => {
                const src = safeUrl(c.sourceUrl);
                return `
              <article class="admin-card">
                <div class="admin-card-top">
                  <div>
                    <h2 class="admin-card-title">
                      <span>福利 <code>${escapeHTML(c.offerId)}</code></span>
                      <span class="status-badge is-${statusClass(CHANGE_STATUS_LABELS, c.status)}">${escapeHTML(CHANGE_STATUS_LABELS[c.status] ?? c.status)}</span>
                      <code>base v${escapeHTML(c.baseVersion)}</code>
                    </h2>
                    <div class="admin-meta">
                      <span>提交人：<code>${escapeHTML(c.createdBy)}</code></span>
                      <span>提交于 ${escapeHTML(formatDateTime(c.createdAt))}</span>
                      ${src ? `<a class="admin-link" href="${escapeHTML(src)}" target="_blank" rel="noopener noreferrer">来源依据</a>` : ''}
                      ${c.reviewedBy ? `<span>审核人：<code>${escapeHTML(c.reviewedBy)}</code> (${escapeHTML(formatDateTime(c.reviewedAt))})</span>` : ''}
                    </div>
                  </div>
                  ${
                    isAdmin && c.status === 'pending'
                      ? `<div class="admin-actions">
                          <button type="button" class="admin-btn is-small is-ok" data-change-apply="${escapeHTML(c.id)}">采纳</button>
                          <button type="button" class="admin-btn is-small is-danger" data-change-reject="${escapeHTML(c.id)}">驳回</button>
                        </div>`
                      : ''
                  }
                </div>
                <details class="admin-details" open>
                  <summary>变更内容</summary>
                  ${jsonBlock(c.changes)}
                </details>
              </article>`;
              })
              .join('')}</div>`
          : '<div class="empty-state">当前没有匹配的变更申请。</div>'
      }
    </section>
  `;
}

function renderAuditTab(state) {
  const types = [
    { value: '', label: '全部类型' },
    { value: 'offer', label: '福利 (offer)' },
    { value: 'provider', label: '提供方 (provider)' },
    { value: 'change', label: '变更 (change)' },
  ];
  return `
    <section class="admin-panel">
      <div class="admin-toolbar">
        <div class="admin-filters">
          ${types
            .map(
              (t) =>
                `<button type="button" class="admin-pill${state.auditType === t.value ? ' is-active' : ''}" data-audit-type="${escapeHTML(t.value)}">${escapeHTML(t.label)}</button>`,
            )
            .join('')}
        </div>
        <form id="auditFilterForm" class="admin-actions">
          <input
            name="entityId"
            type="text"
            class="admin-input is-compact"
            placeholder="按实体 ID 筛选…"
            value="${escapeHTML(state.auditEntityId)}"
          />
          <button type="submit" class="admin-btn is-small">筛选</button>
        </form>
      </div>
      ${
        state.audit.length
          ? `<div class="admin-list">${state.audit
              .map((entry) => {
                const src = safeUrl(entry.sourceUrl);
                return `
              <article class="admin-card">
                <div class="admin-card-top">
                  <div>
                    <h2 class="admin-card-title">
                      <code>#${escapeHTML(entry.id)}</code>
                      <span>${escapeHTML(entry.action)}</span>
                      <code>${escapeHTML(entry.entityType)}:${escapeHTML(entry.entityId)}</code>
                    </h2>
                    <div class="admin-meta">
                      <span>操作者：<code>${escapeHTML(entry.actor)}</code></span>
                      <span>时间：${escapeHTML(formatDateTime(entry.createdAt))}</span>
                      ${src ? `<a class="admin-link" href="${escapeHTML(src)}" target="_blank" rel="noopener noreferrer">证据链接</a>` : ''}
                    </div>
                  </div>
                  ${
                    isRevertibleAudit(entry)
                      ? `<button type="button" class="admin-btn is-small is-danger" data-audit-revert="${escapeHTML(entry.id)}">回滚此修改</button>`
                      : ''
                  }
                </div>
                <details class="admin-details">
                  <summary>查看快照对比 (before / after)</summary>
                  ${jsonBlock({ before: entry.before, after: entry.after })}
                </details>
              </article>`;
              })
              .join('')}</div>`
          : '<div class="empty-state">没有匹配的审计记录。</div>'
      }
    </section>
  `;
}

function renderProviderModal(modal, error) {
  const isEdit = Boolean(modal.provider);
  const p = modal.provider ?? { id: '', name: '', officialDomains: [] };
  return `
    <div class="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="providerModalTitle">
      <div class="admin-modal">
        <div class="admin-modal-head">
          <h2 id="providerModalTitle">${isEdit ? '编辑提供方' : '新建提供方'}</h2>
          <button type="button" class="admin-btn is-small" data-modal-close="1">关闭</button>
        </div>
        ${renderAlert(error)}
        <form id="providerForm" class="admin-form-grid">
          <label class="admin-field">
            <span>提供方 ID（小写字母/数字/连字符）</span>
            <input name="id" class="admin-input" value="${escapeHTML(p.id)}" ${isEdit ? 'readonly' : 'required'} placeholder="如 cloudflare" />
          </label>
          <label class="admin-field">
            <span>名称</span>
            <input name="name" class="admin-input" value="${escapeHTML(p.name)}" required placeholder="如 Cloudflare" />
          </label>
          <label class="admin-field is-full">
            <span>官方域名（逗号或换行分隔，不含协议）</span>
            <textarea name="officialDomains" class="admin-textarea" required placeholder="如 cloudflare.com, developers.cloudflare.com">${escapeHTML(p.officialDomains.join('\n'))}</textarea>
          </label>
          <div class="admin-modal-foot is-full">
            <button type="button" class="admin-btn" data-modal-close="1">取消</button>
            <button type="submit" class="admin-btn is-primary">${isEdit ? '保存修改' : '创建提供方'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderOfferModal(modal, providers, error) {
  const mode = modal.mode; // 'create' | 'edit' | 'propose'
  const offer = modal.offer ?? {
    id: '',
    providerId: providers[0]?.id ?? '',
    pool: 'ai',
    rarity: 'S',
    title: '',
    summary: '',
    benefit: '',
    officialUrl: '',
    sourceUrl: '',
    conditions: {
      newUsersOnly: false,
      studentOnly: false,
      requiresPaymentMethod: false,
      autoRenews: false,
      regions: [],
      note: '',
    },
    validFrom: '',
    validUntil: '',
    guide: null,
  };
  const titles = { create: '新建福利卡', edit: '编辑福利卡', propose: '提出变更申请' };
  const isCreate = mode === 'create';
  const guideValue = offer.guide ? JSON.stringify(offer.guide, null, 2) : '';

  return `
    <div class="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="offerModalTitle">
      <div class="admin-modal">
        <div class="admin-modal-head">
          <h2 id="offerModalTitle">${titles[mode]}</h2>
          <button type="button" class="admin-btn is-small" data-modal-close="1">关闭</button>
        </div>
        ${renderAlert(error)}
        <form id="offerForm" class="admin-form-grid">
          <label class="admin-field">
            <span>福利 ID（slug）</span>
            <input name="id" class="admin-input" value="${escapeHTML(offer.id)}" ${isCreate ? 'required' : 'readonly'} placeholder="如 example-ai-credit" />
          </label>
          <label class="admin-field">
            <span>提供方</span>
            <select name="providerId" class="admin-select" ${isCreate ? 'required' : 'disabled'}>
              ${providers
                .map(
                  (p) =>
                    `<option value="${escapeHTML(p.id)}" ${p.id === offer.providerId ? 'selected' : ''}>${escapeHTML(p.name)} (${escapeHTML(p.id)} · ${escapeHTML(p.officialDomains.join(', '))})</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="admin-field">
            <span>所属卡池</span>
            <select name="pool" class="admin-select">
              ${Object.entries(POOL_LABELS)
                .map(
                  ([v, l]) =>
                    `<option value="${v}" ${offer.pool === v ? 'selected' : ''}>${escapeHTML(l)} (${v})</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="admin-field">
            <span>稀有度</span>
            <select id="offerRaritySelect" name="rarity" class="admin-select">
              ${['A', 'S', 'SSR']
                .map(
                  (r) =>
                    `<option value="${r}" ${offer.rarity === r ? 'selected' : ''}>${r}${r === 'SSR' ? '（发布需 full 攻略）' : '（发布需 brief 攻略）'}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="admin-field is-full">
            <span>标题（≤ 60 字）</span>
            <input name="title" class="admin-input" maxlength="60" value="${escapeHTML(offer.title)}" required />
          </label>
          <label class="admin-field is-full">
            <span>核心权益（≤ 120 字，用户实际得到什么）</span>
            <input name="benefit" class="admin-input" maxlength="120" value="${escapeHTML(offer.benefit)}" required />
          </label>
          <label class="admin-field is-full">
            <span>摘要说明（≤ 200 字）</span>
            <textarea name="summary" class="admin-textarea" maxlength="200" required>${escapeHTML(offer.summary)}</textarea>
          </label>
          <label class="admin-field">
            <span>官方活动链接（https://）</span>
            <input name="officialUrl" type="url" class="admin-input" value="${escapeHTML(offer.officialUrl)}" required />
          </label>
          <label class="admin-field">
            <span>来源依据链接（https://）</span>
            <input name="sourceUrl" type="url" class="admin-input" value="${escapeHTML(offer.sourceUrl)}" required />
          </label>
          <label class="admin-field">
            <span>生效日期（可选 YYYY-MM-DD）</span>
            <input name="validFrom" type="date" class="admin-input" value="${escapeHTML(offer.validFrom ?? '')}" />
          </label>
          <label class="admin-field">
            <span>截止日期（可选 YYYY-MM-DD）</span>
            <input name="validUntil" type="date" class="admin-input" value="${escapeHTML(offer.validUntil ?? '')}" />
          </label>
          <div class="admin-field is-full">
            <span>领取条件</span>
            <div class="admin-checks">
              <label class="admin-check"><input type="checkbox" name="newUsersOnly" ${offer.conditions?.newUsersOnly ? 'checked' : ''} /> 限新用户</label>
              <label class="admin-check"><input type="checkbox" name="studentOnly" ${offer.conditions?.studentOnly ? 'checked' : ''} /> 限学生</label>
              <label class="admin-check"><input type="checkbox" name="requiresPaymentMethod" ${offer.conditions?.requiresPaymentMethod ? 'checked' : ''} /> 需绑支付方式</label>
              <label class="admin-check"><input type="checkbox" name="autoRenews" ${offer.conditions?.autoRenews ? 'checked' : ''} /> 到期自动续费</label>
            </div>
          </div>
          <label class="admin-field">
            <span>限定地区（两位大写国家码，逗号分隔；留空不限）</span>
            <input name="regions" class="admin-input" value="${escapeHTML((offer.conditions?.regions ?? []).join(', '))}" placeholder="如 US, JP" />
          </label>
          <label class="admin-field">
            <span>条件补充说明（≤ 200 字）</span>
            <input name="note" class="admin-input" maxlength="200" value="${escapeHTML(offer.conditions?.note ?? '')}" />
          </label>
          <div class="admin-field is-full">
            <div class="admin-guide-bar">
              <span>领取攻略 JSON（草稿可留空；发布时 A/S 需 brief，SSR 需 full）</span>
              <button type="button" class="admin-btn is-small" data-guide-template="1">生成对应模板</button>
            </div>
            <textarea id="offerGuideTextarea" name="guideJson" class="admin-textarea is-mono" placeholder='留空为 null，或点击「生成对应模板」'>${escapeHTML(guideValue)}</textarea>
          </div>
          ${
            mode === 'propose'
              ? `<label class="admin-field is-full">
                  <span>本次变更的证据链接（https://，须属提供方官方域名）</span>
                  <input name="proposalSourceUrl" type="url" class="admin-input" value="${escapeHTML(offer.sourceUrl)}" required />
                </label>`
              : ''
          }
          <div class="admin-modal-foot is-full">
            <button type="button" class="admin-btn" data-modal-close="1">取消</button>
            <button type="submit" class="admin-btn is-primary">${isCreate ? '创建福利卡' : mode === 'propose' ? '提交变更申请' : '保存修改'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderActionModal(modal, error) {
  const { action, offer } = modal;
  const titles = { publish: '发布福利卡', verify: '记录核验', expire: '标记福利失效' };
  const needsEvidence = action === 'verify' || action === 'expire';
  return `
    <div class="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="actionModalTitle">
      <div class="admin-modal">
        <div class="admin-modal-head">
          <h2 id="actionModalTitle">${titles[action] ?? action} · ${escapeHTML(offer.title)}</h2>
          <button type="button" class="admin-btn is-small" data-modal-close="1">关闭</button>
        </div>
        ${renderAlert(error)}
        <form id="actionForm" class="admin-form-grid">
          ${
            action === 'publish'
              ? `<label class="admin-check is-full">
                  <input type="checkbox" name="verified" checked />
                  <span>发布同时记录「已核验」（需提供与卡同主机的官方证据链接）</span>
                </label>`
              : ''
          }
          <label class="admin-field is-full">
            <span>官方证据链接（${needsEvidence ? '必填，须与卡链接同主机' : '勾选已核验时必填'}）</span>
            <input name="sourceUrl" type="url" class="admin-input" value="${escapeHTML(offer.sourceUrl)}" ${needsEvidence ? 'required' : ''} />
            <span class="admin-field-hint">卡自身主机：${escapeHTML(offer.officialUrl)} / ${escapeHTML(offer.sourceUrl)}</span>
          </label>
          <div class="admin-modal-foot is-full">
            <button type="button" class="admin-btn" data-modal-close="1">取消</button>
            <button type="submit" class="admin-btn ${action === 'expire' ? 'is-danger' : 'is-primary'}">确认执行</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderModal(state) {
  if (!state.modal) return '';
  if (state.modal.kind === 'provider') return renderProviderModal(state.modal, state.modalError);
  if (state.modal.kind === 'offer')
    return renderOfferModal(state.modal, state.providers, state.modalError);
  if (state.modal.kind === 'action') return renderActionModal(state.modal, state.modalError);
  return '';
}

/**
 * Mount the 羊毛传说 web admin console into `main`.
 * @param {{
 *   main: HTMLElement,
 *   toastEl?: HTMLElement | null,
 *   win: Window,
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function mountAdminPage({ main, toastEl, win, baseUrl = '', fetchImpl }) {
  const storage = win.sessionStorage;
  const state = {
    token: storage?.getItem(TOKEN_STORAGE_KEY) ?? '',
    me: null,
    tab: 'offers',
    loading: false,
    error: null,
    offerStatus: '',
    offerQuery: '',
    offerOffset: 0,
    offers: [],
    offerMeta: null,
    providers: [],
    changeStatus: 'pending',
    changeOfferId: '',
    changes: [],
    auditType: '',
    auditEntityId: '',
    audit: [],
    modal: null,
    modalError: null,
  };

  let toastTimer;
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2600);
  }

  const client = createManageClient({
    baseUrl,
    getToken: () => state.token,
    fetchImpl,
  });

  function render() {
    if (!state.me) {
      main.innerHTML = `${renderAlert(state.error)}${renderLogin()}`;
      return;
    }
    let body = '';
    if (state.tab === 'offers') body = renderOffersTab(state);
    else if (state.tab === 'providers') body = renderProvidersTab(state);
    else if (state.tab === 'changes') body = renderChangesTab(state);
    else if (state.tab === 'audit') body = renderAuditTab(state);

    main.innerHTML = [renderHeader(state), renderAlert(state.error), body, renderModal(state)].join(
      '',
    );
  }

  async function loadTabData() {
    state.error = null;
    if (state.tab === 'offers') {
      const [offersRes, providers] = await Promise.all([
        client.listOffers({
          status: state.offerStatus,
          limit: PAGE_SIZE,
          offset: state.offerOffset,
        }),
        client.listProviders(),
      ]);
      state.offers = offersRes.data;
      state.offerMeta = offersRes.meta;
      state.providers = providers;
    } else if (state.tab === 'providers') {
      state.providers = await client.listProviders();
    } else if (state.tab === 'changes') {
      state.changes = await client.listChanges({
        status: state.changeStatus,
        offerId: state.changeOfferId.trim(),
        limit: 100,
      });
    } else if (state.tab === 'audit') {
      state.audit = await client.listAudit({
        entityType: state.auditType,
        entityId: state.auditEntityId.trim(),
        limit: 100,
      });
    }
  }

  function signOut() {
    state.token = '';
    state.me = null;
    state.modal = null;
    state.modalError = null;
    storage?.removeItem(TOKEN_STORAGE_KEY);
  }

  /**
   * Record a failed request. A 401 means the token was revoked or expired:
   * drop it everywhere and return to the login form instead of retrying with it.
   * @param {unknown} err
   * @param {'error' | 'modalError'} [field]
   */
  function handleError(err, field = 'error') {
    if (/** @type {{ status?: number }} */ (err)?.status === 401) {
      signOut();
      state.error = err;
      return;
    }
    state[field] = err;
  }

  async function connectWithToken(token) {
    state.token = token.trim();
    state.error = null;
    try {
      state.me = await client.getMe();
      storage?.setItem(TOKEN_STORAGE_KEY, state.token);
      await loadTabData();
      showToast(`已连接（${state.me.scope}）`);
    } catch (err) {
      state.me = null;
      state.token = '';
      // Forget the stored token only when the server rejected it; a timeout or 5xx
      // keeps it so a reload can reconnect.
      const status = /** @type {{ status?: number }} */ (err)?.status;
      if (status === 401 || status === 403) storage?.removeItem(TOKEN_STORAGE_KEY);
      state.error = err;
    }
    render();
  }

  async function refresh() {
    try {
      await loadTabData();
    } catch (err) {
      handleError(err);
    }
    render();
  }

  async function runDirectTransition(id, action) {
    try {
      await client.transitionOffer(id, action, {});
      showToast(`已完成：${action}`);
      await loadTabData();
    } catch (err) {
      handleError(err);
    }
    render();
  }

  main.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = new FormData(form);

    if (form.id === 'adminLoginForm') {
      await connectWithToken(String(data.get('token') ?? ''));
      return;
    }
    if (form.id === 'changeFilterForm') {
      state.changeOfferId = String(data.get('offerId') ?? '');
      await refresh();
      return;
    }
    if (form.id === 'auditFilterForm') {
      state.auditEntityId = String(data.get('entityId') ?? '');
      await refresh();
      return;
    }

    state.modalError = null;
    try {
      if (form.id === 'providerForm' && state.modal?.kind === 'provider') {
        const officialDomains = parseListField(String(data.get('officialDomains') ?? ''), {
          lower: true,
        });
        const name = String(data.get('name') ?? '').trim();
        if (state.modal.provider) {
          await client.updateProvider(state.modal.provider.id, { name, officialDomains });
          showToast('提供方已更新');
        } else {
          await client.createProvider({
            id: String(data.get('id') ?? '').trim(),
            name,
            officialDomains,
          });
          showToast('提供方已创建');
        }
      } else if (form.id === 'offerForm' && state.modal?.kind === 'offer') {
        const built = buildOfferContent({
          pool: data.get('pool'),
          rarity: data.get('rarity'),
          title: data.get('title'),
          summary: data.get('summary'),
          benefit: data.get('benefit'),
          officialUrl: data.get('officialUrl'),
          sourceUrl: data.get('sourceUrl'),
          newUsersOnly: data.get('newUsersOnly') === 'on',
          studentOnly: data.get('studentOnly') === 'on',
          requiresPaymentMethod: data.get('requiresPaymentMethod') === 'on',
          autoRenews: data.get('autoRenews') === 'on',
          regions: data.get('regions'),
          note: data.get('note'),
          validFrom: data.get('validFrom'),
          validUntil: data.get('validUntil'),
          guideJson: data.get('guideJson'),
        });
        if (!built.ok) {
          state.modalError = { code: 'invalid_guide', message: built.error };
          render();
          return;
        }
        if (state.modal.mode === 'create') {
          await client.createOffer({
            id: String(data.get('id') ?? '').trim(),
            providerId: String(data.get('providerId') ?? '').trim(),
            ...built.content,
          });
          showToast('福利卡已创建');
        } else {
          const base = state.modal.offer;
          const changes = diffOfferContent(base, built.content);
          if (Object.keys(changes).length === 0) {
            state.modalError = { code: 'no_changes', message: '内容没有变化' };
            render();
            return;
          }
          if (state.modal.mode === 'edit') {
            await client.editOffer(base.id, { baseVersion: base.version, changes });
            showToast('福利卡已保存');
          } else {
            await client.proposeChange(base.id, {
              baseVersion: base.version,
              changes,
              sourceUrl: String(data.get('proposalSourceUrl') ?? '').trim(),
            });
            showToast('变更申请已提交');
          }
        }
      } else if (form.id === 'actionForm' && state.modal?.kind === 'action') {
        const { action, offer } = state.modal;
        const sourceUrl = String(data.get('sourceUrl') ?? '').trim();
        const body = {};
        if (sourceUrl) body.sourceUrl = sourceUrl;
        if (action === 'publish' && data.get('verified') === 'on') body.verified = true;
        await client.transitionOffer(offer.id, action, body);
        showToast(`已完成：${action}`);
      }
      state.modal = null;
      await loadTabData();
    } catch (err) {
      handleError(err, 'modalError');
    }
    render();
  });

  main.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'offerFilterInput') {
      state.offerQuery = target.value;
      const start = target.selectionStart ?? target.value.length;
      render();
      const restored = main.querySelector('#offerFilterInput');
      if (restored instanceof HTMLInputElement) {
        restored.focus();
        restored.setSelectionRange(start, start);
      }
    }
  });

  main.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(target instanceof HTMLButtonElement)) return;

    if (target.dataset.modalClose) {
      state.modal = null;
      state.modalError = null;
      render();
      return;
    }
    if (target.dataset.guideTemplate) {
      const rarityEl = main.querySelector('#offerRaritySelect');
      const area = main.querySelector('#offerGuideTextarea');
      if (rarityEl instanceof HTMLSelectElement && area instanceof HTMLTextAreaElement) {
        area.value = JSON.stringify(buildGuideTemplate(rarityEl.value), null, 2);
      }
      return;
    }
    if (target.dataset.action === 'logout') {
      signOut();
      state.error = null;
      render();
      return;
    }
    if (target.dataset.action === 'refresh') {
      await refresh();
      return;
    }
    if (target.dataset.tab) {
      state.tab = target.dataset.tab;
      await refresh();
      return;
    }
    if (target.dataset.offerStatus !== undefined) {
      state.offerStatus = target.dataset.offerStatus;
      state.offerOffset = 0;
      await refresh();
      return;
    }
    if (target.dataset.offerPage) {
      state.offerOffset =
        target.dataset.offerPage === 'next'
          ? state.offerOffset + PAGE_SIZE
          : Math.max(0, state.offerOffset - PAGE_SIZE);
      await refresh();
      return;
    }
    if (target.dataset.offerNew) {
      if (!state.providers.length) {
        state.error = { code: 'no_provider', message: '请先在「提供方」页签创建一个提供方' };
        render();
        return;
      }
      state.modal = { kind: 'offer', mode: 'create', offer: null };
      state.modalError = null;
      render();
      return;
    }
    if (target.dataset.offerEdit || target.dataset.offerPropose) {
      const id = target.dataset.offerEdit ?? target.dataset.offerPropose;
      const offer = state.offers.find((o) => o.id === id);
      if (!offer) return;
      state.modal = {
        kind: 'offer',
        mode: target.dataset.offerEdit ? 'edit' : 'propose',
        offer,
      };
      state.modalError = null;
      render();
      return;
    }
    if (target.dataset.offerAction && target.dataset.offerId) {
      const { offerAction: action, offerId: id } = target.dataset;
      if (action === 'submit' || action === 'reject' || action === 'restore') {
        await runDirectTransition(id, action);
        return;
      }
      const offer = state.offers.find((o) => o.id === id);
      if (!offer) return;
      state.modal = { kind: 'action', action, offer };
      state.modalError = null;
      render();
      return;
    }
    if (target.dataset.providerNew) {
      state.modal = { kind: 'provider', provider: null };
      state.modalError = null;
      render();
      return;
    }
    if (target.dataset.providerEdit) {
      const provider = state.providers.find((p) => p.id === target.dataset.providerEdit);
      if (!provider) return;
      state.modal = { kind: 'provider', provider };
      state.modalError = null;
      render();
      return;
    }
    if (target.dataset.changeStatus !== undefined) {
      state.changeStatus = target.dataset.changeStatus;
      await refresh();
      return;
    }
    if (target.dataset.changeApply || target.dataset.changeReject) {
      const id = target.dataset.changeApply ?? target.dataset.changeReject;
      try {
        if (target.dataset.changeApply) {
          await client.applyChange(id);
          showToast('变更已采纳');
        } else {
          await client.rejectChange(id);
          showToast('变更已驳回');
        }
        await loadTabData();
      } catch (err) {
        handleError(err);
      }
      render();
      return;
    }
    if (target.dataset.auditType !== undefined) {
      state.auditType = target.dataset.auditType;
      await refresh();
      return;
    }
    if (target.dataset.auditRevert) {
      try {
        await client.revertAudit(target.dataset.auditRevert);
        showToast('已回滚至该记录前的内容');
        await loadTabData();
      } catch (err) {
        handleError(err);
      }
      render();
    }
  });

  if (state.token) {
    void connectWithToken(state.token);
  } else {
    render();
  }
}
