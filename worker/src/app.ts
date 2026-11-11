import { utcDay } from './domain/visibility';
import { fail, methodNotAllowed, notFound } from './http/respond';
import { getOffer, listOffers } from './routes/read';

export interface AppOptions {
  /** Injectable clock for tests. */
  now?: () => Date;
}

const READ_METHODS = ['GET', 'HEAD'] as const;
const OFFER_DETAIL = /^\/api\/offers\/([^/]+)$/;

async function routeApi(request: Request, env: Env, url: URL, today: string): Promise<Response> {
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

export function createHandler({ now = () => new Date() }: AppOptions = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      try {
        return await routeApi(request, env, url, utcDay(now()));
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
