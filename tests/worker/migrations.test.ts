import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t?.dispose();
});

const insertProvider = (id = 'example') =>
  t.db
    .prepare(
      `INSERT INTO providers (id, name, official_domains, created_at, updated_at)
       VALUES (?, 'Example', '["example.com"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')`,
    )
    .bind(id)
    .run();

const insertOffer = (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: 'example-ai-credit',
    provider_id: 'example',
    pool: 'ai',
    rarity: 'S',
    status: 'draft',
    ...overrides,
  };
  return t.db
    .prepare(
      `INSERT INTO offers (id, provider_id, pool, rarity, title, summary, benefit,
         official_url, source_url, regions, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 't', 's', 'b', 'https://example.com', 'https://example.com',
         '[]', ?, 'test', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')`,
    )
    .bind(row.id, row.provider_id, row.pool, row.rarity, row.status)
    .run();
};

describe('schema', () => {
  it('creates every table', async () => {
    const { results } = await t.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' ORDER BY name",
      )
      .all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      'api_clients',
      'audit_log',
      'draws',
      'favorites',
      'feedback',
      'idempotency_keys',
      'offer_changes',
      'offer_clicks',
      'offers',
      'providers',
      'rate_limits',
      'sessions',
      'site_assets',
      'site_settings',
      'users',
      'write_guard',
    ]);
  });

  it('restricts user kind and requires an existing user for sessions', async () => {
    const at = '2026-11-12T00:00:00Z';
    const user = (id: string, kind: string) =>
      t.db
        .prepare('INSERT INTO users (id, kind, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
        .bind(id, kind, at, at)
        .run();
    await expect(user('u_bad', 'admin')).rejects.toThrow();
    await user('u_ok', 'guest');
    const session = (hash: string, userId: string) =>
      t.db
        .prepare(
          'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        )
        .bind(hash, userId, at, at)
        .run();
    await expect(session('h-orphan', 'u_missing')).rejects.toThrow();
    await session('h-ok', 'u_ok');
  });

  it('enforces the provider foreign key', async () => {
    await expect(insertOffer({ id: 'orphan', provider_id: 'missing' })).rejects.toThrow();
  });

  it('accepts a valid offer with defaults', async () => {
    await insertProvider();
    await insertOffer();
    const row = await t.db
      .prepare('SELECT version, last_verified_at, new_users_only FROM offers WHERE id = ?')
      .bind('example-ai-credit')
      .first();
    expect(row).toEqual({ version: 1, last_verified_at: null, new_users_only: 0 });
  });

  it.each([
    { id: 'bad-pool', pool: 'games' },
    { id: 'bad-rarity', rarity: 'UR' },
    { id: 'bad-status', status: 'live' },
  ])('rejects out-of-range enum %j', async (overrides) => {
    await expect(insertOffer(overrides)).rejects.toThrow();
  });

  it('stores guides as JSON only', async () => {
    await insertOffer({ id: 'guided' });
    const setGuide = (value: string | null) =>
      t.db.prepare('UPDATE offers SET guide = ? WHERE id = ?').bind(value, 'guided').run();
    await expect(setGuide('{"kind":"brief","steps":[]}')).resolves.toBeTruthy();
    await expect(setGuide(null)).resolves.toBeTruthy();
    await expect(setGuide('{not json')).rejects.toThrow();
  });

  it('keeps the audit log append-only', async () => {
    await t.db
      .prepare(
        `INSERT INTO audit_log (actor, action, entity_type, entity_id, created_at)
         VALUES ('admin', 'create', 'offer', 'x', '2026-11-11T00:00:00Z')`,
      )
      .run();
    await expect(t.db.prepare("UPDATE audit_log SET actor = 'x'").run()).rejects.toThrow();
    await expect(t.db.prepare('DELETE FROM audit_log').run()).rejects.toThrow();
  });
});
