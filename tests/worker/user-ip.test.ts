import { describe, it, expect } from 'vitest';
import { ipHashSecret, ipKey, prizeSubject, rateLimitSubject } from '../../worker/src/users/ip';

describe('prizeSubject', () => {
  it('keeps IPv4 addresses and widens IPv6 to /48', () => {
    expect(prizeSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(prizeSubject('2001:db8:1:2::abcd')).toBe('2001:db8:1::/48');
    expect(prizeSubject('2001:0db8:0001:ffff::1')).toBe(prizeSubject('2001:db8:1:2::1'));
  });
});

describe('rateLimitSubject', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(rateLimitSubject('203.0.113.7')).toBe('203.0.113.7');
  });

  it.each([
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:DB8:0001:0002:0:0:0:9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('groups IPv6 %s by its /64', (ip, subject) => {
    expect(rateLimitSubject(ip)).toBe(subject);
  });

  it('puts every address of one /64 in the same bucket', () => {
    const a = rateLimitSubject('2001:db8:1:2::abcd');
    const b = rateLimitSubject('2001:db8:1:2:ffff:ffff:ffff:ffff');
    expect(a).toBe(b);
    expect(rateLimitSubject('2001:db8:1:3::abcd')).not.toBe(a);
  });

  it('does not throw on malformed input', () => {
    expect(() => rateLimitSubject('1:2:3:4:5:6:7:8:9::')).not.toThrow();
  });
});

describe('ipHashSecret', () => {
  const env = (value: unknown) => ({ IP_HASH_SECRET: value }) as unknown as Env;

  it('requires at least 32 characters', () => {
    expect(ipHashSecret(env('x'.repeat(31)))).toBeNull();
    expect(ipHashSecret(env('x'.repeat(32)))).toBe('x'.repeat(32));
    expect(ipHashSecret(env(undefined))).toBeNull();
    expect(ipHashSecret(env(42))).toBeNull();
  });
});

describe('ipKey', () => {
  it('is a stable keyed hash that does not contain the address', async () => {
    const secret = 's'.repeat(32);
    const key = await ipKey('203.0.113.7', secret);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await ipKey('203.0.113.7', secret)).toBe(key);
    expect(await ipKey('203.0.113.7', 't'.repeat(32))).not.toBe(key);
  });
});
