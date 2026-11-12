import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHandler } from '../../worker/src/app';
import { ADMIN_PAGE_HEADERS, SECURITY_HEADERS } from '../../worker/src/http/security';
import { createHarness, PROVIDER, type Harness } from './helpers/api';

const EXPECTED = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; " +
    "connect-src 'self' https://cloudflareinsights.com; font-src 'self'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; object-src 'none'",
};

function expectSecure(res: Response) {
  for (const [name, value] of Object.entries(EXPECTED)) {
    expect(res.headers.get(name), `${name} on ${res.status}`).toBe(value);
  }
}

/** Parse `public/_headers` into path rules: headers set, and headers detached with `! Name`. */
async function readHeaderRules() {
  const file = await readFile(resolve(process.cwd(), 'public/_headers'), 'utf8');
  const rules = new Map<string, { set: Map<string, string>; detach: string[] }>();
  let current: { set: Map<string, string>; detach: string[] } | undefined;
  for (const line of file.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { set: new Map(), detach: [] };
      rules.set(line.trim(), current);
      continue;
    }
    const entry = line.trim();
    if (entry.startsWith('! ')) {
      current?.detach.push(entry.slice(2).trim().toLowerCase());
      continue;
    }
    const i = entry.indexOf(':');
    current?.set.set(entry.slice(0, i).trim().toLowerCase(), entry.slice(i + 1).trim());
  }
  return rules;
}

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await h.write('POST', '/api/manage/providers', { body: PROVIDER });
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

describe('security headers', () => {
  it('match the documented values', () => {
    expect(SECURITY_HEADERS).toEqual(EXPECTED);
  });

  it('are mirrored in public/_headers for directly served assets', async () => {
    const rules = await readHeaderRules();
    expect(Object.fromEntries(rules.get('/*')?.set ?? [])).toEqual(EXPECTED);
  });

  it('give the admin console a CSP without third-party origins', async () => {
    const csp = ADMIN_PAGE_HEADERS['content-security-policy'];
    expect(csp).not.toMatch(/cloudflareinsights|https:/);
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    const rules = await readHeaderRules();
    for (const path of ['/admin', '/admin.html']) {
      const rule = rules.get(path);
      expect(rule?.detach, path).toEqual(['content-security-policy']);
      expect(Object.fromEntries(rule?.set ?? []), path).toEqual(ADMIN_PAGE_HEADERS);
    }
  });

  it('are sent on public API reads, errors and 405s', async () => {
    expectSecure(await h.call('GET', '/api/offers', { token: null }));
    expectSecure(await h.call('GET', '/api/offers/missing', { token: null }));
    expectSecure(await h.call('DELETE', '/api/offers', { token: null }));
  });

  it('are sent on manage responses, including 401 and idempotent replays', async () => {
    expectSecure(await h.call('GET', '/api/manage/offers', { token: null }));
    expectSecure(await h.call('GET', '/api/manage/offers'));
    const body = { id: 'sec-prov', name: 'Sec', officialDomains: ['sec.example'] };
    const first = await h.call('POST', '/api/manage/providers', { body, key: 'sec-replay' });
    expectSecure(first);
    const replay = await h.call('POST', '/api/manage/providers', { body, key: 'sec-replay' });
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expectSecure(replay);
  });

  it('are sent on pages, redirects, crawler files and asset passthroughs', async () => {
    expectSecure(await h.call('GET', '/offers/', { token: null }));
    expectSecure(await h.call('POST', '/offers', { token: null }));
    expectSecure(await h.call('GET', '/robots.txt', { token: null }));
    expectSecure(await h.call('GET', '/sitemap.xml', { token: null }));
    const asset = await h.call('GET', '/assets/app.js', { token: null });
    expect(await asset.text()).toBe('asset');
    expectSecure(asset);
  });

  it('override weaker values from the assets binding and survive a 500', async () => {
    const app = createHandler();
    const assets = {
      fetch: async () =>
        new Response('missing', { status: 404, headers: { 'x-frame-options': 'SAMEORIGIN' } }),
    };
    const brokenDb = {
      prepare: () => {
        throw new Error('db down');
      },
    };
    const env = { DB: brokenDb, ASSETS: assets } as unknown as Env;
    const miss = await app.fetch(new Request('https://dealdex.test/favicon.ico'), env);
    expect(miss.status).toBe(404);
    expectSecure(miss);
    const crash = await app.fetch(new Request('https://dealdex.test/api/offers'), env);
    expect(crash.status).toBe(500);
    expectSecure(crash);
  });
});

describe('cache-control', () => {
  it('lets public reads be cached and keeps manage responses out of caches', async () => {
    expect((await h.call('GET', '/api/offers', { token: null })).headers.get('cache-control')).toBe(
      'public, max-age=60',
    );
    expect(
      (await h.call('GET', '/api/offers/missing', { token: null })).headers.get('cache-control'),
    ).toBe('no-store');
    for (const res of [
      await h.call('GET', '/api/manage/offers'),
      await h.call('GET', '/api/manage/offers', { token: null }),
      await h.call('POST', '/api/manage/providers', {
        body: { id: 'cache-prov', name: 'C', officialDomains: ['cache.example'] },
      }),
    ]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
});
