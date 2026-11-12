import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, createApiClient, describeError, toQueryString } from '../../src/api/client.js';
import { apiOffer, jsonResponse, listEnvelope } from '../fixtures/offers.js';

const client = (fetchImpl, timeoutMs = 1000) => createApiClient({ fetchImpl, timeoutMs });

afterEach(() => {
  vi.useRealTimers();
});

describe('toQueryString', () => {
  it('keeps known keys, drops empty values and unknown keys', () => {
    expect(toQueryString({ pool: 'ai', q: '', limit: 20, evil: 'x', autoRenews: 'false' })).toBe(
      '?pool=ai&autoRenews=false&limit=20',
    );
    expect(toQueryString({})).toBe('');
  });
});

describe('listOffers', () => {
  it('requests the list endpoint and returns validated offers with paging', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        listEnvelope([apiOffer({ id: 'one' }), { bogus: true }], { total: 7, limit: 2, offset: 4 }),
      ),
    );
    const page = await client(fetchImpl).listOffers({ pool: 'ai', limit: 2, offset: 4 });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/offers?pool=ai&limit=2&offset=4',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
    expect(page.offers.map((o) => o.id)).toEqual(['one']);
    expect(page).toMatchObject({ total: 7, limit: 2, offset: 4 });
  });

  it('maps an error envelope to an http ApiError with the server code', async () => {
    const body = { success: false, data: null, error: { code: 'invalid_query', message: 'x' } };
    const error = await client(async () => jsonResponse(body, 400))
      .listOffers()
      .catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 400, code: 'invalid_query' });
  });

  it('treats a non-JSON 502 as an http error and a non-JSON 200 as invalid', async () => {
    const html = (status) => async () => new Response('<html>', { status });
    await expect(client(html(502)).listOffers()).rejects.toMatchObject({ kind: 'http' });
    await expect(client(html(200)).listOffers()).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('rejects envelopes with the wrong shape', async () => {
    const bad = [
      { hello: 'world' },
      { success: true, data: {}, meta: { total: 0, limit: 1, offset: 0 } },
      { success: true, data: [], meta: { total: -1, limit: 1, offset: 0 } },
      { success: true, data: [] },
    ];
    for (const body of bad) {
      await expect(client(async () => jsonResponse(body)).listOffers()).rejects.toMatchObject({
        kind: 'invalid',
      });
    }
  });

  it('reports network failures', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(client(fetchImpl).listOffers()).rejects.toMatchObject({ kind: 'network' });
  });

  it('times out slow requests', async () => {
    vi.useFakeTimers();
    const hang = (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error())),
      );
    const pending = client(hang, 500)
      .listOffers()
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ kind: 'timeout' });
  });

  it('times out a server that sends headers and then stalls the body', async () => {
    vi.useFakeTimers();
    const stalled = (_url, { signal }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      });
    const pending = client(stalled, 500)
      .listOffers()
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ kind: 'timeout' });
  });

  it('reports caller aborts separately, including an already-aborted signal', async () => {
    const hang = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        if (signal.aborted) reject(new Error());
        signal.addEventListener('abort', () => reject(new Error()));
      });
    const controller = new AbortController();
    const pending = client(hang)
      .listOffers({}, { signal: controller.signal })
      .catch((e) => e);
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'aborted' });
    await expect(
      client(hang).listOffers({}, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('uses the global fetch when none is injected', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(listEnvelope([apiOffer({ id: 'g' })])));
    const page = await createApiClient({
      timeoutMs: 1000,
      baseUrl: 'https://api.test',
    }).listOffers();
    expect(spy).toHaveBeenCalledWith('https://api.test/api/offers', expect.anything());
    expect(page.offers).toHaveLength(1);
    spy.mockRestore();
  });
});

describe('listAllOffers', () => {
  it('pages until the total is reached', async () => {
    const all = Array.from({ length: 5 }, (_, i) => apiOffer({ id: `o${i}` }));
    const fetchImpl = vi.fn(async (url) => {
      const params = new URL(url, 'https://x').searchParams;
      const limit = Number(params.get('limit'));
      const offset = Number(params.get('offset'));
      return jsonResponse(
        listEnvelope(all.slice(offset, offset + limit), { total: all.length, limit, offset }),
      );
    });
    const offers = await client(fetchImpl).listAllOffers({ pageSize: 2, maxPages: 10 });
    expect(offers.map((o) => o.id)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps paging past a page whose rows are all invalid', async () => {
    const pages = [[{ bogus: 1 }, { bogus: 2 }], [apiOffer({ id: 'late' })]];
    const fetchImpl = vi.fn(async (url) => {
      const offset = Number(new URL(url, 'https://x').searchParams.get('offset'));
      return jsonResponse(listEnvelope(pages[offset / 2] ?? [], { total: 3, limit: 2, offset }));
    });
    const offers = await client(fetchImpl).listAllOffers({ pageSize: 2, maxPages: 5 });
    expect(offers.map((o) => o.id)).toEqual(['late']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops at maxPages and on an empty page', async () => {
    const endless = vi.fn(async () =>
      jsonResponse(listEnvelope([apiOffer({ id: 'x' })], { total: 999, limit: 1 })),
    );
    await client(endless).listAllOffers({ pageSize: 1, maxPages: 3 });
    expect(endless).toHaveBeenCalledTimes(3);

    const empty = vi.fn(async () => jsonResponse(listEnvelope([], { total: 999 })));
    expect(await client(empty).listAllOffers({ pageSize: 1, maxPages: 3 })).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });
});

describe('describeError', () => {
  it('gives a friendly message per failure kind without leaking details', () => {
    expect(describeError(new ApiError('network', 'raw'))).toContain('网络');
    expect(describeError(new ApiError('timeout', 'raw'))).toContain('超时');
    expect(describeError(new ApiError('http', 'raw', { status: 503 }))).toContain('暂时不可用');
    expect(describeError(new ApiError('http', 'raw', { status: 400 }))).toContain('刷新');
    expect(describeError(new ApiError('invalid', 'raw'))).toContain('格式');
    expect(describeError(new Error('secret stack'))).not.toContain('secret');
  });
});

describe('getOffer', () => {
  it('requests one offer by encoded id and validates it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: apiOffer({ id: 'one' }), error: null }),
    );
    const offer = await client(fetchImpl).getOffer('one');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/offers/one');
    expect(offer.id).toBe('one');
    await client(fetchImpl).getOffer('a/b');
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/offers/a%2Fb');
  });

  it('reports a missing offer as an http 404', async () => {
    const body = { success: false, data: null, error: { code: 'not_found', message: 'x' } };
    const error = await client(async () => jsonResponse(body, 404))
      .getOffer('gone')
      .catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 404, code: 'not_found' });
  });

  it('rejects a malformed offer', async () => {
    const fetchImpl = async () => jsonResponse({ success: true, data: { id: 1 }, error: null });
    await expect(client(fetchImpl).getOffer('x')).rejects.toMatchObject({ kind: 'invalid' });
  });
});
