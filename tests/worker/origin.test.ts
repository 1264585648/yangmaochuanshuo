import { describe, it, expect } from 'vitest';
import { checkSameOrigin } from '../../worker/src/http/origin';

const URL_ = 'https://dealdex.test/api/me';
const req = (method: string, headers: Record<string, string> = {}) =>
  new Request(URL_, { method, headers });

describe('checkSameOrigin', () => {
  it('lets safe methods through without an Origin', () => {
    expect(checkSameOrigin(req('GET'), new URL(URL_))).toBeNull();
    expect(checkSameOrigin(req('HEAD'), new URL(URL_))).toBeNull();
  });

  it('accepts a same-origin write', () => {
    expect(
      checkSameOrigin(req('POST', { origin: 'https://dealdex.test' }), new URL(URL_)),
    ).toBeNull();
  });

  it('accepts Sec-Fetch-Site same-origin when Origin is missing', () => {
    expect(
      checkSameOrigin(req('POST', { 'sec-fetch-site': 'same-origin' }), new URL(URL_)),
    ).toBeNull();
  });

  it.each([
    ['cross-site Origin', { origin: 'https://evil.example' }],
    ['null Origin', { origin: 'null' }],
    ['other port', { origin: 'https://dealdex.test:8443' }],
    ['no Origin, cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['no Origin at all', {}],
  ])('rejects %s', async (_label, headers) => {
    const res = checkSameOrigin(req('POST', headers), new URL(URL_));
    expect(res?.status).toBe(403);
    expect(((await res?.json()) as { error: { code: string } }).error.code).toBe(
      'forbidden_origin',
    );
  });
});
