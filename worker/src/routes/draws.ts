/* `POST /api/draws`: the server-side draw. Random pick, quota check and record
 * happen on the server; the browser only shows the result. */
import { z } from 'zod';
import { drawFromPool } from '../../../src/domain/catalog.js';
import { createSession, resolveSession, type User } from '../auth/session';
import { DAILY_DRAWS } from '../config';
import { POOLS } from '../domain/schema';
import { utcDay } from '../domain/visibility';
import { readJsonBody } from '../http/body';
import { fail, methodNotAllowed, ok } from '../http/respond';
import { getOfferById, listDrawCandidates } from '../repo/offers';
import { nextReset, quotaDay } from '../users/day';
import { insertDraw, readDrawState, type DrawState, type DrawView } from '../users/draws';
import { clientIp, ipHashSecret, ipKey, rateLimitSubject } from '../users/ip';
import { validateKey } from '../write/idempotency';
import { consumeRateLimit, type RateLimit } from '../write/rate-limit';
import { invalid } from './manage/shared';

type DB = Env['DB'];

export interface UserLimits {
  guestsPerIp: RateLimit;
  drawsPerIp: RateLimit;
}

export interface DrawContext {
  db: DB;
  env: Env;
  now: Date;
  random: () => number;
  limits: UserLimits;
}

const MAX_DRAW_BODY_BYTES = 1024;

const drawBody = z.strictObject({ pool: z.enum(POOLS) });

const quotaView = (now: Date, used: number) => ({
  max: DAILY_DRAWS,
  used,
  day: quotaDay(now),
  resetsAt: nextReset(now).toISOString(),
});

const rateLimited = (retryAfter: number) =>
  fail(429, 'rate_limited', 'Too many draws from this network, try again later', {
    headers: { 'retry-after': String(retryAfter) },
  });

function quotaExhausted(now: Date): Response {
  const seconds = Math.max(1, Math.ceil((nextReset(now).getTime() - now.getTime()) / 1000));
  return fail(429, 'quota_exhausted', 'No free draws left today', {
    details: quotaView(now, DAILY_DRAWS),
    headers: { 'retry-after': String(seconds) },
  });
}

async function drawResponse(
  db: DB,
  draw: DrawView,
  state: DrawState,
  now: Date,
  { status, cookie }: { status: number; cookie: string | null },
): Promise<Response> {
  const offer = await getOfferById(db, draw.offerId);
  const { offerId: _offerId, ...publicDraw } = draw;
  const response = ok({ draw: publicDraw, offer, quota: quotaView(now, state.used) }, { status });
  if (status === 200) response.headers.set('idempotent-replayed', 'true');
  if (cookie) response.headers.append('set-cookie', cookie);
  return response;
}

/** The caller's user, creating a guest (subject to the per-IP limit) when there is none. */
async function ensureUser(
  ctx: DrawContext,
  existing: User | null,
  ipActor: string,
): Promise<{ user: User; cookie: string | null } | Response> {
  if (existing) return { user: existing, cookie: null };
  const limited = await consumeRateLimit(
    ctx.db,
    `guest-ip:${ipActor}`,
    ctx.now,
    ctx.limits.guestsPerIp,
  );
  if (!limited.ok) return rateLimited(limited.retryAfter);
  const created = await createSession(ctx.db, ctx.now);
  return { user: created.user, cookie: created.cookie };
}

/** A stored draw under this key: replay it if the request matches, otherwise refuse. */
function replayOrConflict(ctx: DrawContext, state: DrawState, pool: string, cookie: string | null) {
  if (!state.draw) return null;
  if (state.draw.pool !== pool) {
    return fail(422, 'idempotency_key_reused', 'Idempotency-Key was used for a different draw');
  }
  return drawResponse(ctx.db, state.draw, state, ctx.now, { status: 200, cookie });
}

async function performDraw(
  ctx: DrawContext,
  request: Request,
  key: string,
  pool: string,
): Promise<Response> {
  const secret = ipHashSecret(ctx.env);
  if (!secret) {
    console.error('config_error', { missing: 'IP_HASH_SECRET' });
    return fail(503, 'unavailable', 'Draws are temporarily unavailable');
  }
  const day = quotaDay(ctx.now);
  const session = await resolveSession(ctx.db, request, ctx.now);
  const renewCookie = session?.renewCookie ?? null;
  if (session) {
    // Replays and spent quotas are answered before the shared per-IP budget,
    // so one heavy user behind a NAT cannot lock out returning users.
    const state = await readDrawState(ctx.db, session.user.id, key, day);
    const replay = replayOrConflict(ctx, state, pool, renewCookie);
    if (replay) return replay;
    if (state.used >= DAILY_DRAWS) return quotaExhausted(ctx.now);
  }

  const ipActor = await ipKey(rateLimitSubject(clientIp(request)), secret);
  const ipLimit = await consumeRateLimit(
    ctx.db,
    `draw-ip:${ipActor}`,
    ctx.now,
    ctx.limits.drawsPerIp,
  );
  if (!ipLimit.ok) return rateLimited(ipLimit.retryAfter);

  const candidates = await listDrawCandidates(ctx.db, pool, utcDay(ctx.now));
  const picked = drawFromPool(candidates, pool, ctx.random);
  if (!picked) return fail(409, 'pool_empty', 'This pool has no live cards right now');

  const owner = await ensureUser(ctx, session?.user ?? null, ipActor);
  if (owner instanceof Response) return owner;
  const cookie = owner.cookie ?? renewCookie;

  const { inserted, state } = await insertDraw(
    ctx.db,
    {
      userId: owner.user.id,
      offerId: picked.id,
      pool,
      rarity: picked.rarity,
      day,
      key,
      now: ctx.now,
    },
    DAILY_DRAWS,
  );
  if (inserted && state.draw) {
    return drawResponse(ctx.db, state.draw, state, ctx.now, { status: 201, cookie });
  }
  // Nothing inserted: a concurrent request with the same key won, or no quota is left.
  return replayOrConflict(ctx, state, pool, cookie) ?? quotaExhausted(ctx.now);
}

export async function postDraw(request: Request, ctx: DrawContext): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const key = validateKey(request.headers.get('idempotency-key'));
  if (!key.ok) return key.response;
  const body = await readJsonBody(request, MAX_DRAW_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = drawBody.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);
  return performDraw(ctx, request, key.key, parsed.data.pool);
}
