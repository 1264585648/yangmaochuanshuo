import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, NOW, offerInput, PROVIDER, type Harness } from './helpers/api';
import { commit, plan } from '../../worker/src/write/commit';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await h.call('POST', '/api/manage/providers', { body: PROVIDER });
  await h.call('POST', '/api/manage/offers', { body: offerInput('edge-offer') });
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

const admin = { id: 'admin-1', scope: 'admin' as const };
const ctx = (key: string, hash = 'h') => ({
  db: h.db,
  client: admin,
  now: NOW,
  idempotency: { key, hash },
});
const audit = {
  action: 'test',
  entityType: 'offer' as const,
  entityId: 'x',
  before: null,
  after: null,
};

describe('commit', () => {
  it('uses a generic conflict when a guarded step misses and no conflict is given', async () => {
    const res = await commit(
      ctx('edge-generic'),
      plan({
        steps: [
          {
            statement: h.db.prepare("UPDATE offers SET title = 'x' WHERE id = 'none'"),
            guarded: true,
          },
        ],
        audit,
        status: 200,
        data: {},
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('replays when a concurrent request stored the same key first', async () => {
    await h.db
      .prepare(
        `INSERT INTO idempotency_keys (actor, key, request_hash, response_status, response_body, created_at)
         VALUES ('admin-1', 'edge-race', 'h', 201, '{"success":true,"data":"first","error":null}', ?)`,
      )
      .bind(NOW.toISOString())
      .run();
    const res = await commit(
      ctx('edge-race'),
      plan({ steps: [], audit, status: 201, data: 'second' }),
    );
    expect(res.headers.get('idempotent-replayed')).toBe('true');
    expect(((await res.json()) as { data: string }).data).toBe('first');
  });

  it('rethrows unexpected database errors', async () => {
    const bad = h.db.prepare("UPDATE offers SET pool = 'games' WHERE id = 'edge-offer'");
    await expect(
      commit(
        ctx('edge-check'),
        plan({ steps: [{ statement: bad }], audit, status: 200, data: {} }),
      ),
    ).rejects.toThrow();
  });
});

describe('query validation on management reads', () => {
  it.each([
    '/api/manage/offers?status=live',
    '/api/manage/offers?limit=0',
    '/api/manage/offers?limit=abc',
    '/api/manage/offers?offset=-1',
    '/api/manage/changes?status=done',
    '/api/manage/changes?limit=999',
    '/api/manage/audit?limit=x',
  ])('rejects %s', async (path) => {
    expect((await h.read(path)).res.status).toBe(400);
  });

  it('filters changes by offer and lists audit without filters', async () => {
    const changes = await h.read('/api/manage/changes?offerId=edge-offer');
    expect(changes.res.status).toBe(200);
    expect(changes.body.data).toEqual([]);
    const audit = await h.read('/api/manage/audit?entityType=provider&limit=5');
    expect(audit.body.data.every((e: { entityType: string }) => e.entityType === 'provider')).toBe(
      true,
    );
    expect((await h.read('/api/manage/audit')).body.data.length).toBeGreaterThan(0);
  });
});

describe('routing edge cases', () => {
  it('returns 404 for malformed percent-encoding', async () => {
    expect((await h.read('/api/manage/offers/%E0%A4%A')).res.status).toBe(404);
    expect((await h.call('GET', '/api/offers/%E0%A4%A')).status).toBe(404);
  });

  it('returns 405 with allowed methods on management routes', async () => {
    const res = await h.call('DELETE', '/api/manage/offers/edge-offer');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, PATCH');
  });

  it('returns 404 for unknown management paths and ids', async () => {
    expect((await h.read('/api/manage/nothing')).res.status).toBe(404);
    expect((await h.write('POST', '/api/manage/changes/missing/apply')).res.status).toBe(404);
    expect((await h.write('POST', '/api/manage/changes/missing/reject')).res.status).toBe(404);
    expect((await h.write('POST', '/api/manage/audit/999999/revert')).res.status).toBe(404);
    expect(
      (
        await h.write('POST', '/api/manage/offers/missing/changes', {
          body: { baseVersion: 1, changes: { title: 'x' }, sourceUrl: 'https://example.com/' },
        })
      ).res.status,
    ).toBe(404);
    expect(
      (
        await h.write('PATCH', '/api/manage/offers/missing', {
          body: { baseVersion: 1, changes: { title: 'x' } },
        })
      ).res.status,
    ).toBe(404);
  });
});

describe('providers edge cases', () => {
  it('rejects empty updates and unknown providers', async () => {
    expect((await h.write('PATCH', '/api/manage/providers/example', { body: {} })).res.status).toBe(
      400,
    );
    expect(
      (await h.write('PATCH', '/api/manage/providers/missing', { body: { name: 'x' } })).res.status,
    ).toBe(404);
  });
});

describe('change request edge cases', () => {
  it('rejects stale proposals and invalid merged content', async () => {
    const stale = await h.write('POST', '/api/manage/offers/edge-offer/changes', {
      body: { baseVersion: 9, changes: { title: 'x' }, sourceUrl: 'https://example.com/' },
    });
    expect(stale.res.status).toBe(409);
    const invalid = await h.write('POST', '/api/manage/offers/edge-offer/changes', {
      body: {
        baseVersion: 1,
        changes: { validFrom: '2027-01-01', validUntil: '2026-01-01' },
        sourceUrl: 'https://example.com/',
      },
    });
    expect(invalid.res.status).toBe(400);
    const missingSource = await h.write('POST', '/api/manage/offers/edge-offer/changes', {
      body: { baseVersion: 1, changes: { title: 'x' } },
    });
    expect(missingSource.res.status).toBe(400);
  });

  it('re-checks domains when applying, in case they changed', async () => {
    await h.write('POST', '/api/manage/providers', {
      body: { id: 'shifty', name: 'Shifty', officialDomains: ['shifty.example'] },
    });
    await h.write('POST', '/api/manage/offers', {
      body: offerInput('shifty-offer', {
        providerId: 'shifty',
        officialUrl: 'https://shifty.example/a',
        sourceUrl: 'https://shifty.example/b',
      }),
    });
    const proposal = await h.write('POST', '/api/manage/offers/shifty-offer/changes', {
      token: h.tokens.inspector,
      body: { baseVersion: 1, changes: { title: 'New' }, sourceUrl: 'https://shifty.example/c' },
    });
    await h.write('PATCH', '/api/manage/providers/shifty', {
      body: { officialDomains: ['elsewhere.example'] },
    });
    const apply = await h.write('POST', `/api/manage/changes/${proposal.body.data.id}/apply`);
    expect(apply.res.status).toBe(422);
    const reject = await h.write('POST', `/api/manage/changes/${proposal.body.data.id}/reject`, {
      token: h.tokens.inspector,
    });
    expect(reject.res.status).toBe(403);
  });
});

describe('revert edge cases', () => {
  it('rejects non-numeric ids and non-offer entries', async () => {
    expect((await h.write('POST', '/api/manage/audit/abc/revert')).res.status).toBe(404);
    const providerEntry = (await h.read('/api/manage/audit?entityType=provider&limit=1')).body
      .data[0];
    expect((await h.write('POST', `/api/manage/audit/${providerEntry.id}/revert`)).res.status).toBe(
      422,
    );
    expect(
      (
        await h.write('POST', `/api/manage/audit/${providerEntry.id}/revert`, {
          token: h.tokens.inspector,
        })
      ).res.status,
    ).toBe(403);
  });
});
