import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, type Harness } from './helpers/api';
import { seedOffers, seedProvider } from './helpers/seed';

let h: Harness;

const prize = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `限定 ${id}`,
  description: '打开链接输入兑换码',
  valueNote: '价值约 20 元',
  redeemUrl: 'https://example.com/redeem',
  chance: 0.1,
  ...overrides,
});

beforeEach(async () => {
  h = await createHarness();
}, 60_000);

afterEach(async () => {
  await h.t.dispose();
});

describe('prize management', () => {
  it('creates a draft, adds codes by count, activates and lists stock', async () => {
    const created = await h.write('POST', '/api/manage/prizes', { body: prize('prize-one') });
    expect(created.body.error).toBeNull();
    expect(created.res.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'draft', total: 0 });

    const added = await h.write('POST', '/api/manage/prizes/prize-one/codes', {
      body: { codes: ['SECRET-A', 'SECRET-B', 'SECRET-A', ' SECRET-C '] },
    });
    expect(added.body.data).toEqual({ added: 3, total: 3, claimed: 0 });
    const again = await h.write('POST', '/api/manage/prizes/prize-one/codes', {
      body: { codes: ['SECRET-C', 'SECRET-D'] },
    });
    expect(again.body.data).toEqual({ added: 1, total: 4, claimed: 0 });
    const dupes = await h.write('POST', '/api/manage/prizes/prize-one/codes', {
      body: { codes: ['SECRET-D'] },
    });
    expect(dupes.res.status).toBe(422);

    expect(
      (await h.write('POST', '/api/manage/prizes/prize-one/activate', { body: {} })).res.status,
    ).toBe(200);
    const list = await h.read('/api/manage/prizes');
    expect(list.body.data[0]).toMatchObject({
      id: 'prize-one',
      status: 'active',
      total: 4,
      claimed: 0,
    });

    // Codes never reach the audit log or the admin list.
    const audit = await h.db.prepare('SELECT before, after FROM audit_log').all();
    expect(JSON.stringify(audit.results)).not.toContain('SECRET');
    expect(JSON.stringify(list.body)).not.toContain('SECRET');
  });

  it('caps the total chance of active prizes', async () => {
    await h.write('POST', '/api/manage/prizes', { body: prize('prize-one', { chance: 0.15 }) });
    await h.write('POST', '/api/manage/prizes', { body: prize('prize-two', { chance: 0.1 }) });
    await h.write('POST', '/api/manage/prizes/prize-one/activate', { body: {} });
    const over = await h.write('POST', '/api/manage/prizes/prize-two/activate', { body: {} });
    expect(over.res.status).toBe(422);
    expect(over.body.error?.code).toBe('chance_cap_exceeded');

    const lower = await h.write('PATCH', '/api/manage/prizes/prize-two', {
      body: { chance: 0.05 },
    });
    expect(lower.res.status).toBe(200);
    expect(
      (await h.write('POST', '/api/manage/prizes/prize-two/activate', { body: {} })).res.status,
    ).toBe(200);
    const raise = await h.write('PATCH', '/api/manage/prizes/prize-one', { body: { chance: 0.2 } });
    expect(raise.body.error?.code).toBe('chance_cap_exceeded');
  });

  it('validates input and state', async () => {
    expect(
      (await h.write('POST', '/api/manage/prizes', { body: prize('prize-one', { chance: 0.5 }) }))
        .res.status,
    ).toBe(400);
    expect(
      (
        await h.write('POST', '/api/manage/prizes', {
          body: prize('prize-one', { redeemUrl: 'http://example.com' }),
        })
      ).res.status,
    ).toBe(400);
    await h.write('POST', '/api/manage/prizes', { body: prize('prize-one') });
    expect(
      (await h.write('POST', '/api/manage/prizes/prize-one/pause', { body: {} })).res.status,
    ).toBe(409);
    expect(
      (await h.write('POST', '/api/manage/prizes/prize-one/end', { body: {} })).res.status,
    ).toBe(200);
    expect(
      (await h.write('PATCH', '/api/manage/prizes/prize-one', { body: { title: 'x' } })).res.status,
    ).toBe(409);
    expect(
      (await h.write('POST', '/api/manage/prizes/prize-one/codes', { body: { codes: ['X'] } })).res
        .status,
    ).toBe(409);
    expect(
      (await h.write('POST', '/api/manage/prizes/missing/activate', { body: {} })).res.status,
    ).toBe(404);
    expect((await h.read('/api/manage/prizes', h.tokens.inspector)).res.status).toBe(403);
  });

  it('lists winners with masked codes', async () => {
    await h.write('POST', '/api/manage/prizes', { body: prize('prize-one') });
    await h.write('POST', '/api/manage/prizes/prize-one/codes', {
      body: { codes: ['ABCD-1234-WXYZ'] },
    });
    await seedProvider(h.db);
    await seedOffers(h.db, [{ id: 'ai-a', pool: 'ai', title: 'AI 卡' }]);
    const at = '2026-11-11T01:00:00Z';
    await h.db.batch([
      h.db
        .prepare(
          "INSERT INTO users (id, kind, created_at, last_seen_at) VALUES ('u_winner1234', 'guest', ?1, ?1)",
        )
        .bind(at),
      h.db
        .prepare(
          `INSERT INTO draws (id, user_id, offer_id, pool, rarity, day, idem_key, created_at)
           VALUES ('d_1', 'u_winner1234', 'ai-a', 'ai', 'A', '2026-11-11', 'k', ?1)`,
        )
        .bind(at),
      h.db
        .prepare(
          "UPDATE prize_codes SET draw_id = 'd_1', user_id = 'u_winner1234', visitor = 'v', day = '2026-11-11', claimed_at = ?1",
        )
        .bind(at),
    ]);
    const winners = await h.read('/api/manage/prizes/prize-one/winners');
    expect(winners.body.data).toEqual([
      {
        code: '****WXYZ',
        claimedAt: '2026-11-11T01:00:00Z',
        day: '2026-11-11',
        user: 'u_winner12',
      },
    ]);
  });

  it('stores time windows in UTC so the live check compares correctly', async () => {
    const created = await h.write('POST', '/api/manage/prizes', {
      body: prize('prize-tz', {
        startsAt: '2026-11-11T08:00:00+08:00',
        endsAt: '2026-11-12T08:00:00+08:00',
      }),
    });
    expect(created.body.data).toMatchObject({
      startsAt: '2026-11-11T00:00:00.000Z',
      endsAt: '2026-11-12T00:00:00.000Z',
    });
    const row = await h.db
      .prepare('SELECT starts_at, ends_at FROM prizes WHERE id = ?')
      .bind('prize-tz')
      .first<{ starts_at: string; ends_at: string }>();
    expect(row).toEqual({
      starts_at: '2026-11-11T00:00:00.000Z',
      ends_at: '2026-11-12T00:00:00.000Z',
    });
    const patched = await h.write('PATCH', '/api/manage/prizes/prize-tz', {
      body: { endsAt: '2026-11-13T00:00:00+08:00' },
    });
    expect(patched.body.data.endsAt).toBe('2026-11-12T16:00:00.000Z');
    const backwards = await h.write('PATCH', '/api/manage/prizes/prize-tz', {
      body: { endsAt: '2026-11-10T00:00:00Z' },
    });
    expect(backwards.res.status).toBe(422);
  });

  it('refuses unknown actions on the transition route', async () => {
    await h.write('POST', '/api/manage/prizes', { body: prize('prize-one') });
    expect((await h.call('POST', '/api/manage/prizes/prize-one/delete', { body: {} })).status).toBe(
      404,
    );
  });
});
