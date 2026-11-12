import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { seedOffers, seedProvider } from './helpers/seed';
import { createHandler, type AppOptions } from '../../worker/src/app';
import { SESSION_COOKIE, createSession, revokeSession } from '../../worker/src/auth/session';
import { DAILY_DRAWS } from '../../worker/src/config';

type D1Database = Env['DB'];

const NOW = new Date('2026-11-12T03:00:00Z');
const ORIGIN = 'https://dealdex.test';
const IP = '203.0.113.7';

interface Body {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions on dynamic JSON
  data: any;
  error: { code: string; details?: unknown } | null;
}

let t: TestDb;
let db: D1Database;
let clock: Date;
let keySeq = 0;

function makeApp(
  options: AppOptions = {},
  secret: string | null = 'test-ip-secret-at-least-32-characters',
) {
  const app = createHandler({ now: () => clock, ...options });
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset') },
    ...(secret === null ? {} : { IP_HASH_SECRET: secret }),
  } as unknown as Env;
  return (request: Request) => app.fetch(request, env);
}

let send = makeApp();

interface DrawOpts {
  cookie?: string | null;
  key?: string | null;
  ip?: string;
  origin?: string;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
}

async function draw(pool: string | null = 'ai', opts: DrawOpts = {}) {
  const headers = new Headers({ origin: opts.origin ?? ORIGIN, 'cf-connecting-ip': opts.ip ?? IP });
  if (opts.cookie) headers.set('cookie', opts.cookie);
  const key = opts.key === undefined ? `draw-${++keySeq}` : opts.key;
  if (key) headers.set('idempotency-key', key);
  const body = opts.rawBody ?? JSON.stringify(opts.body ?? { pool });
  headers.set('content-type', opts.contentType ?? 'application/json');
  const res = await send(new Request(`${ORIGIN}/api/draws`, { method: 'POST', headers, body }));
  return { res, body: (await res.json()) as Body };
}

/** `name=value` for the Cookie header, taken from a Set-Cookie response header. */
const cookieFrom = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? null;

const count = async (sql: string, ...binds: unknown[]) =>
  Number(
    (
      await db
        .prepare(sql)
        .bind(...binds)
        .first<{ n: number }>()
    )?.n,
  );

async function guestCookie() {
  const { token } = await createSession(db, clock);
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(async () => {
  clock = NOW;
  t = await createTestDb();
  db = t.db;
  send = makeApp();
  await seedProvider(db);
  await seedOffers(db, [
    { id: 'ai-a', pool: 'ai', rarity: 'A' },
    { id: 'ai-ssr', pool: 'ai', rarity: 'SSR' },
    { id: 'ai-draft', pool: 'ai', rarity: 'SSR', status: 'draft' },
    { id: 'ai-expired', pool: 'ai', rarity: 'SSR', status: 'expired' },
    { id: 'ai-past', pool: 'ai', rarity: 'SSR', validUntil: '2026-11-01' },
    { id: 'cloud-only', pool: 'cloud', rarity: 'S' },
    { id: 'cloud-draft', pool: 'cloud', rarity: 'SSR', status: 'draft' },
    { id: 'software-hidden', pool: 'software', rarity: 'A', status: 'pending_review' },
  ]);
}, 60_000);

afterEach(async () => {
  await t?.dispose();
});

describe('POST /api/draws — first draw', () => {
  it('creates a guest, sets the session cookie and records the draw', async () => {
    const { res, body } = await draw('cloud');
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE}=dds_`);
    expect(cookie).toContain('HttpOnly');

    expect(body.data.offer).toMatchObject({ id: 'cloud-only', pool: 'cloud', rarity: 'S' });
    expect(body.data.offer.provider).toEqual({ id: 'example', name: expect.any(String) });
    expect(body.data.draw).toMatchObject({ pool: 'cloud', rarity: 'S', isNew: true });
    expect(body.data.quota).toEqual({
      max: DAILY_DRAWS,
      used: 1,
      day: '2026-11-12',
      resetsAt: '2026-11-12T16:00:00.000Z',
    });
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM draws')).toBe(1);
  });

  it('reuses the existing session without a new cookie', async () => {
    const cookie = await guestCookie();
    const { res } = await draw('cloud', { cookie });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(1);
  });

  it('starts a new guest when the cookie was revoked', async () => {
    const { token } = await createSession(db, clock);
    await revokeSession(db, token, clock);
    const { res } = await draw('cloud', { cookie: `${SESSION_COOKIE}=${token}` });
    expect(res.status).toBe(201);
    expect(cookieFrom(res)).not.toBe(`${SESSION_COOKIE}=${token}`);
  });

  it('never stores the raw IP address', async () => {
    await draw('cloud');
    const actors = await db.prepare('SELECT actor FROM rate_limits').all<{ actor: string }>();
    expect(actors.results.length).toBeGreaterThan(0);
    for (const { actor } of actors.results) expect(actor).not.toContain(IP);
  });
});

describe('POST /api/draws — what can be drawn', () => {
  it('draws only published, in-date offers', async () => {
    const cookie = await guestCookie();
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99, 0.999]) {
      send = makeApp({ random: () => r });
      clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
      const { body } = await draw('ai', { cookie });
      seen.add(body.data.offer.id);
    }
    expect([...seen].sort()).toEqual(['ai-a', 'ai-ssr']);
  });

  it('picks rarity from the pool odds rescaled over tiers that have cards', async () => {
    // Base odds A 0.7 / S 0.25 / SSR 0.05; the ai pool has no S, so A = 0.7/0.75.
    send = makeApp({ random: () => 0.93 });
    expect((await draw('ai')).body.data.offer.id).toBe('ai-a');
    send = makeApp({ random: () => 0.94 });
    expect((await draw('ai')).body.data.offer.id).toBe('ai-ssr');
  });

  it('refuses an empty pool without charging or creating a user', async () => {
    const { res, body } = await draw('software');
    expect(res.status).toBe(409);
    expect(body.error?.code).toBe('pool_empty');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
  });

  it('marks repeat cards as not new', async () => {
    const cookie = await guestCookie();
    expect((await draw('cloud', { cookie })).body.data.draw.isNew).toBe(true);
    expect((await draw('cloud', { cookie })).body.data.draw.isNew).toBe(false);
  });
});

describe('POST /api/draws — daily quota', () => {
  it(`allows ${DAILY_DRAWS} draws per day, then refuses until Beijing midnight`, async () => {
    const cookie = await guestCookie();
    for (let i = 1; i <= DAILY_DRAWS; i++) {
      const { body } = await draw('cloud', { cookie });
      expect(body.data.quota.used).toBe(i);
    }
    const { res, body } = await draw('cloud', { cookie });
    expect(res.status).toBe(429);
    expect(body.error?.code).toBe('quota_exhausted');
    expect(res.headers.get('retry-after')).toBe(String(13 * 60 * 60));
    expect(await count('SELECT COUNT(*) AS n FROM draws')).toBe(DAILY_DRAWS);

    clock = new Date('2026-11-12T16:00:00Z');
    const next = await draw('cloud', { cookie });
    expect(next.res.status).toBe(201);
    expect(next.body.data.quota).toMatchObject({ used: 1, day: '2026-11-13' });
  });

  it('never exceeds the quota under concurrent requests', async () => {
    const cookie = await guestCookie();
    const results = await Promise.all(
      Array.from({ length: DAILY_DRAWS * 3 }, () => draw('cloud', { cookie })),
    );
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(DAILY_DRAWS);
    expect(statuses.filter((s) => s === 429)).toHaveLength(DAILY_DRAWS * 2);
    expect(await count('SELECT COUNT(*) AS n FROM draws')).toBe(DAILY_DRAWS);
  });

  it('shows used draws in GET /api/me', async () => {
    const cookie = await guestCookie();
    await draw('cloud', { cookie });
    const res = await send(new Request(`${ORIGIN}/api/me`, { headers: { cookie } }));
    expect(((await res.json()) as Body).data.quota).toMatchObject({ used: 1, max: DAILY_DRAWS });
    const anon = await send(new Request(`${ORIGIN}/api/me`));
    expect(((await anon.json()) as Body).data.quota.used).toBe(0);
  });
});

describe('POST /api/draws — idempotency', () => {
  it('replays the original draw without spending another', async () => {
    const cookie = await guestCookie();
    const first = await draw('ai', { cookie, key: 'same-key' });
    const again = await draw('ai', { cookie, key: 'same-key' });
    expect(again.res.status).toBe(200);
    expect(again.res.headers.get('idempotent-replayed')).toBe('true');
    expect(again.body.data.draw).toEqual(first.body.data.draw);
    expect(again.body.data.offer).toEqual(first.body.data.offer);
    expect(again.body.data.quota.used).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM draws')).toBe(1);
  });

  it('replays even after the quota is used up and the offer has expired', async () => {
    const cookie = await guestCookie();
    const first = await draw('cloud', { cookie, key: 'k-1' });
    for (let i = 1; i < DAILY_DRAWS; i++) await draw('cloud', { cookie });
    await db.prepare("UPDATE offers SET status = 'expired' WHERE id = 'cloud-only'").run();
    const again = await draw('cloud', { cookie, key: 'k-1' });
    expect(again.res.status).toBe(200);
    expect(again.body.data.offer.id).toBe(first.body.data.offer.id);
    expect(again.body.data.offer).toMatchObject({ retired: true });
    expect(again.body.data.offer).not.toHaveProperty('officialUrl');
  });

  it('records one draw for concurrent requests with the same key', async () => {
    const cookie = await guestCookie();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => draw('cloud', { cookie, key: 'race' })),
    );
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.data.draw.id)).size).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM draws')).toBe(1);
  });

  it('rejects a reused key for a different pool', async () => {
    const cookie = await guestCookie();
    await draw('cloud', { cookie, key: 'k-pool' });
    const { res, body } = await draw('ai', { cookie, key: 'k-pool' });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('idempotency_key_reused');
  });

  it('scopes keys per user', async () => {
    await draw('cloud', { cookie: await guestCookie(), key: 'shared' });
    const { res } = await draw('cloud', { cookie: await guestCookie(), key: 'shared' });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/draws — request validation', () => {
  it.each([
    ['missing key', { key: null }, 400, 'idempotency_key_required'],
    ['bad key', { key: 'has space' }, 400, 'invalid_idempotency_key'],
    ['unknown pool', { body: { pool: 'games' } }, 400, 'invalid_body'],
    ['extra field', { body: { pool: 'ai', offerId: 'ai-ssr' } }, 400, 'invalid_body'],
    ['not JSON', { rawBody: 'pool=ai', contentType: 'text/plain' }, 415, 'unsupported_media_type'],
    ['broken JSON', { rawBody: '{' }, 400, 'invalid_json'],
    ['cross-origin', { origin: 'https://evil.example' }, 403, 'forbidden_origin'],
  ] as const)('%s', async (_label, opts, status, code) => {
    const { res, body } = await draw('ai', opts as DrawOpts);
    expect(res.status).toBe(status);
    expect(body.error?.code).toBe(code);
    expect(await count('SELECT COUNT(*) AS n FROM draws')).toBe(0);
  });

  it('allows only POST', async () => {
    const res = await send(new Request(`${ORIGIN}/api/draws`));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('fails closed when the IP hash secret is missing', async () => {
    send = makeApp({}, null);
    const { res, body } = await draw('cloud');
    expect(res.status).toBe(503);
    expect(body.error?.code).toBe('unavailable');
  });
});

describe('POST /api/draws — per-IP limits', () => {
  const tight = {
    userLimits: {
      guestsPerIp: { max: 2, windowSeconds: 3600 },
      drawsPerIp: { max: 4, windowSeconds: 3600 },
    },
  };

  it('limits new guests per IP', async () => {
    send = makeApp(tight);
    expect((await draw('cloud')).res.status).toBe(201);
    expect((await draw('cloud')).res.status).toBe(201);
    const { res, body } = await draw('cloud');
    expect(res.status).toBe(429);
    expect(body.error?.code).toBe('rate_limited');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await draw('cloud', { ip: '198.51.100.1' })).res.status).toBe(201);
  });

  it('does not spend the IP budget on replays or exhausted quota', async () => {
    send = makeApp({
      userLimits: {
        guestsPerIp: { max: 5, windowSeconds: 3600 },
        drawsPerIp: { max: DAILY_DRAWS, windowSeconds: 3600 },
      },
    });
    const cookie = await guestCookie();
    for (let i = 0; i < DAILY_DRAWS; i++) await draw('cloud', { cookie, key: `own-${i}` });
    expect((await draw('cloud', { cookie, key: 'own-0' })).res.status).toBe(200);
    expect((await draw('cloud', { cookie })).body.error?.code).toBe('quota_exhausted');
    // The budget was spent by the three real draws only.
    expect((await draw('cloud')).body.error?.code).toBe('rate_limited');
  });

  it('counts IPv6 addresses of one /64 together', async () => {
    send = makeApp(tight);
    expect((await draw('cloud', { ip: '2001:db8:1:2::1' })).res.status).toBe(201);
    expect((await draw('cloud', { ip: '2001:db8:1:2::2' })).res.status).toBe(201);
    expect((await draw('cloud', { ip: '2001:db8:1:2::3' })).res.status).toBe(429);
  });

  it('limits total draws per IP across users', async () => {
    send = makeApp(tight);
    for (let i = 0; i < 2; i++) {
      const cookie = await guestCookie();
      expect((await draw('cloud', { cookie })).res.status).toBe(201);
      expect((await draw('cloud', { cookie })).res.status).toBe(201);
    }
    const { res, body } = await draw('cloud', { cookie: await guestCookie() });
    expect(res.status).toBe(429);
    expect(body.error?.code).toBe('rate_limited');
  });
});
