import { fail } from './respond';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-authenticated endpoints, on top of SameSite=Lax.
 * Writes must come from our own origin: a matching `Origin` header, or, when a
 * browser omits it, `Sec-Fetch-Site: same-origin`. Anything else is refused.
 * Returns null when the request may proceed.
 */
export function checkSameOrigin(request: Request, url: URL): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get('origin');
  const allowed =
    origin !== null
      ? origin === url.origin
      : request.headers.get('sec-fetch-site') === 'same-origin';
  return allowed ? null : fail(403, 'forbidden_origin', 'Cross-origin request refused');
}
