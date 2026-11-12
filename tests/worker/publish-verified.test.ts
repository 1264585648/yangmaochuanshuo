import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHandler } from '../../worker/src/app';
import { createHarness, NOW, offerInput, PROVIDER, type Harness } from './helpers/api';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  const { res } = await h.write('POST', '/api/manage/providers', { body: PROVIDER });
  expect(res.status).toBe(201);
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

const evidence = { sourceUrl: 'https://docs.example.com/terms' };

const act = (id: string, action: string, body: unknown = {}, token = h.tokens.admin) =>
  h.write('POST', `/api/manage/offers/${id}/${action}`, { token, body });

async function pending(id: string) {
  expect((await h.write('POST', '/api/manage/offers', { body: offerInput(id) })).res.status).toBe(
    201,
  );
  expect((await act(id, 'submit')).res.status).toBe(200);
}

const stored = (id: string) =>
  h.db
    .prepare('SELECT status, version, last_verified_at FROM offers WHERE id = ?')
    .bind(id)
    .first<{ status: string; version: number; last_verified_at: string | null }>();

describe('publish with verified: true', () => {
  it('publishes and records the verification in one write', async () => {
    await pending('pv-ok');
    const before = await stored('pv-ok');
    const { res, body } = await act('pv-ok', 'publish', { ...evidence, verified: true });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ status: 'published', lastVerifiedAt: NOW.toISOString() });
    expect(await stored('pv-ok')).toEqual({
      status: 'published',
      version: before?.version,
      last_verified_at: NOW.toISOString(),
    });
    const audit = await h.read('/api/manage/audit?entityType=offer&entityId=pv-ok');
    const entry = audit.body.data[0];
    expect(entry.action).toBe('offer.publish');
    expect(entry.after.lastVerifiedAt).toBe(NOW.toISOString());
    expect(entry.sourceUrl).toBe(evidence.sourceUrl);
    const pub = await h.read('/api/offers/pv-ok', null);
    expect(pub.body.data.lastVerifiedAt).toBe(NOW.toISOString());
  });

  it('leaves the verification date empty without the flag', async () => {
    await pending('pv-plain');
    const { res, body } = await act('pv-plain', 'publish');
    expect(res.status).toBe(200);
    expect(body.data.lastVerifiedAt).toBeNull();
    expect((await stored('pv-plain'))?.last_verified_at).toBeNull();
  });

  it('requires evidence like verify does', async () => {
    await pending('pv-evidence');
    const missing = await act('pv-evidence', 'publish', { verified: true });
    expect(missing.res.status).toBe(400);
    expect(missing.body.error?.code).toBe('source_required');
    // Official domain, but a different host than the offer's own links.
    const mismatch = await act('pv-evidence', 'publish', {
      sourceUrl: 'https://blog.example.com/post',
      verified: true,
    });
    expect(mismatch.res.status).toBe(422);
    expect(mismatch.body.error?.code).toBe('evidence_mismatch');
    const offsite = await act('pv-evidence', 'publish', {
      sourceUrl: 'https://evil.example/',
      verified: true,
    });
    expect(offsite.res.status).toBe(422);
    expect(offsite.body.error?.code).toBe('unofficial_url');
    expect(await stored('pv-evidence')).toMatchObject({
      status: 'pending_review',
      last_verified_at: null,
    });
  });

  it('rejects the flag on other actions and non-true values', async () => {
    await pending('pv-other');
    const onReject = await act('pv-other', 'reject', { ...evidence, verified: true });
    expect(onReject.res.status).toBe(400);
    expect(onReject.body.error?.code).toBe('invalid_body');
    const falsy = await act('pv-other', 'publish', { ...evidence, verified: false });
    expect(falsy.res.status).toBe(400);
    expect(falsy.body.error?.code).toBe('invalid_body');
    expect((await stored('pv-other'))?.status).toBe('pending_review');
  });

  it('keeps inspectors from publishing even with evidence', async () => {
    await pending('pv-inspector');
    const { res } = await act(
      'pv-inspector',
      'publish',
      { ...evidence, verified: true },
      h.tokens.inspector,
    );
    expect(res.status).toBe(403);
  });

  it('writes nothing when the offer changes between read and update', async () => {
    await pending('pv-raced');
    const auditBefore = await h.auditCount();
    // A concurrent edit lands after the row was read but before the write batch runs.
    const racingDb = new Proxy(h.db, {
      get(target, prop, receiver) {
        if (prop === 'batch') {
          return async (statements: Parameters<typeof target.batch>[0]) => {
            await target
              .prepare('UPDATE offers SET version = version + 1 WHERE id = ?')
              .bind('pv-raced')
              .run();
            return target.batch(statements);
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const app = createHandler({ now: () => NOW });
    const env = { DB: racingDb, ASSETS: { fetch: async () => new Response('') } } as unknown as Env;
    const res = await app.fetch(
      new Request('https://dealdex.test/api/manage/offers/pv-raced/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${h.tokens.admin}`,
          'content-type': 'application/json',
          'idempotency-key': 'pv-raced-1',
        },
        body: JSON.stringify({ ...evidence, verified: true }),
      }),
      env,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('conflict');
    expect(await stored('pv-raced')).toMatchObject({
      status: 'pending_review',
      last_verified_at: null,
    });
    expect(await h.auditCount()).toBe(auditBefore);
  });
});
