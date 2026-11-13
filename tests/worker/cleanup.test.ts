import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { seedOffers, seedProvider } from './helpers/seed';
import { createHandler } from '../../worker/src/app';
import { CLEANUP, USER_LIMITS, INSPECTOR_EXPIRE_LIMIT } from '../../worker/src/config';
import { runCleanup } from '../../worker/src/maintenance/cleanup';
import { DEFAULT_RATE_LIMIT } from '../../worker/src/write/rate-limit';

type D1Database = Env['DB'];

const NOW = new Date('2026-11-20T19:30:00Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const nowSeconds = Math.floor(NOW.getTime() / 1000);

let t: TestDb;
let db: D1Database;

const ids = async (sql: string) =>
  (await db.prepare(sql).all<{ id: string }>()).results.map((r) => r.id).sort();

async function addUser(
  id: string,
  createdAt: string,
  extra: { importedAt?: string; kind?: string } = {},
) {
  await db
    .prepare(
      'INSERT INTO users (id, kind, created_at, last_seen_at, imported_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, extra.kind ?? 'guest', createdAt, createdAt, extra.importedAt ?? null)
    .run();
}

async function addSession(
  hash: string,
  userId: string,
  expiresAt: string,
  revokedAt: string | null = null,
) {
  await db
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(hash, userId, ago(30 * DAY_MS), expiresAt, revokedAt)
    .run();
}

async function addDraw(id: string, userId: string) {
  await db
    .prepare(
      `INSERT INTO draws (id, user_id, offer_id, pool, rarity, day, idem_key, created_at)
       VALUES (?, ?, 'clean-offer', 'ai', 'A', '2026-11-10', ?, ?)`,
    )
    .bind(id, userId, `key-${id}`, ago(10 * DAY_MS))
    .run();
}

async function reset() {
  for (const table of [
    'favorites',
    'draws',
    'sessions',
    'users',
    'rate_limits',
    'idempotency_keys',
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
  await seedProvider(db);
  await seedOffers(db, [{ id: 'clean-offer', pool: 'ai', rarity: 'A' }]);
}, 60_000);

afterAll(async () => {
  await t?.dispose();
});

beforeEach(reset);

describe('runCleanup', () => {
  it('keeps every rate-limit window it could still need', () => {
    const windows = [DEFAULT_RATE_LIMIT, INSPECTOR_EXPIRE_LIMIT, ...Object.values(USER_LIMITS)].map(
      (l) => l.windowSeconds,
    );
    expect(Math.max(...windows)).toBeLessThan(CLEANUP.rateLimitRetentionSeconds);
  });

  it('drops rate-limit windows older than the retention period only', async () => {
    const old = nowSeconds - CLEANUP.rateLimitRetentionSeconds - 60;
    const recent = nowSeconds - 60;
    const insert = 'INSERT INTO rate_limits (actor, window_start, count) VALUES (?, ?, 1)';
    await db.batch([
      db.prepare(insert).bind('old', old),
      db.prepare(insert).bind('recent', recent),
    ]);
    const report = await runCleanup(db, NOW);
    expect(report.rateLimits).toBe(1);
    const left = await db.prepare('SELECT actor AS id FROM rate_limits').all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual(['recent']);
  });

  it('drops idempotency keys past their replay window', async () => {
    const insert = `INSERT INTO idempotency_keys (actor, key, request_hash, response_status, response_body, created_at)
                    VALUES ('c', ?, 'h', 200, '{}', ?)`;
    await db.batch([
      db.prepare(insert).bind('stale', ago(25 * HOUR_MS)),
      db.prepare(insert).bind('fresh', ago(HOUR_MS)),
    ]);
    const report = await runCleanup(db, NOW);
    expect(report.idempotencyKeys).toBe(1);
    expect(await ids('SELECT key AS id FROM idempotency_keys')).toEqual(['fresh']);
  });

  it('drops expired and revoked sessions but keeps their users with draws', async () => {
    await addUser('u-active', ago(60 * DAY_MS));
    await addDraw('d1', 'u-active');
    await addSession('live', 'u-active', ahead(DAY_MS));
    await addSession('expired', 'u-active', ago(HOUR_MS));
    await addSession('revoked', 'u-active', ahead(DAY_MS), ago(HOUR_MS));
    const report = await runCleanup(db, NOW);
    expect(report.sessions).toBe(2);
    expect(await ids('SELECT token_hash AS id FROM sessions')).toEqual(['live']);
    expect(await ids('SELECT id FROM users')).toEqual(['u-active']);
  });

  it('removes old guests that never drew, along with their sessions', async () => {
    const old = ago(CLEANUP.emptyGuestGraceDays * DAY_MS + HOUR_MS);
    await addUser('u-empty', old);
    await addSession('empty-live', 'u-empty', ahead(100 * DAY_MS));
    await addUser('u-new-empty', ago(HOUR_MS));
    await addUser('u-drew', old);
    await addDraw('d2', 'u-drew');
    await addUser('u-imported', old, { importedAt: old });
    await addUser('u-member', old, { kind: 'member' });

    const report = await runCleanup(db, NOW);
    expect(report.emptyGuests).toBe(1);
    expect(await ids('SELECT id FROM users')).toEqual([
      'u-drew',
      'u-imported',
      'u-member',
      'u-new-empty',
    ]);
    expect(await ids('SELECT token_hash AS id FROM sessions')).toEqual([]);
  });

  it('bounds each pass and finishes the rest on the next run', async () => {
    const old = nowSeconds - CLEANUP.rateLimitRetentionSeconds - 60;
    const insert = 'INSERT INTO rate_limits (actor, window_start, count) VALUES (?, ?, 1)';
    await db.batch(Array.from({ length: 5 }, (_, i) => db.prepare(insert).bind(`a${i}`, old)));
    expect((await runCleanup(db, NOW, { batchSize: 3 })).rateLimits).toBe(3);
    expect((await runCleanup(db, NOW, { batchSize: 3 })).rateLimits).toBe(2);
    expect((await runCleanup(db, NOW, { batchSize: 3 })).rateLimits).toBe(0);
  });

  it('is a no-op on an empty database', async () => {
    expect(await runCleanup(db, NOW)).toEqual({
      rateLimits: 0,
      idempotencyKeys: 0,
      sessions: 0,
      emptyGuests: 0,
    });
  });
});

describe('scheduled handler', () => {
  it('runs the cleanup with the injected clock and logs a summary', async () => {
    await addUser('u-sched', ago(30 * DAY_MS));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const waits: Promise<unknown>[] = [];
    const app = createHandler({ now: () => NOW });
    await app.scheduled(
      { cron: '30 19 * * *', scheduledTime: NOW.getTime(), noRetry() {} } as ScheduledController,
      { DB: db } as unknown as Env,
      {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException() {},
      } as unknown as ExecutionContext,
    );
    await Promise.all(waits);
    expect(await ids('SELECT id FROM users')).toEqual([]);
    expect(info).toHaveBeenCalledWith('cleanup_done', expect.objectContaining({ emptyGuests: 1 }));
    info.mockRestore();
  });

  it('logs and rethrows when the cleanup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createHandler({ now: () => NOW });
    const broken = {
      batch: () => Promise.reject(new Error('db down')),
      prepare: () => ({ bind: () => ({}) }),
    };
    await expect(
      app.scheduled(
        { cron: '30 19 * * *', scheduledTime: NOW.getTime(), noRetry() {} } as ScheduledController,
        { DB: broken } as unknown as Env,
        { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
      ),
    ).rejects.toThrow('db down');
    expect(error).toHaveBeenCalledWith('cleanup_failed', expect.any(Object));
    error.mockRestore();
  });
});
