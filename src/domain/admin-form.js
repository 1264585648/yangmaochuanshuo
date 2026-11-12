/* Pure form builders, diffing and display helpers for the /admin console. */

export const OFFER_STATUS_LABELS = Object.freeze({
  draft: '草稿',
  pending_review: '待审核',
  published: '已发布',
  expired: '已失效',
});

export const CHANGE_STATUS_LABELS = Object.freeze({
  pending: '待处理',
  applied: '已采纳',
  rejected: '已驳回',
});

export const POOL_LABELS = Object.freeze({
  ai: 'AI 福利',
  cloud: '云服务器',
  software: '软件工具',
  education: '教育优惠',
});

export const REVERTIBLE_AUDIT_ACTIONS = new Set(['offer.update', 'change.apply', 'audit.revert']);

/**
 * Split a comma/whitespace/newline-separated string into unique trimmed items.
 * @param {string} raw
 * @param {{ upper?: boolean, lower?: boolean }} [opts]
 * @returns {string[]}
 */
export function parseListField(raw, { upper = false, lower = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? '').split(/[\s,，;；]+/)) {
    let item = part.trim();
    if (!item) continue;
    if (upper) item = item.toUpperCase();
    else if (lower) item = item.toLowerCase();
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Parse an optional guide JSON string. Empty string means `null`.
 * @param {string} raw
 * @returns {{ ok: true, guide: unknown | null } | { ok: false, error: string }}
 */
export function parseGuideInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { ok: true, guide: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '攻略 JSON 必须是对象格式' };
    }
    return { ok: true, guide: parsed };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `攻略 JSON 格式错误：${detail}` };
  }
}

/**
 * Build a valid starter guide template matching the rarity rule (`SSR` -> full, others -> brief).
 * @param {string} rarity
 * @returns {Record<string, unknown>}
 */
export function buildGuideTemplate(rarity) {
  if (rarity === 'SSR') {
    return {
      kind: 'full',
      phases: [
        {
          title: '准备条件',
          note: '',
          steps: [{ text: '准备符合要求的账号与验证方式。' }],
        },
        {
          title: '领取步骤',
          note: '',
          steps: [{ text: '前往官方活动页完成申请并核对额度到账。' }],
        },
      ],
      facts: [{ label: '适用对象', value: '按官方规则', note: '' }],
      faq: [],
      references: [],
    };
  }
  return {
    kind: 'brief',
    steps: [
      { text: '打开官方活动页并登录符合条件的账号。' },
      { text: '按页面指引完成身份或账单方式校验。' },
      { text: '领取福利后在控制台确认额度与到期时间。' },
    ],
  };
}

/**
 * Build normalized offer content from form values.
 * @param {Record<string, unknown>} input
 * @returns {{ ok: true, content: Record<string, unknown> } | { ok: false, error: string }}
 */
export function buildOfferContent(input) {
  const parsedGuide = parseGuideInput(String(input.guideJson ?? ''));
  if (!parsedGuide.ok) return parsedGuide;
  const validFrom = String(input.validFrom ?? '').trim() || null;
  const validUntil = String(input.validUntil ?? '').trim() || null;
  return {
    ok: true,
    content: {
      pool: String(input.pool ?? 'ai'),
      rarity: String(input.rarity ?? 'S'),
      title: String(input.title ?? '').trim(),
      summary: String(input.summary ?? '').trim(),
      benefit: String(input.benefit ?? '').trim(),
      officialUrl: String(input.officialUrl ?? '').trim(),
      sourceUrl: String(input.sourceUrl ?? '').trim(),
      conditions: {
        newUsersOnly: Boolean(input.newUsersOnly),
        studentOnly: Boolean(input.studentOnly),
        requiresPaymentMethod: Boolean(input.requiresPaymentMethod),
        autoRenews: Boolean(input.autoRenews),
        regions: parseListField(String(input.regions ?? ''), { upper: true }),
        note: String(input.note ?? '').trim(),
      },
      validFrom,
      validUntil,
      guide: parsedGuide.guide,
    },
  };
}

const CONTENT_FIELDS = [
  'pool',
  'rarity',
  'title',
  'summary',
  'benefit',
  'officialUrl',
  'sourceUrl',
  'conditions',
  'validFrom',
  'validUntil',
  'guide',
];

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/**
 * Compute minimal patch object containing only changed content fields.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {Record<string, unknown>}
 */
export function diffOfferContent(before, after) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const key of CONTENT_FIELDS) {
    if (!deepEqual(before[key], after[key])) {
      patch[key] = after[key];
    }
  }
  return patch;
}

/**
 * Whether an audit log entry can be reverted via `POST /api/manage/audit/:id/revert`.
 * @param {{ entityType?: string, action?: string }} entry
 * @returns {boolean}
 */
export function isRevertibleAudit(entry) {
  return entry?.entityType === 'offer' && REVERTIBLE_AUDIT_ACTIONS.has(String(entry?.action ?? ''));
}

/**
 * Format an API or unexpected error for display in the admin UI.
 * @param {unknown} error
 * @returns {{ message: string, details: string[] }}
 */
export function formatApiError(error) {
  if (!error || typeof error !== 'object') {
    return { message: String(error ?? '未知错误'), details: [] };
  }
  const e =
    /** @type {{ code?: string, message?: string, details?: unknown[], retryAfter?: number | null }} */ (
      error
    );
  const prefix = e.code ? `[${e.code}] ` : '';
  const retry = e.retryAfter ? `（请在 ${e.retryAfter} 秒后重试）` : '';
  const details = Array.isArray(e.details)
    ? e.details.map((d) => {
        if (d && typeof d === 'object' && 'path' in d && 'message' in d) {
          return `${String(d.path || 'body')}: ${String(d.message)}`;
        }
        return JSON.stringify(d);
      })
    : [];
  return {
    message: `${prefix}${e.message || '请求失败'}${retry}`,
    details,
  };
}
