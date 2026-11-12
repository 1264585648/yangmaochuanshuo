/* Security headers for every response the Worker returns.
 *
 * Static assets served straight from `dist/` never reach the Worker; they get
 * the same values from `public/_headers` (copied into `dist/` by Vite). A test
 * keeps the two in sync, so change both together.
 *
 * The CSP fits the built app: module scripts and stylesheets from our own
 * origin, SVG data URIs inlined into CSS by Vite, same-origin `/api` fetches
 * and a GET search form. No inline scripts or style attributes exist; styles
 * set through the CSSOM (`el.style.setProperty`) are not affected by CSP.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': CONTENT_SECURITY_POLICY,
});

/**
 * Copy `response` with the security headers set (overriding any existing
 * values). Responses from `Response.redirect` or the assets binding have
 * immutable headers, so a new Response is built instead of mutating.
 */
export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  return secured;
}
