/* Public beta endpoints:
 *   POST /api/offers/:id/click   count a visit to the official page (empty body)
 *   POST /api/feedback           report a problem or leave a suggestion
 *   GET  /api/community          the community group, when one is configured
 *   GET  /api/community/qr       its QR image, served same-origin for the CSP
 * Writes are same-origin only and keyed by a hash of the caller's network.
 * None of them creates a user. */
import { FEEDBACK_LIMIT } from '../config';
import { feedbackSchema, insertFeedback } from '../engagement/feedback';
import {
  readCommunity,
  readQrImage,
  qrIsCurrent,
  toPublicCommunity,
} from '../engagement/community';
import { recordClick } from '../engagement/clicks';
import { slugSchema } from '../domain/schema';
import { utcDay } from '../domain/visibility';
import { readJsonBody } from '../http/body';
import { checkSameOrigin } from '../http/origin';
import { fail, methodNotAllowed, notFound, ok, PUBLIC_CACHE } from '../http/respond';
import { quotaDay } from '../users/day';
import { clientIp, ipHashSecret, ipKey, rateLimitSubject } from '../users/ip';
import { rateLimited } from '../users/context';
import { consumeRateLimit } from '../write/rate-limit';
import { invalid } from './manage/shared';

type DB = Env['DB'];

const FEEDBACK_MAX_BODY_BYTES = 4 * 1024;
const QR_CACHE = 'public, max-age=300';
const READ_METHODS = ['GET', 'HEAD'] as const;
const isRead = (method: string) => (READ_METHODS as readonly string[]).includes(method);

export const OFFER_CLICK = /^\/api\/offers\/([^/]+)\/click$/;

export const isEngagementPath = (path: string): boolean =>
  OFFER_CLICK.test(path) || path === '/api/feedback' || path.startsWith('/api/community');

interface EngagementContext {
  db: DB;
  env: Env;
  now: Date;
}

/** Keyed hash of the caller's network, or null when the secret is missing. */
async function visitorKey(env: Env, request: Request): Promise<string | null> {
  const secret = ipHashSecret(env);
  if (!secret) {
    console.error('config_error', { missing: 'IP_HASH_SECRET' });
    return null;
  }
  return ipKey(rateLimitSubject(clientIp(request)), secret);
}

const unavailable = () => fail(503, 'unavailable', 'This feature is temporarily unavailable');

async function postClick(
  request: Request,
  rawId: string,
  { db, env, now }: EngagementContext,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return notFound();
  }
  if (!slugSchema.safeParse(id).success) return notFound();
  const visitor = await visitorKey(env, request);
  if (!visitor) return unavailable();
  const recorded = await recordClick(db, {
    offerId: id,
    day: quotaDay(now),
    visitor,
    today: utcDay(now),
  });
  return ok({ recorded });
}

async function postFeedback(request: Request, { db, env, now }: EngagementContext) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const body = await readJsonBody(request, FEEDBACK_MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = feedbackSchema.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);
  const visitor = await visitorKey(env, request);
  if (!visitor) return unavailable();
  const limited = await consumeRateLimit(db, `feedback-ip:${visitor}`, now, FEEDBACK_LIMIT);
  if (!limited.ok) return rateLimited(limited.retryAfter);
  const saved = await insertFeedback(db, parsed.data, now);
  if (!saved) return fail(422, 'unknown_offer', 'offerId does not exist');
  return ok(saved, { status: 201 });
}

async function getCommunity(request: Request, { db, now }: EngagementContext) {
  if (!isRead(request.method)) return methodNotAllowed(READ_METHODS);
  const community = await readCommunity(db);
  return ok(community ? toPublicCommunity(community, now) : null, { cache: PUBLIC_CACHE });
}

async function getCommunityQr(request: Request, { db, now }: EngagementContext) {
  if (!isRead(request.method)) return methodNotAllowed(READ_METHODS);
  const community = await readCommunity(db);
  if (!community?.enabled || !qrIsCurrent(community, now)) return notFound();
  const image = await readQrImage(db);
  if (!image) return notFound();
  return new Response(request.method === 'HEAD' ? null : image.bytes, {
    headers: {
      'content-type': image.contentType,
      'cache-control': QR_CACHE,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function routeEngagement(
  request: Request,
  url: URL,
  ctx: EngagementContext,
): Promise<Response> {
  const refused = checkSameOrigin(request, url);
  if (refused) return refused;
  const click = OFFER_CLICK.exec(url.pathname);
  if (click?.[1]) return postClick(request, click[1], ctx);
  switch (url.pathname) {
    case '/api/feedback':
      return postFeedback(request, ctx);
    case '/api/community':
      return getCommunity(request, ctx);
    case '/api/community/qr':
      return getCommunityQr(request, ctx);
  }
  return notFound();
}
