export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

export const PUBLIC_CACHE = 'public, max-age=60';
export const NO_STORE = 'no-store';

/** Send an already-serialised JSON body (used for idempotent replays). */
export function sendJson(status: number, body: string, headers: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

function send(status: number, body: unknown, headers: Record<string, string>): Response {
  return sendJson(status, JSON.stringify(body), headers);
}

/** Success envelope: `{ success, data, error: null, meta? }`. */
export function ok(
  data: unknown,
  {
    status = 200,
    meta,
    cache = NO_STORE,
  }: { status?: number; meta?: PageMeta; cache?: string } = {},
): Response {
  const body = meta
    ? { success: true, data, error: null, meta }
    : { success: true, data, error: null };
  return send(status, body, { 'cache-control': cache });
}

/** Error envelope: `{ success: false, data: null, error }`. Messages are safe to show to callers. */
export function fail(
  status: number,
  code: string,
  message: string,
  { details, headers = {} }: { details?: unknown; headers?: Record<string, string> } = {},
): Response {
  const error: ApiError = details === undefined ? { code, message } : { code, message, details };
  return send(
    status,
    { success: false, data: null, error },
    { 'cache-control': NO_STORE, ...headers },
  );
}

export const notFound = () => fail(404, 'not_found', 'Resource not found');

export const methodNotAllowed = (allow: readonly string[]) =>
  fail(405, 'method_not_allowed', 'Method not allowed', { headers: { allow: allow.join(', ') } });
