import { utcDay } from './domain/visibility';
import { fail, methodNotAllowed, notFound } from './http/respond';
import { routeManage } from './routes/manage';
import { getOffer, listOffers } from './routes/read';
import { DEFAULT_RATE_LIMIT, type RateLimit } from './write/rate-limit';

export interface AppOptions {
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Per-caller write limit for the management API. */
  rateLimit?: RateLimit;
}

const READ_METHODS = ['GET', 'HEAD'] as const;
const OFFER_DETAIL = /^\/api\/offers\/([^/]+)$/;

async function routePublic(request: Request, env: Env, url: URL, today: string): Promise<Response> {
  const isRead = (READ_METHODS as readonly string[]).includes(request.method);

  if (url.pathname === '/api/offers') {
    return isRead ? listOffers(env.DB, url, today) : methodNotAllowed(READ_METHODS);
  }
  const detail = OFFER_DETAIL.exec(url.pathname);
  if (detail?.[1]) {
    if (!isRead) return methodNotAllowed(READ_METHODS);
    let id: string;
    try {
      id = decodeURIComponent(detail[1]);
    } catch {
      return notFound();
    }
    return getOffer(env.DB, id, today);
  }
  return notFound();
}

export function createHandler({
  now = () => new Date(),
  rateLimit = DEFAULT_RATE_LIMIT,
}: AppOptions = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const at = now();
      try {
        if (url.pathname === '/api/manage' || url.pathname.startsWith('/api/manage/')) {
          return await routeManage(request, env, url, at, rateLimit);
        }
        return await routePublic(request, env, url, utcDay(at));
      } catch (error: unknown) {
        // Log full detail server-side; callers get a generic message.
        console.error('api_error', {
          method: request.method,
          path: url.pathname,
          error: error instanceof Error ? error.stack : String(error),
        });
        return fail(500, 'internal_error', 'Internal server error');
      }
    },
  } satisfies ExportedHandler<Env>;
}
