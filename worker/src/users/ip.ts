/* Keyed hashes of client IPs for rate limiting. A plain SHA-256 of an IPv4
 * address is reversible by brute force (2^32 inputs), so it is an HMAC with a
 * Worker secret. Raw addresses are never stored. */

const HASH_HEX_CHARS = 32;
const MIN_SECRET_LENGTH = 32;
const IPV6_GROUPS = 8;
const IPV6_PREFIX_GROUPS = 4;
const IPV6_PRIZE_PREFIX_GROUPS = 3;

/** Null when the secret is missing or too short to resist guessing; callers must fail closed. */
export function ipHashSecret(env: Env): string | null {
  const value = (env as Env & { IP_HASH_SECRET?: unknown }).IP_HASH_SECRET;
  return typeof value === 'string' && value.length >= MIN_SECRET_LENGTH ? value : null;
}

/**
 * What one rate-limit bucket covers. IPv6 hosts usually own a whole /64, so
 * limiting single addresses would let one client rotate through billions.
 */
export function rateLimitSubject(ip: string): string {
  return ipv6Prefix(ip, IPV6_PREFIX_GROUPS);
}

/**
 * Bucket for the limited-prize win cap. A /48 is what a free tunnel broker
 * hands out (65,536 /64s), so a per-/64 cap would be trivially rotated.
 */
export function prizeSubject(ip: string): string {
  return ipv6Prefix(ip, IPV6_PRIZE_PREFIX_GROUPS);
}

function ipv6Prefix(ip: string, keep: number): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const gap = ip.includes('::') ? Math.max(0, IPV6_GROUPS - front.length - back.length) : 0;
  const groups = [...front, ...Array<string>(gap).fill('0'), ...back];
  const prefix = groups.slice(0, keep).map((g) => g.replace(/^0+(?=.)/, '') || '0');
  return `${prefix.join(':')}::/${keep * 16}`;
}

/** Cloudflare sets `CF-Connecting-IP`; without it (local tools) all callers share one bucket. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

export async function ipKey(ip: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(ip)));
  return [...mac]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HASH_HEX_CHARS);
}
