import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { seedOffers, seedProvider } from './helpers/seed';
import { createHandler } from '../../worker/src/app';
import { isPubliclyVisible } from '../../worker/src/domain/visibility';
import type { Status } from '../../worker/src/domain/status';

const NOW = new Date('2026-11-11T12:00:00Z');
const TODAY = '2026-11-11';

let t: TestDb;
let handle: (path: string, init?: RequestInit) => Promise<Response>;

const STATUSES: Status[] = ['draft', 'pending_review', 'published', 'expired'];
const DATES = [null, '2026-11-10', TODAY, '2026-11-12'];

/** Every status × validFrom × validUntil combination, for the visibility property test. */
const MATRIX = STATUSES.flatMap((status) =>
  DATES.flatMap((validFrom) => DATES.map((validUntil) => ({ status, validFrom, validUntil }))),
).map((o, i) => ({ ...o, id: `matrix-${i}`, pool: 'education' }));

beforeAll(async () => {
  t = await createTestDb();
  await seedProvider(t.db);
  await seedProvider(t.db, 'other', 'Other Co', ['other.example']);
  await seedOffers(t.db, [
    { id: 'ai-ssr', pool: 'ai', rarity: 'SSR', title: 'GPU 赠金', requiresPaymentMethod: true },
    { id: 'ai-a', pool: 'ai', rarity: 'A', title: 'Model trial', newUsersOnly: true },
    { id: 'cloud-s', pool: 'cloud', rarity: 'S', providerId: 'other', regions: ['US', 'JP'] },
    { id: 'software-a', pool: 'software', rarity: 'A', studentOnly: true, autoRenews: true },
    { id: 'never-verified', pool: 'software', rarity: 'S', lastVerifiedAt: null },
    { id: 'ai-draft', pool: 'ai', status: 'draft', title: 'GPU secret draft' },
    { id: 'ai-pending', pool: 'ai', status: 'pending_review' },
    { id: 'ai-expired', pool: 'ai', status: 'expired' },
    { id: 'ai-past', pool: 'ai', validUntil: '2026-11-10' },
    { id: 'ai-future', pool: 'ai', validFrom: '2026-11-12' },
    ...MATRIX,
  ]);
  const app = createHandler({ now: () => NOW });
  const env = {
    DB: t.db,
    ASSETS: { fetch: async () => new Response('asset') },
  } as unknown as Env;
  handle = (path, init) => app.fetch(new Request(`https://dealdex.test${path}`, init), env);
}, 60_000);

afterAll(async () => {
  await t?.dispose();
});

// Loose shape for assertions; the exact envelope is asserted field by field below.
interface Envelope {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertions on dynamic JSON
  data: any;
  error: { code: string } | null;
  meta?: { total: number; limit: number; offset: number };
}
const json = async (res: Response) => (await res.json()) as Envelope;
const ids = (body: Envelope): string[] => body.data.map((o: { id: string }) => o.id);

describe('GET /api/offers', () => {
  it('lists only public offers in a stable envelope', async () => {
    const res = await handle('/api/offers?pool=ai');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('max-age=');
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(ids(body)).toEqual(['ai-ssr', 'ai-a']);
    expect(body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
  });

  it('sorts by rarity (SSR first) then title', async () => {
    const body = await json(await handle('/api/offers?pool=software'));
    expect(ids(body)).toEqual(['never-verified', 'software-a']);
  });

  it('returns the public shape with structured conditions and no internal fields', async () => {
    const body = await json(await handle('/api/offers?pool=cloud'));
    expect(body.data[0]).toEqual({
      id: 'cloud-s',
      provider: { id: 'other', name: 'Other Co' },
      pool: 'cloud',
      rarity: 'S',
      title: 'Offer cloud-s',
      summary: 'summary',
      benefit: 'benefit',
      officialUrl: 'https://www.example.com/deal',
      sourceUrl: 'https://docs.example.com/deal',
      conditions: {
        newUsersOnly: false,
        studentOnly: false,
        requiresPaymentMethod: false,
        autoRenews: false,
        regions: ['US', 'JP'],
        note: '',
      },
      validFrom: null,
      validUntil: null,
      lastVerifiedAt: '2026-11-10T08:00:00Z',
    });
  });

  it.each([
    ['rarity=SSR', ['ai-ssr']],
    ['provider=other', ['cloud-s']],
    ['newUsersOnly=true&pool=ai', ['ai-a']],
    ['studentOnly=true', ['software-a']],
    ['requiresPaymentMethod=false&pool=ai', ['ai-a']],
    ['autoRenews=true', ['software-a']],
    ['q=gpu', ['ai-ssr']],
    ['q=%E8%B5%A0%E9%87%91', ['ai-ssr']],
  ])('filters by %s', async (query, expected) => {
    expect(ids(await json(await handle(`/api/offers?${query}`)))).toEqual(expected);
  });

  it('treats LIKE wildcards in q literally', async () => {
    expect(ids(await json(await handle('/api/offers?q=%25')))).toEqual([]);
    expect(ids(await json(await handle('/api/offers?q=_')))).toEqual([]);
  });

  it('paginates with total count', async () => {
    const first = await json(await handle('/api/offers?limit=2'));
    const second = await json(await handle('/api/offers?limit=2&offset=2'));
    expect(first.data).toHaveLength(2);
    expect(first.meta?.total).toBe(second.meta?.total);
    expect(ids(first)).not.toEqual(ids(second));
  });

  it.each([
    'pool=games',
    'rarity=UR',
    'limit=0',
    'limit=101',
    'offset=-1',
    'limit=abc',
    'studentOnly=yes',
    'unknown=1',
    `q=${'x'.repeat(101)}`,
  ])('rejects bad query %s with 400', async (query) => {
    const res = await handle(`/api/offers?${query}`);
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe('invalid_query');
  });

  it('matches isPubliclyVisible for every status and date combination', async () => {
    const body = await json(await handle('/api/offers?pool=education&limit=100'));
    const expected = MATRIX.filter((o) => isPubliclyVisible(o, TODAY))
      .map((o) => o.id)
      .sort();
    expect([...ids(body)].sort()).toEqual(expected);
  });
});

describe('GET /api/offers/:id', () => {
  it('returns a public offer', async () => {
    const res = await handle('/api/offers/ai-ssr');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe('ai-ssr');
    expect(body.data.conditions.requiresPaymentMethod).toBe(true);
  });

  it.each(['ai-draft', 'ai-pending', 'ai-expired', 'ai-past', 'ai-future', 'missing'])(
    'hides %s behind the same 404',
    async (id) => {
      const res = await handle(`/api/offers/${id}`);
      expect(res.status).toBe(404);
      expect((await json(res)).error?.code).toBe('not_found');
    },
  );

  it('agrees with the list for every matrix offer', async () => {
    for (const o of MATRIX) {
      const res = await handle(`/api/offers/${o.id}`);
      expect(res.status, o.id).toBe(isPubliclyVisible(o, TODAY) ? 200 : 404);
    }
  });

  it('rejects malformed ids without querying', async () => {
    expect((await handle('/api/offers/Bad%20Id')).status).toBe(404);
  });
});

describe('routing', () => {
  it('returns 405 with Allow for writes to read routes', async () => {
    const res = await handle('/api/offers', { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const res = await handle('/api/nope');
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('not_found');
  });

  it('serves static assets for non-API paths', async () => {
    expect(await (await handle('/')).text()).toBe('asset');
  });

  it('sets nosniff on API responses', async () => {
    const res = await handle('/api/offers');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('error handling', () => {
  it('hides internal errors behind a generic 500 and logs details', async () => {
    const broken = {
      DB: {
        prepare: () => {
          throw new Error('D1 exploded: secret detail');
        },
      },
      ASSETS: { fetch: async () => new Response('asset') },
    } as unknown as Env;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await createHandler({ now: () => NOW }).fetch(
        new Request('https://dealdex.test/api/offers/ai-ssr'),
        broken,
      );
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain('secret detail');
      expect(JSON.parse(text).error.code).toBe('internal_error');
      expect(spy).toHaveBeenCalledWith(
        'api_error',
        expect.objectContaining({ path: '/api/offers/ai-ssr' }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
