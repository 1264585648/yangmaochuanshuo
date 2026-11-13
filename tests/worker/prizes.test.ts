import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createUserApi, cookieFrom, type UserApi } from './helpers/user-api';
import { seedOffers, seedProvider } from './helpers/seed';
import { rollPrize, maskCode } from '../../worker/src/prizes/prizes';
import { PRIZE_LIMITS } from '../../worker/src/config';

const NOW = new Date('2026-11-13T03:00:00Z');
const NEXT_DAY = new Date('2026-11-14T03:00:00Z');

let api: UserApi;
/** Every random draw returns this; 0 always wins a live prize, 0.99 never does. */
let roll = 0;

async function insertPrize(
  id: string,
  {
    chance = 0.1,
    status = 'active',
    codes = ['CODE-1'] as string[],
    endsAt = null as string | null,
  } = {},
) {
  const at = NOW.toISOString();
  await api.db
    .prepare(
      `INSERT INTO prizes (id, title, description, value_note, redeem_url, chance, status,
                           starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, '打开链接输入兑换码', '价值约 20 元', 'https://example.com/redeem', ?, ?, NULL, ?, ?, ?)`,
    )
    .bind(id, `限定 ${id}`, chance, status, endsAt, at, at)
    .run();
  for (const code of codes) {
    await api.db
      .prepare('INSERT INTO prize_codes (prize_id, code) VALUES (?, ?)')
      .bind(id, code)
      .run();
  }
}

const claimed = () => api.count('SELECT COUNT(*) AS n FROM prize_codes WHERE draw_id IS NOT NULL');

beforeEach(async () => {
  roll = 0;
  api = await createUserApi(NOW, { random: () => roll });
  await seedProvider(api.db);
  await seedOffers(api.db, [{ id: 'ai-a', pool: 'ai', title: 'AI 卡' }]);
}, 60_000);

afterEach(async () => {
  await api.t.dispose();
});

describe('rollPrize', () => {
  const prizes = [
    { id: 'a', chance: 0.05 },
    { id: 'b', chance: 0.1 },
  ];
  it('walks cumulative chances and leaves the rest as no prize', () => {
    expect(rollPrize(prizes, () => 0.04)).toBe('a');
    expect(rollPrize(prizes, () => 0.05)).toBe('b');
    expect(rollPrize(prizes, () => 0.149)).toBe('b');
    expect(rollPrize(prizes, () => 0.151)).toBeNull();
    expect(rollPrize([], () => 0)).toBeNull();
  });

  it('masks codes for the admin winner list', () => {
    expect(maskCode('ABCD-1234-WXYZ')).toBe('****WXYZ');
    expect(maskCode('AB')).toBe('**');
    expect(maskCode('ABCDE')).toBe('****E');
  });
});

describe('prize draws', () => {
  it('returns no prize when none is live', async () => {
    const { res, body } = await api.draw('ai');
    expect(res.status).toBe(201);
    expect(body.data.prize).toBeNull();
  });

  it('gives the winner a code, replays it, and shows it under /api/me/prizes only', async () => {
    await insertPrize('p1');
    const first = await api.draw('ai', { key: 'win-1' });
    expect(first.res.status).toBe(201);
    expect(first.body.data.prize).toMatchObject({
      id: 'p1',
      title: '限定 p1',
      code: 'CODE-1',
      redeemUrl: 'https://example.com/redeem',
    });
    expect(first.body.data.draw.prize).toBeUndefined();
    const cookie = cookieFrom(first.res);

    const replay = await api.draw('ai', { key: 'win-1', cookie });
    expect(replay.res.status).toBe(200);
    expect(replay.body.data.prize.code).toBe('CODE-1');
    expect(await claimed()).toBe(1);

    const mine = await api.call('GET', '/api/me/prizes', { cookie });
    expect(mine.res.headers.get('cache-control')).toBe('no-store');
    expect(mine.body.data.prizes).toHaveLength(1);
    expect(mine.body.data.prizes[0].code).toBe('CODE-1');

    const other = await api.call('GET', '/api/me/prizes', { cookie: await api.guestCookie() });
    expect(other.body.data.prizes).toEqual([]);
    const anonymous = await api.call('GET', '/api/me/prizes');
    expect(anonymous.body.data.prizes).toEqual([]);
  });

  it('does not claim when the roll misses', async () => {
    await insertPrize('p1');
    roll = 0.99;
    const { body } = await api.draw('ai');
    expect(body.data.prize).toBeNull();
    expect(await claimed()).toBe(0);
  });

  it('caps wins at one per user, ever', async () => {
    await insertPrize('p1', { codes: ['A1', 'A2', 'A3'] });
    const first = await api.draw('ai');
    const cookie = cookieFrom(first.res);
    expect(first.body.data.prize).not.toBeNull();
    api.setNow(NEXT_DAY);
    const again = await api.draw('ai', { cookie, ip: '198.51.100.9' });
    expect(again.res.status).toBe(201);
    expect(again.body.data.prize).toBeNull();
    expect(await claimed()).toBe(1);
  });

  it('caps wins at one per network per day', async () => {
    await insertPrize('p1', { codes: ['A1', 'A2', 'A3'] });
    expect((await api.draw('ai')).body.data.prize).not.toBeNull();
    const sameNetwork = await api.draw('ai', { cookie: await api.guestCookie() });
    expect(sameNetwork.body.data.prize).toBeNull();
    const otherNetwork = await api.draw('ai', {
      cookie: await api.guestCookie(),
      ip: '198.51.100.9',
    });
    expect(otherNetwork.body.data.prize).not.toBeNull();
    api.setNow(NEXT_DAY);
    const tomorrow = await api.draw('ai', { cookie: await api.guestCookie() });
    expect(tomorrow.body.data.prize).not.toBeNull();
    expect(await claimed()).toBe(3);
  });

  it('buckets IPv6 winners by /48, so rotating /64s does not help', async () => {
    await insertPrize('p1', { codes: ['A1', 'A2', 'A3'] });
    const first = await api.draw('ai', { ip: '2001:db8:1:1::1' });
    expect(first.body.data.prize).not.toBeNull();
    const sameSlash48 = await api.draw('ai', { ip: '2001:db8:1:2::1' });
    expect(sameSlash48.res.status).toBe(201);
    expect(sameSlash48.body.data.prize).toBeNull();
    const otherSlash48 = await api.draw('ai', { ip: '2001:db8:2:1::1' });
    expect(otherSlash48.body.data.prize).not.toBeNull();
  });

  it('stops all wins once the daily total cap is reached', async () => {
    await insertPrize('p1', { codes: ['A1'] });
    const filler = Array.from({ length: PRIZE_LIMITS.maxWinsPerDay }, (_, i) =>
      api.db
        .prepare(
          "INSERT INTO prize_codes (prize_id, code, visitor, day) VALUES ('p1', ?, ?, '2026-11-13')",
        )
        .bind(`F${i}`, `v${i}`),
    );
    await api.db.batch(filler);
    await api.db.prepare("UPDATE prizes SET status = 'active'").run();
    const capped = await api.draw('ai');
    expect(capped.body.data.prize).toBeNull();
  });

  it('stops at the stock and still records the draw', async () => {
    await insertPrize('p1', { codes: ['ONLY'] });
    expect((await api.draw('ai')).body.data.prize?.code).toBe('ONLY');
    const late = await api.draw('ai', { ip: '198.51.100.9' });
    expect(late.res.status).toBe(201);
    expect(late.body.data.prize).toBeNull();
    const rules = await api.call('GET', '/api/prizes');
    expect(rules.body.data[0]).toMatchObject({ id: 'p1', total: 1, remaining: 0 });
  });

  it('ignores paused and expired prizes', async () => {
    await insertPrize('paused', { status: 'paused' });
    await insertPrize('over', { endsAt: '2026-11-13T02:00:00Z' });
    const { body } = await api.draw('ai');
    expect(body.data.prize).toBeNull();
    expect((await api.call('GET', '/api/prizes')).body.data).toEqual([]);
  });

  it('treats starts_at as inclusive and ends_at as exclusive', async () => {
    await insertPrize('ends-now', { endsAt: NOW.toISOString() });
    expect((await api.draw('ai')).body.data.prize).toBeNull();
    await api.db
      .prepare('UPDATE prizes SET starts_at = ?, ends_at = NULL WHERE id = ?')
      .bind(NOW.toISOString(), 'ends-now')
      .run();
    const live = await api.draw('ai', { ip: '198.51.100.9' });
    expect(live.body.data.prize?.id).toBe('ends-now');
  });

  it('claims nothing when the quota is spent', async () => {
    await insertPrize('p1', { codes: ['A1'] });
    roll = 0.99;
    const first = await api.draw('ai');
    const cookie = cookieFrom(first.res);
    await api.draw('ai', { cookie });
    await api.draw('ai', { cookie });
    roll = 0;
    const spent = await api.draw('ai', { cookie });
    expect(spent.res.status).toBe(429);
    expect(await claimed()).toBe(0);
  });

  it('publishes odds and stock without codes', async () => {
    await insertPrize('p1', { codes: ['SECRET-CODE-1', 'SECRET-CODE-2'] });
    const { res, body } = await api.call('GET', '/api/prizes');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'p1', chance: 0.1, total: 2, remaining: 2 }),
    ]);
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('redeem');
  });

  it('keeps codes out of the draw history', async () => {
    await insertPrize('p1', { codes: ['SECRET-CODE'] });
    const first = await api.draw('ai');
    const history = await api.call('GET', '/api/me/draws', { cookie: cookieFrom(first.res) });
    expect(history.res.status).toBe(200);
    expect(JSON.stringify(history.body)).not.toContain('SECRET');
  });
});
