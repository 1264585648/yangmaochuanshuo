import { expect } from 'vitest';
import { createHandler, type AppOptions } from '../../../worker/src/app';
import { hashToken } from '../../../worker/src/auth/tokens';
import { createTestDb, type TestDb } from './db';

type D1Database = Env['DB'];

export const NOW = new Date('2026-11-11T12:00:00Z');

export interface Envelope {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions on dynamic JSON
  data: any;
  error: { code: string; message: string; details?: unknown } | null;
  meta?: { total: number; limit: number; offset: number };
}

export interface CallOptions {
  token?: string | null;
  body?: unknown;
  rawBody?: string;
  key?: string | null;
  contentType?: string;
}

export interface Harness {
  t: TestDb;
  db: D1Database;
  tokens: { admin: string; inspector: string; admin2: string };
  call: (method: string, path: string, opts?: CallOptions) => Promise<Response>;
  /** Like call, plus: 2xx adds exactly one audit row, anything else adds none. */
  write: (
    method: string,
    path: string,
    opts?: CallOptions,
  ) => Promise<{ res: Response; body: Envelope }>;
  read: (path: string, token?: string | null) => Promise<{ res: Response; body: Envelope }>;
  auditCount: () => Promise<number>;
}

let keySeq = 0;

export async function insertClient(
  db: D1Database,
  id: string,
  scope: 'admin' | 'inspector',
  revoked = false,
): Promise<string> {
  const token = `ddx_test_${id}_${'x'.repeat(32)}`;
  await db
    .prepare(
      'INSERT INTO api_clients (id, name, token_hash, scope, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      id,
      await hashToken(token),
      scope,
      NOW.toISOString(),
      revoked ? NOW.toISOString() : null,
    )
    .run();
  return token;
}

export async function createHarness(options: AppOptions = {}): Promise<Harness> {
  const t = await createTestDb();
  const tokens = {
    admin: await insertClient(t.db, 'admin-1', 'admin'),
    admin2: await insertClient(t.db, 'admin-2', 'admin'),
    inspector: await insertClient(t.db, 'inspector-1', 'inspector'),
  };
  const app = createHandler({ now: () => NOW, ...options });
  const env = { DB: t.db, ASSETS: { fetch: async () => new Response('asset') } } as unknown as Env;

  const call = (method: string, path: string, opts: CallOptions = {}) => {
    const headers = new Headers();
    const token = opts.token === undefined ? tokens.admin : opts.token;
    if (token) headers.set('authorization', `Bearer ${token}`);
    const hasBody = opts.body !== undefined || opts.rawBody !== undefined;
    if (hasBody) headers.set('content-type', opts.contentType ?? 'application/json');
    const key = opts.key === undefined ? `test-key-${++keySeq}` : opts.key;
    if (key && method !== 'GET') headers.set('idempotency-key', key);
    const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    return app.fetch(new Request(`https://dealdex.test${path}`, { method, headers, body }), env);
  };

  const auditCount = async () =>
    Number((await t.db.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())?.n);

  const write: Harness['write'] = async (method, path, opts) => {
    const before = await auditCount();
    const res = await call(method, path, opts);
    const body = (await res.json()) as Envelope;
    const replayed = res.headers.get('idempotent-replayed') === 'true';
    const expected = res.ok && !replayed ? before + 1 : before;
    expect(await auditCount(), `audit rows after ${method} ${path} -> ${res.status}`).toBe(
      expected,
    );
    return { res, body };
  };

  const read: Harness['read'] = async (path, token) => {
    const res = await call('GET', path, { token });
    return { res, body: (await res.json()) as Envelope };
  };

  return { t, db: t.db, tokens, call, write, read, auditCount };
}

export function offerInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    providerId: 'example',
    pool: 'ai',
    rarity: 'S',
    title: `Offer ${id}`,
    summary: 'Fictional offer for tests',
    benefit: 'Test credit',
    officialUrl: 'https://www.example.com/promo',
    sourceUrl: 'https://docs.example.com/terms',
    conditions: { newUsersOnly: true },
    ...overrides,
  };
}

export const PROVIDER = { id: 'example', name: 'Example', officialDomains: ['example.com'] };
