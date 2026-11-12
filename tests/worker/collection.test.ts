import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedOffers, seedProvider } from './helpers/seed';
import { createUserApi, cookieFrom, type UserApi } from './helpers/user-api';
import { SESSION, DAILY_DRAWS } from '../../worker/src/config';
import { SESSION_COOKIE } from '../../worker/src/auth/session';

const NOW = new Date('2026-11-12T03:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let api: UserApi;

beforeEach(async () => {
  // random 0 → tier A, first card: deterministic picks.
  api = await createUserApi(NOW, { random: () => 0 });
  await seedProvider(api.db);
  await seedOffers(api.db, [
    { id: 'ai-a', pool: 'ai', rarity: 'A' },
    { id: 'ai-s', pool: 'ai', rarity: 'S' },
    { id: 'cloud-a', pool: 'cloud', rarity: 'A' },
    { id: 'cloud-ssr', pool: 'cloud', rarity: 'SSR' },
    { id: 'edu-a', pool: 'education', rarity: 'A' },
    { id: 'ai-draft', pool: 'ai', rarity: 'SSR', status: 'draft', title: 'Secret draft' },
    { id: 'ai-pending', pool: 'ai', rarity: 'S', status: 'pending_review' },
  ]);
}, 60_000);

afterEach(async () => {
  await api.t.dispose();
});

const expire = (id: string) =>
  api.db.prepare("UPDATE offers SET status = 'expired' WHERE id = ?").bind(id).run();

describe('GET /api/me/collection', () => {
  it('is empty with zero progress for anonymous callers', async () => {
    const { res, body } = await api.call('GET', '/api/me/collection');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.data.cards).toEqual([]);
    expect(body.data.progress.live).toEqual({ found: 0, total: 5 });
    expect(body.data.progress.retired).toBe(0);
  });

  it('lists each drawn card once with counts, dates and favorite flag', async () => {
    const cookie = await api.guestCookie();
    await api.draw('ai', { cookie });
    api.setNow(new Date(NOW.getTime() + 60_000));
    await api.draw('ai', { cookie });
    await api.draw('cloud', { cookie });

    const { body } = await api.call('GET', '/api/me/collection', { cookie });
    const cards = body.data.cards;
    expect(cards.map((c: { offer: { id: string } }) => c.offer.id)).toEqual(['cloud-a', 'ai-a']);
    expect(cards[1]).toMatchObject({
      drawCount: 2,
      firstDrawnAt: NOW.toISOString(),
      lastDrawnAt: new Date(NOW.getTime() + 60_000).toISOString(),
      favorite: false,
      live: true,
    });
    expect(cards[1].offer).not.toHaveProperty('guide');
    expect(body.data.progress.live).toEqual({ found: 2, total: 5 });
    expect(body.data.progress.byPool).toEqual([
      { pool: 'ai', found: 1, total: 2 },
      { pool: 'cloud', found: 1, total: 2 },
      { pool: 'software', found: 0, total: 0 },
      { pool: 'education', found: 0, total: 1 },
    ]);
    expect(body.data.progress.byRarity).toEqual([
      { rarity: 'SSR', found: 0, total: 1 },
      { rarity: 'S', found: 0, total: 1 },
      { rarity: 'A', found: 2, total: 3 },
    ]);
  });

  it('keeps retired cards, flagged and counted separately from live progress', async () => {
    const cookie = await api.guestCookie();
    await api.draw('ai', { cookie });
    await expire('ai-a');
    const { body } = await api.call('GET', '/api/me/collection', { cookie });
    expect(body.data.cards).toHaveLength(1);
    expect(body.data.cards[0]).toMatchObject({ live: false });
    // Retired cards keep only identifying fields: no links, terms or summary.
    expect(body.data.cards[0].offer).toEqual({
      id: 'ai-a',
      provider: { id: 'example', name: 'Example' },
      pool: 'ai',
      rarity: 'A',
      title: 'Offer ai-a',
      retired: true,
    });
    const hist = await api.call('GET', '/api/me/draws', { cookie });
    expect(hist.body.data.items[0].offer).toMatchObject({ id: 'ai-a', retired: true });
    expect(hist.body.data.items[0].offer).not.toHaveProperty('officialUrl');
    expect(body.data.progress.live).toEqual({ found: 0, total: 4 });
    expect(body.data.progress.retired).toBe(1);
  });
});

describe('GET /api/me/draws', () => {
  it('pages through real draws newest first', async () => {
    const cookie = await api.guestCookie();
    for (let i = 0; i < DAILY_DRAWS; i++) {
      api.setNow(new Date(NOW.getTime() + i * 1000));
      await api.draw(i === 1 ? 'cloud' : 'ai', { cookie });
    }
    const first = await api.call('GET', '/api/me/draws?limit=2', { cookie });
    expect(first.res.status).toBe(200);
    expect(first.body.data.items.map((d: { offer: { id: string } }) => d.offer.id)).toEqual([
      'ai-a',
      'cloud-a',
    ]);
    expect(first.body.data.items[0]).toMatchObject({ pool: 'ai', rarity: 'A', live: true });
    const cursor = first.body.data.nextCursor;
    expect(cursor).toMatch(/^d_/);

    const second = await api.call('GET', `/api/me/draws?limit=2&before=${cursor}`, { cookie });
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.nextCursor).toBeNull();
  });

  it('is empty for anonymous callers and another user’s cursor', async () => {
    const cookie = await api.guestCookie();
    const { body: drawn } = await api.draw('ai', { cookie });
    const anon = await api.call('GET', '/api/me/draws');
    expect(anon.body.data).toEqual({ items: [], nextCursor: null });
    const other = await api.call('GET', `/api/me/draws?before=${drawn.data.draw.id}`, {
      cookie: await api.guestCookie(),
    });
    expect(other.body.data.items).toEqual([]);
  });

  it.each(['limit=0', 'limit=51', 'limit=x', 'before=nope', 'page=2'])(
    'rejects %s',
    async (query) => {
      const { res, body } = await api.call('GET', `/api/me/draws?${query}`);
      expect(res.status).toBe(400);
      expect(body.error?.code).toBe('invalid_query');
    },
  );
});

describe('favorites', () => {
  it('can be set and cleared on owned cards, and shows in draws and the collection', async () => {
    const cookie = await api.guestCookie();
    await api.draw('ai', { cookie });
    const put = await api.call('PUT', '/api/me/favorites/ai-a', { cookie });
    expect(put.res.status).toBe(200);
    expect(put.body.data).toEqual({ offerId: 'ai-a', favorite: true });
    expect((await api.call('PUT', '/api/me/favorites/ai-a', { cookie })).res.status).toBe(200);
    expect(await api.count('SELECT COUNT(*) AS n FROM favorites')).toBe(1);

    const again = await api.draw('ai', { cookie });
    expect(again.body.data.draw.favorite).toBe(true);
    const col = await api.call('GET', '/api/me/collection', { cookie });
    expect(col.body.data.cards[0].favorite).toBe(true);

    const del = await api.call('DELETE', '/api/me/favorites/ai-a', { cookie });
    expect(del.body.data).toEqual({ offerId: 'ai-a', favorite: false });
    expect(await api.count('SELECT COUNT(*) AS n FROM favorites')).toBe(0);
  });

  it('refuses cards the caller does not own', async () => {
    const cookie = await api.guestCookie();
    for (const opts of [{ cookie }, {}]) {
      const { res, body } = await api.call('PUT', '/api/me/favorites/cloud-ssr', opts);
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe('not_found');
    }
  });

  it('refuses cross-origin writes and other methods', async () => {
    const cookie = await api.guestCookie();
    const cross = await api.call('PUT', '/api/me/favorites/ai-a', {
      cookie,
      origin: 'https://evil.example',
    });
    expect(cross.res.status).toBe(403);
    const post = await api.call('POST', '/api/me/favorites/ai-a', { cookie });
    expect(post.res.status).toBe(405);
    expect(post.res.headers.get('allow')).toBe('PUT, DELETE');
  });
});

describe('per-user write limit', () => {
  it('limits favorite toggles per user', async () => {
    await api.t.dispose();
    api = await createUserApi(NOW, {
      random: () => 0,
      userLimits: {
        guestsPerIp: { max: 20, windowSeconds: 3600 },
        drawsPerIp: { max: 120, windowSeconds: 3600 },
        writesPerUser: { max: 3, windowSeconds: 60 },
      },
    });
    await seedProvider(api.db);
    await seedOffers(api.db, [{ id: 'ai-a', pool: 'ai', rarity: 'A' }]);
    const cookie = await api.guestCookie();
    await api.draw('ai', { cookie });
    for (let i = 0; i < 3; i++) {
      expect((await api.call('PUT', '/api/me/favorites/ai-a', { cookie })).res.status).toBe(200);
    }
    const { res, body } = await api.call('DELETE', '/api/me/favorites/ai-a', { cookie });
    expect(res.status).toBe(429);
    expect(body.error?.code).toBe('rate_limited');
  });
});

describe('POST /api/me/import', () => {
  const ts = (iso: string) => Date.parse(iso);

  it('imports live legacy cards once, without touching today’s quota', async () => {
    const cookie = await api.guestCookie();
    const payload = {
      collection: [
        { id: 'ai-s', ts: NOW.getTime() - 1000 },
        { id: 'ai-s', ts: ts('2026-10-01T00:00:00Z') },
        { id: 'cloud-ssr', ts: NOW.getTime() },
        { id: 'ai-draft', ts: NOW.getTime() },
        { id: 'missing', ts: NOW.getTime() },
      ],
      favorites: ['ai-s', 'ai-draft', 'edu-a'],
    };
    const first = await api.call('POST', '/api/me/import', { cookie, body: payload });
    expect(first.res.status).toBe(200);
    expect(first.body.data).toEqual({ imported: 2, favorites: 1 });

    const col = await api.call('GET', '/api/me/collection', { cookie });
    const ids = col.body.data.cards.map((c: { offer: { id: string } }) => c.offer.id).sort();
    expect(ids).toEqual(['ai-s', 'cloud-ssr']);
    const aiS = col.body.data.cards.find((c: { offer: { id: string } }) => c.offer.id === 'ai-s');
    expect(aiS).toMatchObject({ firstDrawnAt: '2026-10-01T00:00:00.000Z', favorite: true });

    // Imports never count toward the daily quota or the history.
    const me = await api.call('GET', '/api/me', { cookie });
    expect(me.body.data.quota.used).toBe(0);
    for (let i = 0; i < DAILY_DRAWS; i++) {
      expect((await api.draw('cloud', { cookie })).res.status).toBe(201);
    }
    const hist = await api.call('GET', '/api/me/draws', { cookie });
    expect(hist.body.data.items).toHaveLength(DAILY_DRAWS);

    const second = await api.call('POST', '/api/me/import', { cookie, body: payload });
    expect(second.res.status).toBe(409);
    expect(second.body.error?.code).toBe('already_imported');
  });

  it('marks a later real draw of an imported card as not new', async () => {
    const cookie = await api.guestCookie();
    await api.call('POST', '/api/me/import', {
      cookie,
      body: { collection: [{ id: 'cloud-a', ts: NOW.getTime() }], favorites: [] },
    });
    const { body } = await api.draw('cloud', { cookie });
    expect(body.data.draw.isNew).toBe(false);
  });

  it('creates a guest when the caller has none, and sets the cookie', async () => {
    const { res, body } = await api.call('POST', '/api/me/import', {
      body: { collection: [{ id: 'edu-a', ts: NOW.getTime() }], favorites: [] },
    });
    expect(res.status).toBe(200);
    expect(body.data.imported).toBe(1);
    const cookie = cookieFrom(res);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    const col = await api.call('GET', '/api/me/collection', { cookie });
    expect(col.body.data.cards).toHaveLength(1);
  });

  it('does not create a user when nothing is importable', async () => {
    const { res, body } = await api.call('POST', '/api/me/import', {
      body: { collection: [{ id: 'ai-draft', ts: NOW.getTime() }], favorites: ['ai-a'] },
    });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ imported: 0, favorites: 0 });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await api.count('SELECT COUNT(*) AS n FROM users')).toBe(0);
  });

  it('does not use up the one-time import when nothing is importable', async () => {
    const cookie = await api.guestCookie();
    const empty = await api.call('POST', '/api/me/import', {
      cookie,
      body: { collection: [{ id: 'ai-draft', ts: NOW.getTime() }], favorites: [] },
    });
    expect(empty.body.data).toEqual({ imported: 0, favorites: 0 });
    const real = await api.call('POST', '/api/me/import', {
      cookie,
      body: { collection: [{ id: 'ai-a', ts: NOW.getTime() }], favorites: [] },
    });
    expect(real.res.status).toBe(200);
    expect(real.body.data.imported).toBe(1);
  });

  it('clamps timestamps into the past year', async () => {
    const cookie = await api.guestCookie();
    await api.call('POST', '/api/me/import', {
      cookie,
      body: {
        collection: [
          { id: 'ai-a', ts: NOW.getTime() + 10 * DAY_MS },
          { id: 'cloud-a', ts: 0 },
        ],
        favorites: [],
      },
    });
    const col = await api.call('GET', '/api/me/collection', { cookie });
    const at = Object.fromEntries(
      col.body.data.cards.map((c: { offer: { id: string }; firstDrawnAt: string }) => [
        c.offer.id,
        c.firstDrawnAt,
      ]),
    );
    expect(at['ai-a']).toBe(NOW.toISOString());
    expect(at['cloud-a']).toBe(new Date(NOW.getTime() - 365 * DAY_MS).toISOString());
  });

  it('allows only one of two concurrent imports', async () => {
    const cookie = await api.guestCookie();
    const body = { collection: [{ id: 'ai-a', ts: NOW.getTime() }], favorites: [] };
    const results = await Promise.all([
      api.call('POST', '/api/me/import', { cookie, body }),
      api.call('POST', '/api/me/import', { cookie, body }),
    ]);
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 409]);
    expect(await api.count('SELECT COUNT(*) AS n FROM draws')).toBe(1);
  });

  it('keeps import rows out of the draw idempotency namespace', async () => {
    const cookie = await api.guestCookie();
    await api.call('POST', '/api/me/import', {
      cookie,
      body: { collection: [{ id: 'cloud-ssr', ts: NOW.getTime() }], favorites: [] },
    });
    const { res, body } = await api.draw('cloud', { cookie, key: 'import:cloud-ssr' });
    expect(res.status).toBe(201);
    expect(body.data.offer.id).toBe('cloud-a');
  });

  it.each([
    ['missing fields', {}],
    ['extra field', { collection: [], favorites: [], quota: 9 }],
    ['too many entries', { collection: Array(101).fill({ id: 'ai-a', ts: 1 }), favorites: [] }],
    ['bad entry', { collection: [{ id: 'ai-a', ts: 'yesterday' }], favorites: [] }],
  ])('rejects %s', async (_label, body) => {
    const { res, body: out } = await api.call('POST', '/api/me/import', {
      cookie: await api.guestCookie(),
      body,
    });
    expect(res.status).toBe(400);
    expect(out.error?.code).toBe('invalid_body');
  });
});

describe('session renewal on every user response', () => {
  it('sends the renewed cookie even when a draw is refused', async () => {
    const cookie = await api.guestCookie();
    for (let i = 0; i < DAILY_DRAWS; i++) await api.draw('cloud', { cookie });
    // Same quota day is not possible 30 days later, so renew via a refused import instead.
    api.setNow(new Date(NOW.getTime() + (SESSION.renewAfterDays + 1) * DAY_MS));
    const { res } = await api.call('POST', '/api/me/import', { cookie, body: {} });
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toContain(cookie);
  });

  it('sends the renewed cookie on an empty pool', async () => {
    const cookie = await api.guestCookie();
    api.setNow(new Date(NOW.getTime() + (SESSION.renewAfterDays + 1) * DAY_MS));
    const { res } = await api.draw('software', { cookie });
    expect(res.status).toBe(409);
    expect(res.headers.get('set-cookie')).toContain(cookie);
  });
});
