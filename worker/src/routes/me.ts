/* Cookie-authenticated user endpoints: `/api/me*` and `/api/draws`.
 * Writes from other origins are refused before routing. The session is
 * resolved once here, and a renewed session cookie is attached to whatever
 * the handler returns, including errors. */
import { resolveSession } from '../auth/session';
import { checkSameOrigin } from '../http/origin';
import { methodNotAllowed, notFound, ok } from '../http/respond';
import type { UserContext } from '../users/context';
import { quotaDay } from '../users/day';
import { countDrawsOnDay } from '../users/draws';
import { getCollection, getHistory, postImport, setFavorite } from './collection';
import { postDraw, quotaView } from './draws';
import { listWonPrizes } from '../prizes/prizes';

const READ_METHODS = ['GET', 'HEAD'] as const;
const FAVORITE_PATH = /^\/api\/me\/favorites\/([^/]+)$/;

/** Identity and quota. Never cached, never creates a user. */
async function getMe(request: Request, ctx: UserContext): Promise<Response> {
  if (!(READ_METHODS as readonly string[]).includes(request.method)) {
    return methodNotAllowed(READ_METHODS);
  }
  const user = ctx.session?.user ?? null;
  const used = user ? await countDrawsOnDay(ctx.db, user.id, quotaDay(ctx.now)) : 0;
  return ok({ user, quota: quotaView(ctx.now, used) });
}

/** Prizes this user won, codes included. Never creates a user. */
async function getMyPrizes(request: Request, ctx: UserContext): Promise<Response> {
  if (!(READ_METHODS as readonly string[]).includes(request.method)) {
    return methodNotAllowed(READ_METHODS);
  }
  const user = ctx.session?.user ?? null;
  return ok({ prizes: user ? await listWonPrizes(ctx.db, user.id) : [] });
}

export const isUserPath = (path: string): boolean =>
  path === '/api/draws' || path === '/api/me' || path.startsWith('/api/me/');

function dispatch(request: Request, url: URL, ctx: UserContext): Promise<Response> | Response {
  switch (url.pathname) {
    case '/api/draws':
      return postDraw(request, ctx);
    case '/api/me':
      return getMe(request, ctx);
    case '/api/me/collection':
      return getCollection(request, ctx);
    case '/api/me/draws':
      return getHistory(request, url, ctx);
    case '/api/me/import':
      return postImport(request, ctx);
    case '/api/me/prizes':
      return getMyPrizes(request, ctx);
  }
  const favorite = FAVORITE_PATH.exec(url.pathname);
  if (favorite?.[1]) return setFavorite(request, favorite[1], ctx);
  return notFound();
}

export async function routeUser(
  request: Request,
  url: URL,
  base: Omit<UserContext, 'session'>,
): Promise<Response> {
  const refused = checkSameOrigin(request, url);
  if (refused) return refused;
  const session = await resolveSession(base.db, request, base.now);
  const response = await dispatch(request, url, { ...base, session });
  if (session?.renewCookie && !response.headers.has('set-cookie')) {
    response.headers.append('set-cookie', session.renewCookie);
  }
  return response;
}
