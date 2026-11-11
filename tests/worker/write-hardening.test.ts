import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, NOW, offerInput, PROVIDER, type Harness } from './helpers/api';
import { providerSchema } from '../../worker/src/domain/schema';
import { INSPECTOR_EXPIRE_LIMIT, INSPECTOR_PENDING_CAP } from '../../worker/src/config';
import { readJsonBody } from '../../worker/src/http/body';

let h: Harness;

const evidence = { sourceUrl: 'https://docs.example.com/terms' };

beforeAll(async () => {
  h = await createHarness();
  await h.call('POST', '/api/manage/providers', { body: PROVIDER });
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

async function published(id: string) {
  await h.call('POST', '/api/manage/offers', { body: offerInput(id) });
  await h.call('POST', `/api/manage/offers/${id}/submit`);
  await h.call('POST', `/api/manage/offers/${id}/publish`);
}

describe('concurrent retries with the same idempotency key', () => {
  it('replays a create instead of reporting already_exists', async () => {
    const before = await h.auditCount();
    const body = offerInput('race-create');
    const [a, b] = await Promise.all([
      h.call('POST', '/api/manage/offers', { body, key: 'race-create-key' }),
      h.call('POST', '/api/manage/offers', { body, key: 'race-create-key' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await a.json()).toEqual(await b.json());
    expect(await h.auditCount()).toBe(before + 1);
  });

  it('replays an edit instead of reporting version_conflict', async () => {
    await published('race-edit');
    const body = { baseVersion: 1, changes: { title: 'Raced' } };
    const [a, b] = await Promise.all([
      h.call('PATCH', '/api/manage/offers/race-edit', { body, key: 'race-edit-key' }),
      h.call('PATCH', '/api/manage/offers/race-edit', { body, key: 'race-edit-key' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('reports change_not_pending to the loser of two different applies', async () => {
    await published('race-apply');
    const proposal = await h.write('POST', '/api/manage/offers/race-apply/changes', {
      token: h.tokens.inspector,
      body: { baseVersion: 1, changes: { title: 'Proposed' }, ...evidence },
    });
    const path = `/api/manage/changes/${proposal.body.data.id}/apply`;
    const results = await Promise.all([
      h.call('POST', path, { token: h.tokens.admin }),
      h.call('POST', path, { token: h.tokens.admin2 }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(((await loser?.json()) as { error: { code: string } }).error.code).toBe(
      'change_not_pending',
    );
  });
});

describe('content changes', () => {
  it('rejects edits that change nothing, keeping the version', async () => {
    await published('noop');
    const { res, body } = await h.write('PATCH', '/api/manage/offers/noop', {
      body: { baseVersion: 1, changes: { title: 'Offer noop' } },
    });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('no_changes');
    expect((await h.read('/api/manage/offers/noop')).body.data.version).toBe(1);
  });

  it('stores URLs in canonical form', async () => {
    const { body } = await h.write('POST', '/api/manage/offers', {
      body: offerInput('canonical', { officialUrl: ' https://WWW.Example.com ' }),
    });
    expect(body.data.officialUrl).toBe('https://www.example.com/');
  });

  it('records which change request an applied edit came from', async () => {
    const log = await h.read('/api/manage/audit?entityType=offer&entityId=race-apply');
    const apply = log.body.data.find((e: { action: string }) => e.action === 'change.apply');
    expect(apply.after.appliedChangeId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('inspector safeguards', () => {
  it('requires evidence from the offer’s own host', async () => {
    await published('evidence-host');
    const sameDomainOtherHost = { sourceUrl: 'https://example.com/anything' };
    const { res, body } = await h.write('POST', '/api/manage/offers/evidence-host/verify', {
      token: h.tokens.inspector,
      body: sameDomainOtherHost,
    });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('evidence_mismatch');
  });

  it('checks scope before reading the offer or the body', async () => {
    const { res } = await h.write('POST', '/api/manage/offers/does-not-exist/publish', {
      token: h.tokens.inspector,
    });
    expect(res.status).toBe(403);
  });

  it('caps how many offers an inspector can expire per hour', async () => {
    await published('expire-capped');
    const seconds = Math.floor(NOW.getTime() / 1000);
    const windowStart = seconds - (seconds % INSPECTOR_EXPIRE_LIMIT.windowSeconds);
    await h.db
      .prepare('INSERT INTO rate_limits (actor, window_start, count) VALUES (?, ?, ?)')
      .bind('inspector-1:expire', windowStart, INSPECTOR_EXPIRE_LIMIT.max)
      .run();
    const { res } = await h.write('POST', '/api/manage/offers/expire-capped/expire', {
      token: h.tokens.inspector,
      body: evidence,
    });
    expect(res.status).toBe(429);
    expect(await h.call('GET', '/api/offers/expire-capped').then((r) => r.status)).toBe(200);
  });

  it('caps the review queue an inspector can fill', async () => {
    await h.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO offers (id, provider_id, pool, rarity, title, summary, benefit, official_url,
           source_url, status, created_by, created_at, updated_at)
         SELECT 'queued-' || i, 'example', 'ai', 'A', 't', 's', 'b', 'https://example.com/',
           'https://example.com/', 'pending_review', 'inspector-1', ?, ? FROM n`,
      )
      .bind(INSPECTOR_PENDING_CAP, NOW.toISOString(), NOW.toISOString())
      .run();
    const { res, body } = await h.write('POST', '/api/manage/offers', {
      token: h.tokens.inspector,
      body: offerInput('one-too-many'),
    });
    expect(res.status).toBe(429);
    expect(body.error?.code).toBe('review_queue_full');
    expect(
      (await h.write('POST', '/api/manage/offers', { body: offerInput('admin-unaffected') })).res
        .status,
    ).toBe(201);
  });
});

describe('provider domains', () => {
  it.each(['github.io', 'pages.dev', 'co.uk', 'vercel.app'])('rejects shared suffix %s', (d) => {
    const input = { id: 'shared', name: 'Shared', officialDomains: [d] };
    expect(providerSchema.safeParse(input).success).toBe(false);
  });

  it('accepts an exact host beneath a shared suffix', () => {
    const input = { id: 'vendor', name: 'Vendor', officialDomains: ['vendor.github.io'] };
    expect(providerSchema.safeParse(input).success).toBe(true);
  });
});

describe('transport hardening', () => {
  const streamOf = (bytes: number) =>
    new ReadableStream({
      start(controller) {
        for (let sent = 0; sent < bytes; sent += 4096) controller.enqueue(new Uint8Array(4096));
        controller.close();
      },
    });

  it('cuts off a body without Content-Length once it passes the cap', async () => {
    const request = new Request('https://x.test/', {
      method: 'POST',
      body: streamOf(64 * 1024),
      headers: { 'content-type': 'application/json' },
      duplex: 'half',
    } as RequestInit);
    const result = await readJsonBody(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('rejects a non-numeric Content-Length', async () => {
    const request = new Request('https://x.test/', { method: 'POST', body: '{}' });
    const forged = new Request(request, { headers: { 'content-length': 'abc' } });
    const result = await readJsonBody(forged);
    expect(result.ok).toBe(false);
  });

  it('answers 405 for methods that exist only on Object.prototype', async () => {
    const res = await h.call('constructor', '/api/manage/offers');
    expect(res.status).toBe(405);
  });

  it('caps list offsets', async () => {
    expect((await h.read('/api/manage/offers?offset=99999999999999999999')).res.status).toBe(400);
    expect(
      (await h.write('POST', '/api/manage/audit/99999999999999999999/revert')).res.status,
    ).toBe(404);
  });
});

describe('idempotency expiry', () => {
  it('treats keys older than 24 hours as new', async () => {
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    await h.db
      .prepare(
        `INSERT INTO idempotency_keys (actor, key, request_hash, response_status, response_body, created_at)
         VALUES ('admin-1', 'stale-key', 'other-hash', 201, '{}', ?)`,
      )
      .bind(old)
      .run();
    const { res } = await h.write('POST', '/api/manage/offers', {
      body: offerInput('after-expiry'),
      key: 'stale-key',
    });
    expect(res.status).toBe(201);
  });
});
