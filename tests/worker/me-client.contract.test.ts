/* Contract: the browser's user-API client against the real Worker and D1.
 * Catches drift between server responses and the frontend validators. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { seedOffers, seedProvider } from './helpers/seed';
import { TEST_IP_SECRET } from './helpers/user-api';
import { createHandler } from '../../worker/src/app';
import { ApiError, createApiClient } from '../../src/api/client.js';
import { createMeClient } from '../../src/api/me-client.js';

const ORIGIN = 'https://dealdex.test';
const NOW = new Date('2026-11-12T03:00:00Z');

let t: TestDb;
let me: ReturnType<typeof createMeClient>;
let jar = '';

beforeAll(async () => {
  t = await createTestDb();
  await seedProvider(t.db);
  await seedOffers(t.db, [
    { id: 'cloud-a', pool: 'cloud', rarity: 'A' },
    { id: 'ai-a', pool: 'ai', rarity: 'A' },
  ]);
  const app = createHandler({ now: () => NOW, random: () => 0 });
  const env = {
    DB: t.db,
    ASSETS: { fetch: async () => new Response('asset') },
    IP_HASH_SECRET: TEST_IP_SECRET,
  } as unknown as Env;

  // A minimal browser: same-origin requests carry Origin and the cookie jar.
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', ORIGIN);
    if (jar) headers.set('cookie', jar);
    const res = await app.fetch(new Request(input, { ...init, headers }), env);
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0] ?? '';
    return res;
  };
  const api = createApiClient({ baseUrl: ORIGIN, timeoutMs: 5000, fetchImpl });
  me = createMeClient(api);
}, 60_000);

afterAll(async () => {
  await t?.dispose();
});

describe('me-client against the real API', () => {
  it('reads an anonymous profile', async () => {
    const profile = await me.getMe();
    expect(profile.user).toBeNull();
    expect(profile.quota).toMatchObject({ max: 3, used: 0, day: '2026-11-12' });
  });

  it('imports legacy data, creating the session', async () => {
    const result = await me.importLegacy({
      collection: [{ id: 'ai-a', ts: NOW.getTime() - 1000 }],
      favorites: ['ai-a'],
    });
    expect(result).toEqual({ imported: 1, favorites: 1 });
    expect(jar).toContain('__Host-ddx_sid=');
  });

  it('draws, replays with the same key, and validates both replies', async () => {
    const first = await me.draw('cloud', 'contract-1');
    expect(first).toMatchObject({ offer: { id: 'cloud-a' }, draw: { isNew: true } });
    expect(first.quota.used).toBe(1);
    const again = await me.draw('cloud', 'contract-1');
    expect(again.draw.id).toBe(first.draw.id);
    expect(again.quota.used).toBe(1);
  });

  it('reads the collection, history and toggles a favorite', async () => {
    const collection = await me.getCollection();
    expect(collection.cards.map((c) => c.offer.id).sort()).toEqual(['ai-a', 'cloud-a']);
    expect(collection.progress.live).toEqual({ found: 2, total: 2 });

    const history = await me.getHistory();
    expect(history.items).toHaveLength(1);
    expect(history.nextCursor).toBeNull();

    expect(await me.setFavorite('cloud-a', true)).toBe(true);
    expect(await me.setFavorite('cloud-a', false)).toBe(false);
  });

  it('surfaces quota_exhausted with details and Retry-After', async () => {
    await me.draw('cloud', 'contract-2');
    await me.draw('cloud', 'contract-3');
    const error = await me.draw('cloud', 'contract-4').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'quota_exhausted', status: 429, retryAfter: 46800 });
    expect((error as ApiError).details).toMatchObject({ used: 3, max: 3 });
  });
});
