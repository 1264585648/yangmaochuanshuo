/* Display helpers for catalog data. All return plain text; callers escape. */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Only https links reach an href. `escapeHTML` does not make a URL safe.
 * @param {unknown} value
 * @returns {string | null} Canonical href, or null when unsafe.
 */
export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * @param {string} href
 * @returns {string} Host without a leading `www.`.
 */
export function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * @param {string | null} iso Date or timestamp.
 * @returns {string} YYYY-MM-DD, or '' when absent or malformed.
 */
export function formatDate(iso) {
  if (!iso) return '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1] : '';
}

/**
 * @param {string | null} iso
 * @param {Date} now
 * @returns {string} e.g. 「今天核验」「3 天前核验」「尚未核验」
 */
export function verifiedLabel(iso, now) {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return '尚未核验';
  const days = Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
  if (days === 0) return '今天核验';
  if (days < 60) return `${days} 天前核验`;
  return `核验于 ${formatDate(iso)}`;
}

/**
 * @param {string | null} validUntil
 * @returns {string}
 */
export function validityLabel(validUntil) {
  const date = formatDate(validUntil);
  return date ? `有效至 ${date}` : '长期有效';
}

let regionNames = null;
function regionName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * @typedef {{ label: string, tone: 'info' | 'warn' }} ConditionChip
 * @param {import('../domain/offer.js').Conditions} conditions
 * @returns {ConditionChip[]}
 */
export function conditionChips(conditions) {
  const chips = [];
  if (conditions.newUsersOnly) chips.push({ label: '仅限新用户', tone: 'info' });
  if (conditions.studentOnly) chips.push({ label: '需学生身份', tone: 'info' });
  if (conditions.requiresPaymentMethod) chips.push({ label: '需绑定支付方式', tone: 'warn' });
  if (conditions.autoRenews) chips.push({ label: '到期自动续费', tone: 'warn' });
  const regions = conditions.regions;
  if (regions.length > 0) {
    const shown = regions.slice(0, 3).map(regionName).join('、');
    const more = regions.length > 3 ? ` 等 ${regions.length} 地` : '';
    chips.push({ label: `限 ${shown}${more}`, tone: 'info' });
  }
  return chips;
}
