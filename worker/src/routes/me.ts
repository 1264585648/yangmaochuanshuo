/* Cookie-authenticated user endpoints: `/api/me*` and `/api/draws`.
 * Writes from other origins are refused before routing. */
import { resolveSession } from '../auth/session';
import { DAILY_DRAWS } from '../config';
import { checkSameOrigin } from '../http/origin';
import { methodNotAllowed, notFound, ok } from '../http/respond';
import { nextReset, quotaDay } from '../users/day';
import { countDrawsOnDay } from '../users/draws';
import { postDraw, type DrawContext } from './draws';

type DB = Env['DB'];

const READ_METHODS = ['GET', 'HEAD'] as const;

/** Identity and quota. Never cached, never creates a user. */
async function getMe(request: Request, db: DB, now: Date): Promise<Response> {
  if (!(READ_METHODS as readonly string[]).includes(request.method)) {
    return methodNotAllowed(READ_METHODS);
  }
  const session = await resolveSession(db, request, now);
  const day = quotaDay(now);
  const used = session ? await countDrawsOnDay(db, session.user.id, day) : 0;
  const response = ok({
    user: session?.user ?? null,
    quota: { max: DAILY_DRAWS, used, day, resetsAt: nextReset(now).toISOString() },
  });
  if (session?.renewCookie) response.headers.append('set-cookie', session.renewCookie);
  return response;
}

export const isUserPath = (path: string): boolean =>
  path === '/api/draws' || path === '/api/me' || path.startsWith('/api/me/');

export async function routeUser(request: Request, url: URL, ctx: DrawContext): Promise<Response> {
  const refused = checkSameOrigin(request, url);
  if (refused) return refused;
  if (url.pathname === '/api/draws') return postDraw(request, ctx);
  if (url.pathname === '/api/me') return getMe(request, ctx.db, ctx.now);
  return notFound();
}
