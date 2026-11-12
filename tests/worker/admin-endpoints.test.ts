import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, PROVIDER, type Harness } from './helpers/api';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await h.write('POST', '/api/manage/providers', {
    body: { id: 'zeta', name: 'Zeta', officialDomains: ['zeta.example'] },
  });
  await h.write('POST', '/api/manage/providers', { body: PROVIDER });
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

describe('GET /api/manage/me', () => {
  it('returns the authenticated client id and scope', async () => {
    const admin = await h.read('/api/manage/me');
    expect(admin.res.status).toBe(200);
    expect(admin.body.data).toEqual({ id: 'admin-1', scope: 'admin' });

    const inspector = await h.read('/api/manage/me', h.tokens.inspector);
    expect(inspector.res.status).toBe(200);
    expect(inspector.body.data).toEqual({ id: 'inspector-1', scope: 'inspector' });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await h.call('GET', '/api/manage/me', { token: null });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/manage/providers', () => {
  it('lists providers sorted by id for both admin and inspector', async () => {
    const admin = await h.read('/api/manage/providers');
    expect(admin.res.status).toBe(200);
    expect(admin.body.data.map((p: { id: string }) => p.id)).toEqual(['example', 'zeta']);

    const inspector = await h.read('/api/manage/providers', h.tokens.inspector);
    expect(inspector.res.status).toBe(200);
    expect(inspector.body.data).toHaveLength(2);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await h.call('GET', '/api/manage/providers', { token: null });
    expect(res.status).toBe(401);
  });
});
