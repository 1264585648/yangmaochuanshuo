import { authenticate } from '../../auth/tokens';
import { readJsonBody } from '../../http/body';
import { fail, methodNotAllowed, notFound, ok } from '../../http/respond';
import { commit } from '../../write/commit';
import { checkIdempotency, requestHash, validateKey } from '../../write/idempotency';
import { consumeRateLimit, type RateLimit } from '../../write/rate-limit';
import { listAuditEntries, revertAuditEntry } from './audit';
import { applyChange, listChangeRequests, proposeChange, rejectChange } from './changes';
import {
  createOffer,
  editOffer,
  getManagedOffer,
  listManagedOffers,
  transitionOffer,
} from './offers';
import { createProvider, listProvidersHandler, updateProvider } from './providers';
import {
  clickStatsHandler,
  getCommunityHandler,
  listFeedbackHandler,
  putCommunityHandler,
  transitionFeedback,
} from './engagement';
import { COMMUNITY_BODY_MAX_BYTES } from '../../config';
import type { Handler } from './shared';

interface Route {
  pattern: RegExp;
  methods: Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT', Handler>>;
  /** Request body cap when it differs from the default. */
  maxBodyBytes?: number;
}

const P = '^/api/manage';

const whoami: Handler = async ({ client }) => ok({ id: client.id, scope: client.scope });

/** Order matters: `/offers/:id/changes` must match before `/offers/:id/:action`. */
const ROUTES: readonly Route[] = [
  { pattern: new RegExp(`${P}/me$`), methods: { GET: whoami } },
  { pattern: new RegExp(`${P}/offers$`), methods: { GET: listManagedOffers, POST: createOffer } },
  {
    pattern: new RegExp(`${P}/offers/([^/]+)$`),
    methods: { GET: getManagedOffer, PATCH: editOffer },
  },
  { pattern: new RegExp(`${P}/offers/([^/]+)/changes$`), methods: { POST: proposeChange } },
  { pattern: new RegExp(`${P}/offers/([^/]+)/([a-z]+)$`), methods: { POST: transitionOffer } },
  { pattern: new RegExp(`${P}/changes$`), methods: { GET: listChangeRequests } },
  { pattern: new RegExp(`${P}/changes/([^/]+)/apply$`), methods: { POST: applyChange } },
  { pattern: new RegExp(`${P}/changes/([^/]+)/reject$`), methods: { POST: rejectChange } },
  {
    pattern: new RegExp(`${P}/providers$`),
    methods: { GET: listProvidersHandler, POST: createProvider },
  },
  { pattern: new RegExp(`${P}/providers/([^/]+)$`), methods: { PATCH: updateProvider } },
  { pattern: new RegExp(`${P}/audit$`), methods: { GET: listAuditEntries } },
  { pattern: new RegExp(`${P}/audit/(\\d+)/revert$`), methods: { POST: revertAuditEntry } },
  { pattern: new RegExp(`${P}/feedback$`), methods: { GET: listFeedbackHandler } },
  {
    pattern: new RegExp(`${P}/feedback/(\\d+)/([a-z]+)$`),
    methods: { POST: transitionFeedback },
  },
  { pattern: new RegExp(`${P}/stats/clicks$`), methods: { GET: clickStatsHandler } },
  {
    pattern: new RegExp(`${P}/community$`),
    methods: { GET: getCommunityHandler, PUT: putCommunityHandler },
    maxBodyBytes: COMMUNITY_BODY_MAX_BYTES,
  },
];

function decodeParams(match: RegExpExecArray): string[] | null {
  try {
    return match.slice(1).map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
}

const unauthorized = () =>
  fail(401, 'unauthorized', 'A valid API token is required', {
    headers: { 'www-authenticate': 'Bearer' },
  });

export async function routeManage(
  request: Request,
  env: Env,
  url: URL,
  now: Date,
  rateLimit: RateLimit,
): Promise<Response> {
  const db = env.DB;
  const client = await authenticate(db, request);
  if (!client) return unauthorized();

  let match: RegExpExecArray | null = null;
  const route = ROUTES.find((r) => (match = r.pattern.exec(url.pathname)) !== null);
  if (!route || !match) return notFound();
  const method = request.method as keyof Route['methods'];
  // Own-property check: methods like "constructor" must not resolve via the prototype.
  const handler = Object.hasOwn(route.methods, method) ? route.methods[method] : undefined;
  if (!handler) return methodNotAllowed(Object.keys(route.methods));
  const params = decodeParams(match);
  if (!params) return notFound();

  if (method === 'GET') {
    const result = await handler({ db, client, now, body: {}, url }, params);
    if (result instanceof Response) return result;
    throw new Error(`GET handler for ${url.pathname} returned a write plan`);
  }

  const limited = await consumeRateLimit(db, client.id, now, rateLimit);
  if (!limited.ok) {
    return fail(429, 'rate_limited', 'Too many write requests; slow down', {
      headers: { 'retry-after': String(limited.retryAfter) },
    });
  }
  const key = validateKey(request.headers.get('idempotency-key'));
  if (!key.ok) return key.response;
  const body = await readJsonBody(request, route.maxBodyBytes);
  if (!body.ok) return body.response;

  const idempotency = { key: key.key, hash: await requestHash(method, url.pathname, body.raw) };
  const replay = await checkIdempotency(db, client.id, idempotency, now);
  if (replay) return replay;

  const result = await handler({ db, client, now, body: body.value, url }, params);
  if (result instanceof Response) return result;
  return commit({ db, client, now, idempotency }, result);
}
