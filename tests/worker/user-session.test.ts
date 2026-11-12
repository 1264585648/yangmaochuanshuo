import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { createHandler } from '../../worker/src/app';
import {
  SESSION_COOKIE,
  createSession,
  resolveSession,
  revokeSession,
} from '../../worker/src/auth/session';
import { DAILY_DRAWS, SESSION } from '../../worker/src/config';

type D1Database = Env['DB'];

const NOW = new Date('2026-11-12T03:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

let t: TestDb;
let db: D1Database;
let clock = NOW;

const app = createHandler({ now: () => clock });
const env = () =>
  ({ DB: db, ASSETS: { fetch: async () => new Response('asset') } }) as unknown as Env;

const cookieHeader = (token: string) => `theme=dark; ${SESSION_COOKIE}=${token}`;

async function getMe(cookie?: string, method = 'GET') {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  const res = await app.fetch(
    new Request('https://dealdex.test/api/me', { method, headers }),
    env(),
  );
  return res;
}

const countRows = async (table: string) =>
  Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n);

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
}, 60_000);

afterAll(async () => {
  await t?.dispose();
});

describe('createSession', () => {
  it('creates a guest user and stores only the token hash', async () => {
    const { user, token, cookie } = await createSession(db, NOW);
    expect(user).toEqual({
      id: expect.stringMatching(/^u_/),
      kind: 'guest',
      createdAt: NOW.toISOString(),
    });
    expect(token).toMatch(/^dds_[A-Za-z0-9_-]{43}$/);
    const stored = await db
      .prepare('SELECT token_hash FROM sessions WHERE user_id = ?')
      .bind(user.id)
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token_hash).not.toContain(token);

    expect(cookie).toContain(`${SESSION_COOKIE}=${token}`);
    for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'])
      expect(cookie).toContain(attr);
    expect(cookie).toContain(`Max-Age=${SESSION.ttlDays * 86400}`);
  });
});

describe('resolveSession', () => {
  it('finds the user from the cookie among other cookies', async () => {
    const { user, token } = await createSession(db, NOW);
    const req = new Request('https://dealdex.test/', { headers: { cookie: cookieHeader(token) } });
    const resolved = await resolveSession(db, req, NOW);
    expect(resolved?.user).toEqual(user);
    expect(resolved?.renewCookie).toBeNull();
  });

  it.each([
    ['no cookie', undefined],
    ['malformed token', `${SESSION_COOKIE}=not-a-token`],
    ['unknown token', `${SESSION_COOKIE}=dds_${'A'.repeat(43)}`],
  ])('returns null for %s', async (_label, cookie) => {
    const req = new Request('https://dealdex.test/', { headers: cookie ? { cookie } : {} });
    expect(await resolveSession(db, req, NOW)).toBeNull();
  });

  it('rejects an expired session', async () => {
    const { token } = await createSession(db, NOW);
    const req = new Request('https://dealdex.test/', { headers: { cookie: cookieHeader(token) } });
    expect(await resolveSession(db, req, later(SESSION.ttlDays + 1))).toBeNull();
  });

  it('rejects a revoked session', async () => {
    const { token } = await createSession(db, NOW);
    await revokeSession(db, token, NOW);
    const req = new Request('https://dealdex.test/', { headers: { cookie: cookieHeader(token) } });
    expect(await resolveSession(db, req, NOW)).toBeNull();
  });

  it('extends expiry and reissues the cookie once the renew interval has passed', async () => {
    const { token } = await createSession(db, NOW);
    const req = () =>
      new Request('https://dealdex.test/', { headers: { cookie: cookieHeader(token) } });

    const early = await resolveSession(db, req(), later(SESSION.renewAfterDays - 1));
    expect(early?.renewCookie).toBeNull();

    const at = later(SESSION.renewAfterDays + 1);
    const renewed = await resolveSession(db, req(), at);
    expect(renewed?.renewCookie).toContain(`${SESSION_COOKIE}=${token}`);

    // Still valid past the original expiry because it was extended.
    const past = later(SESSION.ttlDays + 1);
    expect(await resolveSession(db, req(), past)).not.toBeNull();
  });

  it('records last_seen_at at most once per day', async () => {
    const { user, token } = await createSession(db, NOW);
    const req = () =>
      new Request('https://dealdex.test/', { headers: { cookie: cookieHeader(token) } });
    const lastSeen = async () =>
      (
        await db
          .prepare('SELECT last_seen_at FROM users WHERE id = ?')
          .bind(user.id)
          .first<{ last_seen_at: string }>()
      )?.last_seen_at;

    await resolveSession(db, req(), new Date(NOW.getTime() + 60_000));
    expect(await lastSeen()).toBe(NOW.toISOString());

    const nextDay = later(1);
    await resolveSession(db, req(), nextDay);
    expect(await lastSeen()).toBe(nextDay.toISOString());
  });
});

describe('GET /api/me', () => {
  it('returns an anonymous view without creating a user', async () => {
    clock = NOW;
    const before = await countRows('users');
    const res = await getMe();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toEqual({
      user: null,
      quota: { max: DAILY_DRAWS, day: '2026-11-12', resetsAt: '2026-11-12T16:00:00.000Z' },
    });
    expect(await countRows('users')).toBe(before);
  });

  it('returns the signed-in guest', async () => {
    clock = NOW;
    const { user, token } = await createSession(db, NOW);
    const res = await getMe(cookieHeader(token));
    const body = (await res.json()) as { data: { user: unknown } };
    expect(body.data.user).toEqual(user);
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('sends the renewed cookie through the security-header wrapper', async () => {
    const { token } = await createSession(db, NOW);
    clock = later(SESSION.renewAfterDays + 1);
    const res = await getMe(cookieHeader(token));
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=${token}`);
    clock = NOW;
  });

  it('treats a stale cookie as anonymous', async () => {
    clock = NOW;
    const res = await getMe(`${SESSION_COOKIE}=dds_${'B'.repeat(43)}`);
    expect(((await res.json()) as { data: { user: unknown } }).data.user).toBeNull();
  });

  it('allows only GET and HEAD for same-origin callers', async () => {
    const headers = new Headers({ origin: 'https://dealdex.test' });
    const res = await app.fetch(
      new Request('https://dealdex.test/api/me', { method: 'POST', headers }),
      env(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('refuses cross-origin writes before method handling', async () => {
    const res = await app.fetch(
      new Request('https://dealdex.test/api/me', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden_origin');
  });

  it('returns 404 for unknown user sub-paths', async () => {
    const res = await app.fetch(new Request('https://dealdex.test/api/me/nothing'), env());
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('does not match neighbouring paths', async () => {
    const res = await app.fetch(new Request('https://dealdex.test/api/meh'), env());
    expect(res.status).toBe(404);
  });
});
