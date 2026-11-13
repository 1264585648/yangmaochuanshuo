import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedOffers, seedProvider } from './helpers/seed';
import { createUserApi, ORIGIN, type UserApi } from './helpers/user-api';
import { POPULARITY_MIN_VISITORS, FEEDBACK_LIMIT } from '../../worker/src/config';

const NOW = new Date('2026-11-12T03:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let api: UserApi;

beforeEach(async () => {
  api = await createUserApi(NOW);
  await seedProvider(api.db);
  await seedOffers(api.db, [
    { id: 'ai-a', pool: 'ai', rarity: 'A' },
    { id: 'ai-draft', pool: 'ai', rarity: 'S', status: 'draft' },
    { id: 'ai-expired', pool: 'ai', rarity: 'A', status: 'expired' },
  ]);
}, 60_000);

afterEach(async () => {
  await api.t.dispose();
});

const click = (id: string, opts: { ip?: string; origin?: string | null } = {}) =>
  api.call('POST', `/api/offers/${id}/click`, opts);

const rows = () => api.count('SELECT COUNT(*) AS n FROM offer_clicks');

describe('POST /api/offers/:id/click', () => {
  it('records one row per visitor per day and never creates a user', async () => {
    const first = await click('ai-a');
    expect(first.res.status).toBe(200);
    expect(first.body.data).toEqual({ recorded: true });
    const again = await click('ai-a');
    expect(again.body.data).toEqual({ recorded: false });
    await click('ai-a', { ip: '198.51.100.9' });

    expect(await rows()).toBe(2);
    expect(await api.count('SELECT COUNT(*) AS n FROM users')).toBe(0);
    expect(first.res.headers.get('set-cookie')).toBeNull();
    const stored = await api.db.prepare('SELECT visitor FROM offer_clicks').all();
    for (const r of stored.results as { visitor: string }[]) {
      expect(r.visitor).toMatch(/^[0-9a-f]{32}$/);
      expect(r.visitor).not.toContain('203.0.113');
    }
  });

  it('counts the same visitor again on a new Beijing day', async () => {
    await click('ai-a');
    api.setNow(new Date(NOW.getTime() + DAY_MS));
    await click('ai-a');
    expect(await rows()).toBe(2);
  });

  it('ignores offers that are not public', async () => {
    for (const id of ['ai-draft', 'ai-expired', 'missing']) {
      const { res, body } = await click(id);
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ recorded: false });
    }
    expect(await rows()).toBe(0);
  });

  it('refuses cross-origin requests and other methods', async () => {
    expect((await click('ai-a', { origin: 'https://evil.example' })).res.status).toBe(403);
    expect((await api.call('GET', '/api/offers/ai-a/click')).res.status).toBe(405);
    expect(await rows()).toBe(0);
  });

  it('fails closed without the IP hash secret', async () => {
    const { createHandler } = await import('../../worker/src/app');
    const app = createHandler({ now: api.now });
    const env = { DB: api.db, ASSETS: { fetch: async () => new Response('') } } as unknown as Env;
    const res = await app.fetch(
      new Request(`${ORIGIN}/api/offers/ai-a/click`, {
        method: 'POST',
        headers: { origin: ORIGIN },
      }),
      env,
    );
    expect(res.status).toBe(503);
    expect(await rows()).toBe(0);
  });

  it('rejects malformed ids', async () => {
    expect((await click('Bad%20Id')).res.status).toBe(404);
  });
});

describe('popularity on public offers', () => {
  const insertVisitors = async (offerId: string, n: number) => {
    const stmt = api.db.prepare(
      "INSERT OR IGNORE INTO offer_clicks (offer_id, day, visitor) VALUES (?, '2026-11-12', ?)",
    );
    await api.db.batch(Array.from({ length: n }, (_, i) => stmt.bind(offerId, `v${i}`)));
  };

  it('carries the same count into draw results and the collection', async () => {
    await insertVisitors('ai-a', POPULARITY_MIN_VISITORS);
    const cookie = await api.guestCookie();
    const drawn = await api.draw('ai', { cookie });
    expect(drawn.body.data.offer).toMatchObject({
      id: 'ai-a',
      officialVisitors: POPULARITY_MIN_VISITORS,
    });
    const { body } = await api.call('GET', '/api/me/collection', { cookie });
    expect(body.data.cards[0].offer.officialVisitors).toBe(POPULARITY_MIN_VISITORS);
  });

  it('hides counts below the threshold and shows real counts at or above it', async () => {
    await insertVisitors('ai-a', POPULARITY_MIN_VISITORS - 1);
    let { body } = await api.call('GET', '/api/offers/ai-a');
    expect(body.data.officialVisitors).toBeNull();

    await insertVisitors('ai-a', POPULARITY_MIN_VISITORS + 5);
    ({ body } = await api.call('GET', '/api/offers/ai-a'));
    // v0..v14 overlap the first batch: 15 distinct visitors in total.
    expect(body.data.officialVisitors).toBe(POPULARITY_MIN_VISITORS + 5);
    const list = await api.call('GET', '/api/offers');
    expect(list.body.data[0]).toMatchObject({ id: 'ai-a', officialVisitors: 15 });
  });

  it('counts a visitor once across days', async () => {
    const stmt = api.db.prepare(
      "INSERT INTO offer_clicks (offer_id, day, visitor) VALUES ('ai-a', ?, ?)",
    );
    const binds = Array.from({ length: POPULARITY_MIN_VISITORS }, (_, i) => [
      stmt.bind('2026-11-11', `v${i}`),
      stmt.bind('2026-11-12', `v${i}`),
    ]).flat();
    await api.db.batch(binds);
    const { body } = await api.call('GET', '/api/offers/ai-a');
    expect(body.data.officialVisitors).toBe(POPULARITY_MIN_VISITORS);
  });
});

describe('POST /api/feedback', () => {
  const report = { kind: 'offer', offerId: 'ai-a', category: 'expired', message: '  活动结束了 ' };

  it('stores an offer report with trimmed text and no user', async () => {
    const { res, body } = await api.call('POST', '/api/feedback', { body: report });
    expect(res.status).toBe(201);
    expect(body.data.id).toBeGreaterThan(0);
    const row = await api.db.prepare('SELECT * FROM feedback').first<Record<string, unknown>>();
    expect(row).toMatchObject({
      kind: 'offer',
      offer_id: 'ai-a',
      category: 'expired',
      message: '活动结束了',
      contact: '',
      status: 'open',
    });
    expect(await api.count('SELECT COUNT(*) AS n FROM users')).toBe(0);
  });

  it('accepts reports on withdrawn offers but not unknown ones', async () => {
    const expired = await api.call('POST', '/api/feedback', {
      body: { ...report, offerId: 'ai-expired' },
    });
    expect(expired.res.status).toBe(201);
    const unknown = await api.call('POST', '/api/feedback', {
      body: { ...report, offerId: 'nope' },
    });
    expect(unknown.res.status).toBe(422);
    expect(unknown.body.error?.code).toBe('unknown_offer');
  });

  it('requires a message for general feedback', async () => {
    const empty = await api.call('POST', '/api/feedback', {
      body: { kind: 'general', category: 'suggestion', message: ' ' },
    });
    expect(empty.res.status).toBe(400);
    const okRes = await api.call('POST', '/api/feedback', {
      body: {
        kind: 'general',
        category: 'want_offer',
        message: '想要更多学生福利',
        contact: 'wx: abc',
      },
    });
    expect(okRes.res.status).toBe(201);
  });

  it('rejects unknown fields, bad categories and oversized text', async () => {
    const cases = [
      { ...report, extra: 1 },
      { ...report, category: 'spam' },
      { kind: 'general', category: 'bug', message: 'x'.repeat(1001) },
      { kind: 'general', category: 'bug', message: 'ok', offerId: 'ai-a' },
    ];
    for (const body of cases) {
      expect((await api.call('POST', '/api/feedback', { body })).res.status).toBe(400);
    }
    expect(await api.count('SELECT COUNT(*) AS n FROM feedback')).toBe(0);
  });

  it('is limited per network', async () => {
    for (let i = 0; i < FEEDBACK_LIMIT.max; i++) {
      expect((await api.call('POST', '/api/feedback', { body: report })).res.status).toBe(201);
    }
    const limited = await api.call('POST', '/api/feedback', { body: report });
    expect(limited.res.status).toBe(429);
    const other = await api.call('POST', '/api/feedback', { body: report, ip: '198.51.100.9' });
    expect(other.res.status).toBe(201);
  });

  it('refuses cross-origin submissions', async () => {
    const { res } = await api.call('POST', '/api/feedback', {
      body: report,
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/community', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const save = async (value: Record<string, unknown>, image = true) => {
    await api.db
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('community', ?, '2026-11-12T00:00:00Z')",
      )
      .bind(JSON.stringify(value))
      .run();
    if (image) {
      await api.db
        .prepare(
          "INSERT INTO site_assets (key, content_type, data, sha256, updated_at) VALUES ('community-qr', 'image/png', ?, 'abcdef0123456789', '2026-11-12T00:00:00Z')",
        )
        .bind(btoa(String.fromCharCode(...PNG)))
        .run();
    }
  };
  const settings = {
    enabled: true,
    title: '内测交流群',
    description: '扫码加入',
    link: null,
    linkLabel: '',
    qrExpiresAt: '2026-11-18T00:00:00Z',
  };

  it('is null until configured', async () => {
    const { body } = await api.call('GET', '/api/community');
    expect(body.data).toBeNull();
    expect((await api.call('GET', '/api/community/qr')).res.status).toBe(404);
  });

  it('serves the QR image same-origin while it is current', async () => {
    await save(settings);
    const { body } = await api.call('GET', '/api/community');
    expect(body.data).toEqual({
      title: '内测交流群',
      description: '扫码加入',
      link: null,
      linkLabel: '',
      qr: { src: '/api/community/qr?v=abcdef012345', expiresAt: '2026-11-18T00:00:00Z' },
    });
    const image = await fetchRaw('/api/community/qr');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
  });

  it('hides an expired QR and falls back to the link', async () => {
    await save({ ...settings, link: 'https://qm.qq.com/q/example', linkLabel: 'QQ 群' });
    api.setNow(new Date('2026-11-18T00:00:01Z'));
    const { body } = await api.call('GET', '/api/community');
    expect(body.data.qr).toBeNull();
    expect(body.data.link).toBe('https://qm.qq.com/q/example');
    expect((await fetchRaw('/api/community/qr')).status).toBe(404);
  });

  it('is hidden when disabled or when nothing is left to show', async () => {
    await save({ ...settings, enabled: false });
    expect((await api.call('GET', '/api/community')).body.data).toBeNull();
    await api.db.batch([
      api.db.prepare('DELETE FROM site_settings'),
      api.db.prepare('DELETE FROM site_assets'),
    ]);
    await save(settings, false);
    expect((await api.call('GET', '/api/community')).body.data).toBeNull();
  });
});

/** The JSON helper parses bodies; images need the raw response. */
async function fetchRaw(path: string): Promise<Response> {
  const { createHandler } = await import('../../worker/src/app');
  const app = createHandler({ now: api.now });
  const env = { DB: api.db, ASSETS: { fetch: async () => new Response('') } } as unknown as Env;
  return app.fetch(new Request(`${ORIGIN}${path}`), env);
}
