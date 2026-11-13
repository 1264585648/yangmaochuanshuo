import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, offerInput, NOW, type Harness } from './helpers/api';
import { seedOffers, seedProvider } from './helpers/seed';
import { COMMUNITY_QR_MAX_BYTES } from '../../worker/src/config';

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await seedProvider(h.db);
  await seedOffers(h.db, [
    { id: 'ai-a', pool: 'ai', title: 'AI 卡' },
    { id: 'cloud-a', pool: 'cloud', title: '云卡' },
  ]);
}, 60_000);

afterEach(async () => {
  await h.t.dispose();
});

const insertFeedback = (kind: string, offerId: string | null, message = 'm') =>
  h.db
    .prepare(
      `INSERT INTO feedback (kind, offer_id, category, message, created_at, updated_at)
       VALUES (?, ?, 'other', ?, '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')`,
    )
    .bind(kind, offerId, message)
    .run();

describe('feedback management', () => {
  it('lists newest first with the offer title, filtered by status', async () => {
    await insertFeedback('offer', 'ai-a', 'first');
    await insertFeedback('general', null, '<script>x</script>');
    const { body } = await h.read('/api/manage/feedback?status=open');
    expect(body.meta?.total).toBe(2);
    expect(body.data[0]).toMatchObject({ kind: 'general', offer: null });
    expect(body.data[1]).toMatchObject({ offer: { id: 'ai-a', title: 'AI 卡' }, message: 'first' });
    expect((await h.read('/api/manage/feedback?status=resolved')).body.meta?.total).toBe(0);
    expect((await h.read('/api/manage/feedback?status=bogus')).res.status).toBe(400);
    const all = await h.read('/api/manage/feedback?limit=1&offset=1');
    expect(all.body.meta).toEqual({ total: 2, limit: 1, offset: 1 });
    expect(all.body.data[0].message).toBe('first');
  });

  it('resolves with a note, audited, and refuses double transitions', async () => {
    await insertFeedback('offer', 'ai-a');
    const resolved = await h.write('POST', '/api/manage/feedback/1/resolve', {
      body: { note: '已下架' },
    });
    expect(resolved.res.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: 'resolved', note: '已下架' });

    const again = await h.write('POST', '/api/manage/feedback/1/dismiss');
    expect(again.res.status).toBe(409);
    const reopened = await h.write('POST', '/api/manage/feedback/1/reopen');
    expect(reopened.body.data).toMatchObject({ status: 'open', note: '已下架' });

    const audit = await h.db
      .prepare("SELECT action FROM audit_log WHERE entity_type = 'feedback' ORDER BY id")
      .all();
    expect(audit.results.map((r) => (r as { action: string }).action)).toEqual([
      'feedback.resolve',
      'feedback.reopen',
    ]);
  });

  it('is admin-only and 404s on unknown ids or actions', async () => {
    await insertFeedback('general', null);
    expect((await h.read('/api/manage/feedback', h.tokens.inspector)).res.status).toBe(403);
    const inspector = await h.write('POST', '/api/manage/feedback/1/resolve', {
      token: h.tokens.inspector,
    });
    expect(inspector.res.status).toBe(403);
    expect((await h.write('POST', '/api/manage/feedback/99/resolve')).res.status).toBe(404);
    expect((await h.write('POST', '/api/manage/feedback/1/delete')).res.status).toBe(404);
  });
});

describe('click stats', () => {
  it('summarises distinct visitors overall, recently and per offer', async () => {
    const stmt = h.db.prepare('INSERT INTO offer_clicks (offer_id, day, visitor) VALUES (?, ?, ?)');
    await h.db.batch([
      stmt.bind('ai-a', '2026-11-01', 'v1'),
      stmt.bind('ai-a', '2026-11-11', 'v1'),
      stmt.bind('ai-a', '2026-11-11', 'v2'),
      stmt.bind('cloud-a', '2026-11-11', 'v3'),
    ]);
    const { body } = await h.read('/api/manage/stats/clicks?days=7');
    expect(body.data.since).toBe('2026-11-05');
    expect(body.data.totals).toEqual({
      visitors: 3,
      recentVisitors: 3,
      clicks: 4,
      recentClicks: 3,
    });
    expect(body.data.daily).toEqual([{ day: '2026-11-11', visitors: 3 }]);
    expect(body.data.topOffers[0]).toMatchObject({ id: 'ai-a', visitors: 2, recentVisitors: 2 });
    expect((await h.read('/api/manage/stats/clicks?days=0')).res.status).toBe(400);
    expect((await h.read('/api/manage/stats/clicks', h.tokens.inspector)).res.status).toBe(403);
  });
});

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const toBase64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const community = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  title: '羊毛传说内测群',
  description: '反馈问题、交流羊毛',
  link: null,
  qrExpiresAt: '2026-11-18T00:00:00Z',
  qr: { base64: toBase64([...PNG_HEADER, 1, 2, 3]) },
  ...overrides,
});

describe('community settings', () => {
  it('saves settings and image, audits by fingerprint only, and keeps the image on edit', async () => {
    const saved = await h.write('PUT', '/api/manage/community', { body: community() });
    expect(saved.res.status).toBe(200);
    expect(saved.body.data.qr).toMatchObject({ contentType: 'image/png' });
    expect(saved.body.data.qr.sha256).toMatch(/^[0-9a-f]{64}$/);

    const audit = await h.db
      .prepare("SELECT after FROM audit_log WHERE entity_type = 'setting'")
      .first<{ after: string }>();
    expect(audit?.after).not.toContain(toBase64([...PNG_HEADER, 1, 2, 3]));

    const { qr: _qr, ...withoutImage } = community({ title: '新名字' });
    const edited = await h.write('PUT', '/api/manage/community', { body: withoutImage });
    expect(edited.body.data).toMatchObject({ title: '新名字', qr: saved.body.data.qr });
    expect((await h.read('/api/manage/community')).body.data.title).toBe('新名字');

    const removed = await h.write('PUT', '/api/manage/community', {
      body: community({ qr: null, link: 'https://qm.qq.com/q/abc' }),
    });
    expect(removed.body.data.qr).toBeNull();
    expect(
      Number(
        (await h.db.prepare('SELECT COUNT(*) AS n FROM site_assets').first<{ n: number }>())?.n,
      ),
    ).toBe(0);
  });

  it('rejects SVG, non-https links and an enabled group with nothing to show', async () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const cases: [Record<string, unknown>, number][] = [
      [community({ qr: { base64: svg } }), 422],
      [community({ link: 'http://example.com' }), 400],
      [community({ link: 'javascript:alert(1)' }), 400],
      [community({ qr: null }), 422],
      [community({ qr: { base64: 'not base64!' } }), 400],
    ];
    for (const [body, status] of cases) {
      expect((await h.write('PUT', '/api/manage/community', { body })).res.status).toBe(status);
    }
  });

  it('allows uploads above the default body cap but not above the image cap', async () => {
    const big = new Array<number>(200 * 1024).fill(7);
    const okRes = await h.write('PUT', '/api/manage/community', {
      body: community({ qr: { base64: toBase64Large([...PNG_HEADER, ...big]) } }),
    });
    expect(okRes.res.status).toBe(200);
    const tooBig = new Array<number>(COMMUNITY_QR_MAX_BYTES + 1).fill(7);
    const res = await h.write('PUT', '/api/manage/community', {
      body: community({ qr: { base64: toBase64Large([...PNG_HEADER, ...tooBig]) } }),
    });
    expect([400, 413, 422]).toContain(res.res.status);
  });

  it('is admin-only', async () => {
    const res = await h.write('PUT', '/api/manage/community', {
      body: community(),
      token: h.tokens.inspector,
    });
    expect(res.res.status).toBe(403);
  });
});

describe('publishedAt', () => {
  it('is set on first publish and survives expire and restore', async () => {
    await h.write('POST', '/api/manage/offers', { body: offerInput('fresh') });
    await h.write('POST', '/api/manage/offers/fresh/submit');
    const published = await h.write('POST', '/api/manage/offers/fresh/publish');
    expect(published.body.data.publishedAt).toBe(NOW.toISOString());
    const pub = await h.read('/api/offers/fresh', null);
    expect(pub.body.data.publishedAt).toBe(NOW.toISOString());
    expect(pub.body.data.officialVisitors).toBeNull();
    const evidence = { sourceUrl: 'https://docs.example.com/terms' };
    await h.write('POST', '/api/manage/offers/fresh/expire', { body: evidence });
    const restored = await h.write('POST', '/api/manage/offers/fresh/restore');
    expect(restored.body.data.publishedAt).toBe(NOW.toISOString());
  });
});

function toBase64Large(bytes: number[]): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return btoa(binary);
}
