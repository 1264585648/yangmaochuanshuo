import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from '../../src/api/client.js';
import { createEngagementClient, normalizeCommunity } from '../../src/api/engagement-client.js';
import { jsonResponse } from '../fixtures/offers.js';

const community = {
  title: '内测群',
  description: '说明',
  link: 'https://qm.qq.com/q/abc',
  linkLabel: 'QQ 群',
  qr: { src: '/api/community/qr?v=abc123', expiresAt: '2026-11-18T00:00:00Z' },
};

describe('normalizeCommunity', () => {
  it('keeps a well-formed group', () => {
    expect(normalizeCommunity(community)).toEqual(community);
  });

  it('drops unsafe links and foreign image sources', () => {
    const result = normalizeCommunity({
      ...community,
      link: 'javascript:alert(1)',
      qr: { src: 'https://evil.example/qr.png', expiresAt: null },
    });
    expect(result).toBeNull();
    expect(normalizeCommunity({ ...community, link: 'http://insecure.example' })?.link).toBeNull();
  });

  it('returns null for "no group" and malformed replies', () => {
    for (const raw of [null, [], {}, { ...community, title: ' ' }, { ...community, title: 1 }]) {
      expect(normalizeCommunity(raw)).toBeNull();
    }
  });
});

function setup(handler) {
  const fetchImpl = vi.fn(handler);
  const api = createApiClient({ timeoutMs: 1000, fetchImpl });
  return { fetchImpl, client: createEngagementClient({ request: api.request, fetchImpl }) };
}

describe('createEngagementClient', () => {
  it('reports clicks with keepalive and swallows failures', async () => {
    const { fetchImpl, client } = setup(async () => {
      throw new TypeError('offline');
    });
    await expect(client.trackOfficialClick('a b')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/offers/a%20b/click');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('sends feedback as JSON and returns the id', async () => {
    const { fetchImpl, client } = setup(async () =>
      jsonResponse({ success: true, data: { id: 7 }, error: null }, 201),
    );
    const payload = { kind: 'general', category: 'bug', message: 'hi', contact: '' };
    await expect(client.sendFeedback(payload)).resolves.toEqual({ id: 7 });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('rejects a malformed feedback reply and surfaces server errors', async () => {
    const bad = setup(async () => jsonResponse({ success: true, data: {}, error: null }));
    await expect(bad.client.sendFeedback({})).rejects.toMatchObject({ kind: 'invalid' });
    const limited = setup(async () =>
      jsonResponse({ success: false, data: null, error: { code: 'rate_limited' } }, 429),
    );
    await expect(limited.client.sendFeedback({})).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('loads the community group', async () => {
    const { client } = setup(async () =>
      jsonResponse({ success: true, data: community, error: null }),
    );
    await expect(client.getCommunity()).resolves.toEqual(community);
  });
});
