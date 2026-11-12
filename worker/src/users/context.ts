/* Shared per-request context for the user API, and the guest-creation path
 * used by both draws and the legacy import. */
import { createSession, type ResolvedSession, type User } from '../auth/session';
import { fail } from '../http/respond';
import { consumeRateLimit, type RateLimit } from '../write/rate-limit';
import { clientIp, ipHashSecret, ipKey, rateLimitSubject } from './ip';

type DB = Env['DB'];

export interface UserLimits {
  guestsPerIp: RateLimit;
  drawsPerIp: RateLimit;
  writesPerUser: RateLimit;
}

export interface UserContext {
  db: DB;
  env: Env;
  now: Date;
  random: () => number;
  limits: UserLimits;
  /** Resolved once by the router; its renewal cookie is attached there. */
  session: ResolvedSession | null;
}

export const rateLimited = (retryAfter: number): Response =>
  fail(429, 'rate_limited', 'Too many requests from this network, try again later', {
    headers: { 'retry-after': String(retryAfter) },
  });

/** Keyed hash of the caller's network, or a 503 when the secret is not configured. */
export async function ipActor(ctx: UserContext, request: Request): Promise<string | Response> {
  const secret = ipHashSecret(ctx.env);
  if (!secret) {
    console.error('config_error', { missing: 'IP_HASH_SECRET' });
    return fail(503, 'unavailable', 'This feature is temporarily unavailable');
  }
  return ipKey(rateLimitSubject(clientIp(request)), secret);
}

/**
 * The caller's user, creating a guest (subject to the per-IP limit) when there
 * is none. `cookie` is set only for a newly created session.
 */
export async function ensureUser(
  ctx: UserContext,
  actor: string,
): Promise<{ user: User; cookie: string | null } | Response> {
  if (ctx.session) return { user: ctx.session.user, cookie: null };
  const limited = await consumeRateLimit(
    ctx.db,
    `guest-ip:${actor}`,
    ctx.now,
    ctx.limits.guestsPerIp,
  );
  if (!limited.ok) return rateLimited(limited.retryAfter);
  const created = await createSession(ctx.db, ctx.now);
  return { user: created.user, cookie: created.cookie };
}

/** Per-user budget for favorite toggles and imports; null when allowed. */
export async function limitUserWrites(ctx: UserContext, userId: string): Promise<Response | null> {
  const limited = await consumeRateLimit(
    ctx.db,
    `user-write:${userId}`,
    ctx.now,
    ctx.limits.writesPerUser,
  );
  return limited.ok ? null : rateLimited(limited.retryAfter);
}
