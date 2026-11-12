import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, insertClient, offerInput, PROVIDER, type Harness } from './helpers/api';
import { generateToken, hashToken, parseBearer } from '../../worker/src/auth/tokens';
import { MAX_BODY_BYTES } from '../../worker/src/http/body';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await h.call('POST', '/api/manage/providers', { body: PROVIDER, token: h.tokens.admin2 });
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

describe('tokens', () => {
  it('generates prefixed high-entropy tokens', () => {
    const a = generateToken();
    expect(a).toMatch(/^ddx_[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes deterministically to hex', async () => {
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each([
    [null, null],
    ['Basic abc', null],
    ['Bearer ', null],
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
  ])('parses %j', (header, expected) => {
    expect(parseBearer(header)).toBe(expected);
  });
});

describe('authentication', () => {
  it('rejects missing, unknown and revoked tokens', async () => {
    const missing = await h.call('GET', '/api/manage/offers', { token: null });
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');
    expect((await h.call('GET', '/api/manage/offers', { token: 'ddx_nope' })).status).toBe(401);
    const revoked = await insertClient(h.db, 'revoked-1', 'admin', true);
    expect((await h.call('GET', '/api/manage/offers', { token: revoked })).status).toBe(401);
  });

  it('never stores raw tokens', async () => {
    const rows = await h.db
      .prepare('SELECT token_hash FROM api_clients')
      .all<{ token_hash: string }>();
    for (const row of rows.results) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(h.tokens)).not.toContain(row.token_hash);
    }
  });
});

describe('request validation', () => {
  it('requires an idempotency key on writes', async () => {
    const res = await h.call('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      body: offerInput('no-key'),
      key: null,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'idempotency_key_required',
    );
  });

  it('rejects malformed idempotency keys', async () => {
    const res = await h.call('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      body: offerInput('bad-key'),
      key: 'has spaces',
    });
    expect(res.status).toBe(400);
  });

  it('requires JSON bodies', async () => {
    const res = await h.call('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      rawBody: 'id=x',
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(415);
    const broken = await h.call('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      rawBody: '{nope',
    });
    expect(broken.status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const res = await h.call('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      rawBody: JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('idempotency', () => {
  it('replays the original response without writing twice', async () => {
    const body = offerInput('idem-once');
    const first = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      body,
      key: 'create-idem-once',
    });
    expect(first.res.status).toBe(201);
    const second = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      body,
      key: 'create-idem-once',
    });
    expect(second.res.status).toBe(201);
    expect(second.res.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body).toEqual(first.body);
  });

  it('rejects the same key with a different body', async () => {
    const { res, body } = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.admin2,
      body: offerInput('idem-other'),
      key: 'create-idem-once',
    });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('idempotency_key_reused');
  });

  it('scopes keys per caller', async () => {
    const { res } = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.inspector,
      body: offerInput('idem-inspector'),
      key: 'create-idem-once',
    });
    expect(res.status).toBe(201);
  });

  it('does not store failed attempts, so a corrected retry succeeds', async () => {
    const bad = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.inspector,
      body: offerInput('idem-retry', { sourceUrl: 'https://evil.example/' }),
      key: 'retry-key',
    });
    expect(bad.res.status).toBe(422);
    const good = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.inspector,
      body: offerInput('idem-retry'),
      key: 'retry-key',
    });
    expect(good.res.status).toBe(201);
  });

  it('leaves no trace when a guarded write conflicts', async () => {
    const before = await h.db
      .prepare('SELECT COUNT(*) AS n FROM idempotency_keys')
      .first<{ n: number }>();
    const conflict = await h.write('PATCH', '/api/manage/offers/idem-once', {
      token: h.tokens.admin2,
      body: { baseVersion: 99, changes: { title: 'x' } },
    });
    expect(conflict.res.status).toBe(409);
    const after = await h.db
      .prepare('SELECT COUNT(*) AS n FROM idempotency_keys')
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

describe('rate limiting', () => {
  let r: Harness;

  beforeAll(async () => {
    r = await createHarness({ rateLimit: { max: 5, windowSeconds: 60 } });
    await r.call('POST', '/api/manage/providers', { body: PROVIDER, token: r.tokens.admin2 });
  }, 60_000);

  afterAll(async () => {
    await r?.t.dispose();
  });

  it('limits writes per caller and reports Retry-After', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await r.call('POST', '/api/manage/offers', {
        token: r.tokens.admin,
        body: offerInput(`rate-${i}`),
      });
      statuses.push(res.status);
      if (res.status === 429) expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it('does not limit other callers or reads', async () => {
    expect((await r.call('GET', '/api/manage/offers', { token: r.tokens.admin })).status).toBe(200);
    const other = await r.call('POST', '/api/manage/offers', {
      token: r.tokens.inspector,
      body: offerInput('rate-other'),
    });
    expect(other.status).toBe(201);
  });
});
