import { describe, it, expect, vi } from 'vitest';
import {
  ManageApiError,
  buildManageQuery,
  createManageClient,
} from '../../src/api/manage-client.js';

const jsonResponse = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('buildManageQuery', () => {
  it('omits empty values and serializes non-empty parameters', () => {
    expect(buildManageQuery({ status: '', limit: 20, offset: 0, offerId: undefined })).toBe(
      '?limit=20&offset=0',
    );
    expect(buildManageQuery({})).toBe('');
  });
});

describe('createManageClient', () => {
  it('attaches Bearer token and unique Idempotency-Key for writes', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { id: 'admin-1', scope: 'admin' }, error: null }),
    );
    let seq = 0;
    const client = createManageClient({
      getToken: () => ' ddx_secret ',
      fetchImpl: fetchMock,
      newKey: () => `key-${++seq}`,
    });

    const me = await client.getMe();
    expect(me).toEqual({ id: 'admin-1', scope: 'admin' });
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe('/api/manage/me');
    expect(getInit.headers.authorization).toBe('Bearer ddx_secret');
    expect(getInit.headers['idempotency-key']).toBeUndefined();

    await client.createProvider({ id: 'acme', name: 'Acme', officialDomains: ['acme.example'] });
    const [, postInit] = fetchMock.mock.calls[1];
    expect(postInit.method).toBe('POST');
    expect(postInit.headers['idempotency-key']).toBe('key-1');
    expect(postInit.headers['content-type']).toBe('application/json');
  });

  it('rejects empty tokens before calling fetch', async () => {
    const fetchMock = vi.fn();
    const client = createManageClient({ getToken: () => '   ', fetchImpl: fetchMock });
    await expect(client.getMe()).rejects.toMatchObject({
      name: 'ManageApiError',
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces API error code, details and Retry-After', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'rate_limited',
            message: 'Slow down',
            details: [{ path: 'title', message: 'too long' }],
          },
        },
        { status: 429, headers: { 'retry-after': '12' } },
      ),
    );
    const client = createManageClient({ getToken: () => 'ddx_tok', fetchImpl: fetchMock });
    await expect(client.createOffer({})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfter: 12,
      details: [{ path: 'title', message: 'too long' }],
    });
  });

  it('handles network, timeout and invalid JSON errors', async () => {
    const timeoutErr = new Error('timed out');
    timeoutErr.name = 'TimeoutError';
    const netClient = createManageClient({
      getToken: () => 'ddx_tok',
      fetchImpl: vi.fn().mockRejectedValueOnce(timeoutErr).mockRejectedValueOnce(new Error('down')),
    });
    await expect(netClient.getMe()).rejects.toMatchObject({ code: 'timeout' });
    await expect(netClient.getMe()).rejects.toMatchObject({ code: 'network' });

    const badJsonClient = createManageClient({
      getToken: () => 'ddx_tok',
      fetchImpl: vi.fn(async () => new Response('not-json', { status: 502 })),
    });
    await expect(badJsonClient.getMe()).rejects.toBeInstanceOf(ManageApiError);
  });

  it('calls all management endpoints with encoded ids', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [],
        error: null,
        meta: { total: 0, limit: 20, offset: 0 },
      }),
    );
    const client = createManageClient({
      getToken: () => 'ddx_tok',
      fetchImpl: fetchMock,
      newKey: () => 'k',
    });

    await client.listProviders();
    await client.updateProvider('a/b', { name: 'A' });
    await client.listOffers({ status: 'draft', limit: 20, offset: 0 });
    await client.getOffer('o-1');
    await client.editOffer('o-1', { baseVersion: 1, changes: { title: 'New' } });
    await client.transitionOffer('o-1', 'publish', { verified: true });
    await client.proposeChange('o-1', { baseVersion: 1, changes: {}, sourceUrl: 'https://x.com' });
    await client.listChanges({ status: 'pending' });
    await client.applyChange('c-1');
    await client.rejectChange('c-1');
    await client.listAudit({ entityType: 'offer' });
    await client.revertAudit(42);

    const paths = fetchMock.mock.calls.map(([u]) => u);
    expect(paths).toEqual([
      '/api/manage/providers',
      '/api/manage/providers/a%2Fb',
      '/api/manage/offers?status=draft&limit=20&offset=0',
      '/api/manage/offers/o-1',
      '/api/manage/offers/o-1',
      '/api/manage/offers/o-1/publish',
      '/api/manage/offers/o-1/changes',
      '/api/manage/changes?status=pending',
      '/api/manage/changes/c-1/apply',
      '/api/manage/changes/c-1/reject',
      '/api/manage/audit?entityType=offer',
      '/api/manage/audit/42/revert',
    ]);
  });
});

describe('prize endpoints', () => {
  it('maps each prize call to its method and path', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { ok: 1 }, error: null }),
    );
    const client = createManageClient({ getToken: () => 't', fetchImpl: fetchMock });
    await client.listPrizes();
    await client.createPrize({ id: 'g-1' });
    await client.editPrize('g 1', { title: 'x' });
    await client.addPrizeCodes('g-1', ['A']);
    await client.listPrizeWinners('g-1');
    await client.transitionPrize('g-1', 'activate');
    const calls = fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`);
    expect(calls).toEqual([
      'GET /api/manage/prizes',
      'POST /api/manage/prizes',
      'PATCH /api/manage/prizes/g%201',
      'POST /api/manage/prizes/g-1/codes',
      'GET /api/manage/prizes/g-1/winners',
      'POST /api/manage/prizes/g-1/activate',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ codes: ['A'] });
  });
});
