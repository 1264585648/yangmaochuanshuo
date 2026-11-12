/* `/api/me`: the caller's identity and quota. Never cached, never creates a user. */
import { resolveSession } from '../auth/session';
import { DAILY_DRAWS } from '../config';
import { checkSameOrigin } from '../http/origin';
import { methodNotAllowed, notFound, ok } from '../http/respond';
import { nextReset, quotaDay } from '../users/day';

type DB = Env['DB'];

const READ_METHODS = ['GET', 'HEAD'] as const;

async function getMe(request: Request, db: DB, now: Date): Promise<Response> {
  if (!(READ_METHODS as readonly string[]).includes(request.method)) {
    return methodNotAllowed(READ_METHODS);
  }
  const session = await resolveSession(db, request, now);
  const response = ok({
    user: session?.user ?? null,
    quota: { max: DAILY_DRAWS, day: quotaDay(now), resetsAt: nextReset(now).toISOString() },
  });
  if (session?.renewCookie) response.headers.append('set-cookie', session.renewCookie);
  return response;
}

/** Cookie-authenticated user endpoints. Writes from other origins are refused before routing. */
export const isUserPath = (path: string): boolean =>
  path === '/api/me' || path.startsWith('/api/me/');

export async function routeUser(request: Request, db: DB, url: URL, now: Date): Promise<Response> {
  const refused = checkSameOrigin(request, url);
  if (refused) return refused;
  if (url.pathname === '/api/me') return getMe(request, db, now);
  return notFound();
}
