/* In-memory stand-in for the user API (`/api/me*`, `/api/draws`) for page
   tests. Mirrors the server's rules: quota, idempotent replays, empty pools,
   retired cards and the one-time import. */
import { drawFromPool } from '../../src/domain/catalog.js';
import { jsonResponse } from './offers.js';

const POOLS = ['ai', 'cloud', 'software', 'education'];
const RARITIES = ['SSR', 'S', 'A'];
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Quota day in Beijing time and its end, from the (possibly faked) clock. */
function quotaClock() {
  const shifted = Date.now() + OFFSET_MS;
  return {
    day: new Date(shifted).toISOString().slice(0, 10),
    resetsAt: new Date((Math.floor(shifted / DAY_MS) + 1) * DAY_MS - OFFSET_MS).toISOString(),
  };
}

const ok = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const fail = (status, code, details) =>
  jsonResponse(
    {
      success: false,
      data: null,
      error: { code, message: code, ...(details ? { details } : {}) },
    },
    status,
  );

/**
 * @param {{ offers: () => readonly any[], max?: number }} options
 *   `offers` returns the current live catalog.
 */
export function createFakeUserApi({ offers, max = 3 }) {
  let user = null;
  let used = 0;
  let usedDay = quotaClock().day;
  let imported = false;
  let seq = 0;
  /** @type {{ id: string, key: string, offer: any, pool: string, at: string }[]} */
  const draws = [];
  const favorites = new Set();
  /** @type {'network' | 'server' | 'lost' | null} 'lost' records the draw, then drops the reply. */
  let drawFailure = null;
  let drawGate = null;
  let importGate = null;
  const calls = [];

  const quota = () => {
    const { day, resetsAt } = quotaClock();
    if (day !== usedDay) {
      usedDay = day;
      used = 0;
    }
    return { max, used, day, resetsAt };
  };
  const live = (id) => offers().find((o) => o.id === id);
  const owned = (offer) => {
    const current = live(offer.id);
    if (current) return current;
    const { id, provider, pool, rarity, title } = offer;
    return { id, provider, pool, rarity, title, retired: true };
  };
  const drawView = (d, index) => ({
    id: d.id,
    pool: d.pool,
    rarity: d.offer.rarity,
    createdAt: d.at,
    isNew: draws.findIndex((x) => x.offer.id === d.offer.id) === index,
    favorite: favorites.has(d.offer.id),
  });
  const ensureUser = () => {
    if (!user) user = { id: 'u_fake', kind: 'guest', createdAt: '2026-11-12T00:00:00.000Z' };
  };

  function draw(key, pool) {
    const index = draws.findIndex((d) => d.key === key);
    if (index !== -1) {
      const d = draws[index];
      return ok({ draw: drawView(d, index), offer: owned(d.offer), quota: quota() }, 200);
    }
    if (user && quota().used >= max) return fail(429, 'quota_exhausted', quota());
    const picked = drawFromPool(offers(), pool, () => 0);
    if (!picked) return fail(409, 'pool_empty');
    ensureUser();
    used += 1;
    const d = {
      id: `d_${++seq}`,
      key,
      offer: picked,
      pool,
      at: new Date(seq * 1000).toISOString(),
    };
    draws.push(d);
    return ok({ draw: drawView(d, draws.length - 1), offer: picked, quota: quota() }, 201);
  }

  function collection() {
    const ids = [...new Set([...draws].reverse().map((d) => d.offer.id))];
    const cards = ids.map((id) => {
      const mine = draws.filter((d) => d.offer.id === id);
      return {
        offer: owned(mine[0].offer),
        firstDrawnAt: mine[0].at,
        lastDrawnAt: mine.at(-1).at,
        drawCount: mine.length,
        favorite: favorites.has(id),
        live: Boolean(live(id)),
      };
    });
    const tally = (match) => {
      const pool = offers().filter(match);
      return { found: pool.filter((o) => ids.includes(o.id)).length, total: pool.length };
    };
    return ok({
      cards,
      progress: {
        live: tally(() => true),
        retired: cards.filter((c) => !c.live).length,
        byPool: POOLS.map((pool) => ({ pool, ...tally((o) => o.pool === pool) })),
        byRarity: RARITIES.map((rarity) => ({ rarity, ...tally((o) => o.rarity === rarity) })),
      },
    });
  }

  function history(before) {
    const all = [...draws].reverse();
    const start = before ? all.findIndex((d) => d.id === before) + 1 : 0;
    const page = all.slice(start, start + 20);
    return ok({
      items: page.map((d) => ({
        id: d.id,
        pool: d.pool,
        rarity: d.offer.rarity,
        createdAt: d.at,
        offer: owned(d.offer),
        live: Boolean(live(d.offer.id)),
      })),
      nextCursor: start + 20 < all.length ? page.at(-1).id : null,
    });
  }

  function importLegacy(body) {
    if (imported) return fail(409, 'already_imported');
    const keep = body.collection.filter((e) => live(e.id));
    if (keep.length === 0) return ok({ imported: 0, favorites: 0 });
    ensureUser();
    imported = true;
    for (const entry of keep) {
      draws.unshift({
        id: `i_${entry.id}`,
        key: `import#${entry.id}`,
        offer: live(entry.id),
        pool: live(entry.id).pool,
        at: new Date(entry.ts).toISOString(),
      });
    }
    const favs = body.favorites.filter((id) => draws.some((d) => d.offer.id === id));
    favs.forEach((id) => favorites.add(id));
    return ok({ imported: keep.length, favorites: favs.length });
  }

  /** @returns {Promise<Response> | null} null when the path is not a user endpoint. */
  async function handle(url, init = {}) {
    const method = init.method ?? 'GET';
    const path = url.pathname;
    if (!(path === '/api/draws' || path === '/api/me' || path.startsWith('/api/me/'))) return null;
    calls.push(`${method} ${path}${url.search}`);
    if (path === '/api/draws') {
      if (drawGate) await drawGate;
      if (drawFailure === 'network') throw new TypeError('Failed to fetch');
      if (drawFailure === 'server') return fail(503, 'unavailable');
      const key = new Headers(init.headers).get('idempotency-key');
      const reply = draw(key, JSON.parse(init.body).pool);
      if (drawFailure === 'lost') throw new TypeError('Failed to fetch');
      return reply;
    }
    if (path === '/api/me') return ok({ user, quota: quota() });
    if (path === '/api/me/collection') return collection();
    if (path === '/api/me/draws') return history(url.searchParams.get('before'));
    if (path === '/api/me/import') {
      if (importGate) await importGate;
      return importLegacy(JSON.parse(init.body));
    }
    const fav = /^\/api\/me\/favorites\/(.+)$/.exec(path);
    if (fav) {
      const id = decodeURIComponent(fav[1]);
      if (!draws.some((d) => d.offer.id === id)) return fail(404, 'not_found');
      if (method === 'PUT') favorites.add(id);
      else favorites.delete(id);
      return ok({ offerId: id, favorite: method === 'PUT' });
    }
    return fail(404, 'not_found');
  }

  return {
    handle,
    calls,
    favorites,
    draws,
    /** @param {'network' | 'server' | 'lost' | null} mode */
    failDraws(mode) {
      drawFailure = mode;
    },
    holdImports() {
      let open;
      importGate = new Promise((resolve) => (open = resolve));
      return () => {
        importGate = null;
        open();
      };
    },
    holdDraws() {
      let open;
      drawGate = new Promise((resolve) => (open = resolve));
      return () => {
        drawGate = null;
        open();
      };
    },
    get used() {
      return used;
    },
  };
}
