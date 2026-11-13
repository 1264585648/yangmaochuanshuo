/* `POST /api/draws`: the server-side draw. Random pick, quota check and record
 * happen on the server; the browser only shows the result. */
import { z } from 'zod';
import { drawFromPool } from '../../../src/domain/catalog.js';
import { DAILY_DRAWS } from '../config';
import { POOLS } from '../domain/schema';
import { utcDay } from '../domain/visibility';
import { readJsonBody } from '../http/body';
import { fail, methodNotAllowed, ok } from '../http/respond';
import { getOwnedOffer, listDrawCandidates } from '../repo/offers';
import { listRollablePrizes, rollPrize } from '../prizes/prizes';
import { ensureUser, ipActor, prizeActor, rateLimited, type UserContext } from '../users/context';
import { nextReset, quotaDay } from '../users/day';
import { insertDraw, readDrawState, type DrawState, type DrawView } from '../users/draws';
import { validateKey } from '../write/idempotency';
import { consumeRateLimit } from '../write/rate-limit';
import { invalid } from './manage/shared';

const MAX_DRAW_BODY_BYTES = 1024;

const drawBody = z.strictObject({ pool: z.enum(POOLS) });

export const quotaView = (now: Date, used: number) => ({
  max: DAILY_DRAWS,
  used,
  day: quotaDay(now),
  resetsAt: nextReset(now).toISOString(),
});

function quotaExhausted(now: Date): Response {
  const seconds = Math.max(1, Math.ceil((nextReset(now).getTime() - now.getTime()) / 1000));
  return fail(429, 'quota_exhausted', 'No free draws left today', {
    details: quotaView(now, DAILY_DRAWS),
    headers: { 'retry-after': String(seconds) },
  });
}

async function drawResponse(
  ctx: UserContext,
  draw: DrawView,
  state: DrawState,
  { status, cookie }: { status: number; cookie: string | null },
): Promise<Response> {
  const offer = await getOwnedOffer(ctx.db, draw.offerId, utcDay(ctx.now));
  const { offerId: _offerId, prize, ...publicDraw } = draw;
  const response = ok(
    { draw: publicDraw, offer, quota: quotaView(ctx.now, state.used), prize },
    { status },
  );
  if (status === 200) response.headers.set('idempotent-replayed', 'true');
  if (cookie) response.headers.append('set-cookie', cookie);
  return response;
}

/** A stored draw under this key: replay it if the request matches, otherwise refuse. */
function replayOrConflict(
  ctx: UserContext,
  state: DrawState,
  pool: string,
  cookie: string | null,
): Promise<Response> | Response | null {
  if (!state.draw) return null;
  if (state.draw.pool !== pool) {
    return fail(422, 'idempotency_key_reused', 'Idempotency-Key was used for a different draw');
  }
  return drawResponse(ctx, state.draw, state, { status: 200, cookie });
}

async function performDraw(
  ctx: UserContext,
  request: Request,
  key: string,
  pool: string,
): Promise<Response> {
  const actor = await ipActor(ctx, request);
  if (actor instanceof Response) return actor;
  const day = quotaDay(ctx.now);
  if (ctx.session) {
    // Replays and spent quotas are answered before the shared per-IP budget,
    // so one heavy user behind a NAT cannot lock out returning users.
    const state = await readDrawState(ctx.db, ctx.session.user.id, key, day);
    const replay = replayOrConflict(ctx, state, pool, null);
    if (replay) return replay;
    if (state.used >= DAILY_DRAWS) return quotaExhausted(ctx.now);
  }

  const ipLimit = await consumeRateLimit(
    ctx.db,
    `draw-ip:${actor}`,
    ctx.now,
    ctx.limits.drawsPerIp,
  );
  if (!ipLimit.ok) return rateLimited(ipLimit.retryAfter);

  const candidates = await listDrawCandidates(ctx.db, pool, utcDay(ctx.now));
  const picked = drawFromPool(candidates, pool, ctx.random);
  if (!picked) return fail(409, 'pool_empty', 'This pool has no live cards right now');
  // Rolled only when a prize is live, so draws without prizes use the same randomness as before.
  const prizes = await listRollablePrizes(ctx.db, ctx.now);
  const prizeId = rollPrize(prizes, ctx.random);

  const owner = await ensureUser(ctx, actor);
  if (owner instanceof Response) return owner;

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
      prize: prizeId ? { id: prizeId, visitor: await prizeActor(ctx, request) } : null,
    },
    DAILY_DRAWS,
  );
  if (inserted && state.draw) {
    return drawResponse(ctx, state.draw, state, { status: 201, cookie: owner.cookie });
  }
  // Nothing inserted: a concurrent request with the same key won, or no quota is left.
  return (await replayOrConflict(ctx, state, pool, owner.cookie)) ?? quotaExhausted(ctx.now);
}

export async function postDraw(request: Request, ctx: UserContext): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const key = validateKey(request.headers.get('idempotency-key'));
  if (!key.ok) return key.response;
  const body = await readJsonBody(request, MAX_DRAW_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = drawBody.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);
  return performDraw(ctx, request, key.key, parsed.data.pool);
}
