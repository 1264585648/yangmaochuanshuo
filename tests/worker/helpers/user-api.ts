/* Harness for the cookie-authenticated user API against a real local D1. */
import { createTestDb, type TestDb } from './db';
import { createHandler, type AppOptions } from '../../../worker/src/app';
import { SESSION_COOKIE, createSession } from '../../../worker/src/auth/session';

type D1Database = Env['DB'];

export const ORIGIN = 'https://dealdex.test';
export const IP = '203.0.113.7';
export const TEST_IP_SECRET = 'test-ip-secret-at-least-32-characters';

export interface Body {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions on dynamic JSON
  data: any;
  error: { code: string; details?: unknown } | null;
}

export interface CallOpts {
  cookie?: string | null;
  body?: unknown;
  key?: string | null;
  ip?: string;
  origin?: string | null;
}

export interface UserApi {
  t: TestDb;
  db: D1Database;
  setNow: (date: Date) => void;
  now: () => Date;
  call: (method: string, path: string, opts?: CallOpts) => Promise<{ res: Response; body: Body }>;
  draw: (pool: string, opts?: CallOpts) => Promise<{ res: Response; body: Body }>;
  guestCookie: () => Promise<string>;
  count: (sql: string, ...binds: unknown[]) => Promise<number>;
}

let keySeq = 0;

export async function createUserApi(start: Date, options: AppOptions = {}): Promise<UserApi> {
  const t = await createTestDb();
  let clock = start;
  const app = createHandler({ now: () => clock, ...options });
  const env = {
    DB: t.db,
    ASSETS: { fetch: async () => new Response('asset') },
    IP_HASH_SECRET: TEST_IP_SECRET,
  } as unknown as Env;

  const call: UserApi['call'] = async (method, path, opts = {}) => {
    const headers = new Headers({ 'cf-connecting-ip': opts.ip ?? IP });
    if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
    if (opts.cookie) headers.set('cookie', opts.cookie);
    if (opts.key) headers.set('idempotency-key', opts.key);
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(opts.body);
    }
    const res = await app.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body }), env);
    const text = await res.text();
    return { res, body: (text ? JSON.parse(text) : null) as Body };
  };

  return {
    t,
    db: t.db,
    setNow: (date) => {
      clock = date;
    },
    now: () => clock,
    call,
    draw: (pool, opts = {}) =>
      call('POST', '/api/draws', { key: `k-${++keySeq}`, ...opts, body: { pool } }),
    guestCookie: async () => `${SESSION_COOKIE}=${(await createSession(t.db, clock)).token}`,
    count: async (sql, ...binds) =>
      Number(
        (
          await t.db
            .prepare(sql)
            .bind(...binds)
            .first<{ n: number }>()
        )?.n,
      ),
  };
}

/** `name=value` for the Cookie header, taken from a Set-Cookie response header. */
export const cookieFrom = (res: Response): string | null =>
  res.headers.get('set-cookie')?.split(';')[0] ?? null;
