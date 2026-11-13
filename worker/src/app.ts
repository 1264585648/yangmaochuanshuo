import { utcDay } from './domain/visibility';
import { fail, methodNotAllowed, notFound } from './http/respond';
import { withSecurityHeaders } from './http/security';
import { routeManage } from './routes/manage';
import { type UserLimits } from './users/context';
import { isUserPath, routeUser } from './routes/me';
import { cryptoRandom } from '../../src/domain/draw.js';
import { USER_LIMITS } from './config';
import { runCleanup } from './maintenance/cleanup';
import { routeCatalogPage } from './routes/pages';
import { getOffer, listOffers } from './routes/read';
import { robotsTxt, sitemapXml } from './routes/seo';
import { DEFAULT_RATE_LIMIT, type RateLimit } from './write/rate-limit';

export interface AppOptions {
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Per-caller write limit for the management API. */
  rateLimit?: RateLimit;
  /** Injectable random source for draws, uniform in [0, 1). */
  random?: () => number;
  /** Per-IP limits for the draw API. */
  userLimits?: UserLimits;
}

const READ_METHODS = ['GET', 'HEAD'] as const;
const OFFER_DETAIL = /^\/api\/offers\/([^/]+)$/;

/** Paths the Worker renders as HTML/XML; listed in `run_worker_first` in wrangler.jsonc. */
const isCatalogPage = (path: string) => path === '/offers' || path.startsWith('/offers/');

async function routeSite(request: Request, env: Env, url: URL, today: string): Promise<Response> {
  if (isCatalogPage(url.pathname)) return routeCatalogPage(request, env, url, today);
  if (!(READ_METHODS as readonly string[]).includes(request.method)) {
    return methodNotAllowed(READ_METHODS);
  }
  return url.pathname === '/robots.txt' ? robotsTxt(url) : sitemapXml(env.DB, url, today);
}

const SITE_PATHS = new Set(['/robots.txt', '/sitemap.xml']);

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
  random = cryptoRandom,
  userLimits = USER_LIMITS,
}: AppOptions = {}) {
  async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isSite = isCatalogPage(url.pathname) || SITE_PATHS.has(url.pathname);
    if (!isSite && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const at = now();
    try {
      if (isSite) return await routeSite(request, env, url, utcDay(at));
      if (url.pathname === '/api/manage' || url.pathname.startsWith('/api/manage/')) {
        return await routeManage(request, env, url, at, rateLimit);
      }
      if (isUserPath(url.pathname)) {
        return await routeUser(request, url, {
          db: env.DB,
          env,
          now: at,
          random,
          limits: userLimits,
        });
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
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      // Every Worker response, including asset passthroughs, redirects and errors.
      return withSecurityHeaders(await route(request, env));
    },

    /** Daily maintenance (cron in wrangler.jsonc). Failures are logged and rethrown so the run shows as failed. */
    async scheduled(controller: ScheduledController, env: Env): Promise<void> {
      try {
        const report = await runCleanup(env.DB, now());
        console.info('cleanup_done', { cron: controller.cron, ...report });
      } catch (error: unknown) {
        console.error('cleanup_failed', {
          cron: controller.cron,
          error: error instanceof Error ? error.stack : String(error),
        });
        throw error;
      }
    },
  } satisfies ExportedHandler<Env>;
}
