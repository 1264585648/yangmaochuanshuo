/* In-memory stand-in for the public `/api/offers` endpoint and the user API,
   for page tests. */
import { apiOffer, jsonResponse, listEnvelope } from './offers.js';
import { createFakeUserApi } from './fake-user-api.js';

export const CATALOG = Object.freeze([
  apiOffer({ id: 'ai-basic', pool: 'ai', rarity: 'A', title: '对话额度', benefit: '每日 50 次' }),
  apiOffer({ id: 'ai-api', pool: 'ai', rarity: 'S', title: 'API 试用金', benefit: '5 美元' }),
  apiOffer({ id: 'ai-pro', pool: 'ai', rarity: 'SSR', title: '编程助手', benefit: '30 天' }),
  apiOffer({ id: 'cloud-vps', pool: 'cloud', rarity: 'A', title: 'VPS 折扣', benefit: '5 折' }),
  apiOffer({
    id: 'edu-pack',
    pool: 'education',
    rarity: 'S',
    title: '学生礼包',
    benefit: '学生授权',
    conditions: { ...apiOffer({ id: 'x' }).conditions, studentOnly: true },
  }),
]);

const FLAGS = ['newUsersOnly', 'studentOnly', 'requiresPaymentMethod', 'autoRenews'];
const NOT_FOUND = {
  success: false,
  data: null,
  error: { code: 'not_found', message: 'Resource not found' },
};

/**
 * @param {{ offers?: readonly object[] }} [options]
 * @returns {{ fetch: (url: string, init?: RequestInit) => Promise<Response>, hold: () => void,
 *   release: () => void, fail: (on: boolean) => void, setOffers: (next: readonly object[]) => void,
 *   calls: string[], user: ReturnType<typeof createFakeUserApi> }}
 *   `calls` lists catalog requests only; user API calls are in `user.calls`.
 */
export function createFakeApi({ offers: initial = CATALOG } = {}) {
  let offers = initial;
  let gate = null;
  let open = () => {};
  let failing = false;
  const calls = [];
  /** Public limited-prize rules served at `/api/prizes` (not logged in `calls`). */
  let prizes = [];
  const user = createFakeUserApi({ offers: () => offers });

  async function fetchImpl(url, init = {}) {
    const parsed = new URL(String(url), 'https://dealdex.test');
    if (parsed.pathname === '/api/prizes') {
      return jsonResponse({ success: true, data: prizes, error: null });
    }
    const isUser = parsed.pathname === '/api/draws' || parsed.pathname.startsWith('/api/me');
    if (!isUser) calls.push(String(url));
    if (gate) await gate;
    if (failing) throw new TypeError('Failed to fetch');
    const handled = await user.handle(parsed, init);
    if (handled) return handled;
    const detail = /^\/api\/offers\/([^/]+)$/.exec(parsed.pathname);
    if (detail) {
      const found = offers.find((o) => o.id === decodeURIComponent(detail[1]));
      return found
        ? jsonResponse({ success: true, data: found, error: null })
        : jsonResponse(NOT_FOUND, 404);
    }
    const p = parsed.searchParams;
    const q = (p.get('q') ?? '').toLowerCase();
    const flagsMatch = (o) =>
      FLAGS.every((flag) => !p.get(flag) || String(o.conditions[flag]) === p.get(flag));
    const matches = offers.filter(
      (o) =>
        (!p.get('pool') || o.pool === p.get('pool')) &&
        (!p.get('rarity') || o.rarity === p.get('rarity')) &&
        flagsMatch(o) &&
        (!q || `${o.title}${o.benefit}${o.provider.name}`.toLowerCase().includes(q)),
    );
    const limit = Number(p.get('limit') ?? 50);
    const offset = Number(p.get('offset') ?? 0);
    return jsonResponse(
      listEnvelope(matches.slice(offset, offset + limit), { total: matches.length, limit, offset }),
    );
  }

  return {
    fetch: fetchImpl,
    hold() {
      gate = new Promise((resolve) => (open = resolve));
    },
    release() {
      gate = null;
      open();
    },
    fail(on) {
      failing = on;
    },
    setOffers(next) {
      offers = next;
    },
    setPrizes(next) {
      prizes = next;
    },
    calls,
    user,
  };
}
