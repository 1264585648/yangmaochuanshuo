import type { Scope } from '../domain/status';

type DB = Env['DB'];

const TOKEN_PREFIX = 'ddx_';
const TOKEN_BYTES = 32;

export interface Client {
  id: string;
  scope: Scope;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** New random API token. Show it once; store only its hash. */
export function generateToken(): string {
  return TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256 hex digest of a token. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseBearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/** Resolve the caller from the Authorization header; null when missing, unknown or revoked. */
export async function authenticate(db: DB, request: Request): Promise<Client | null> {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) return null;
  const row = await db
    .prepare('SELECT id, scope FROM api_clients WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await hashToken(token))
    .first<{ id: string; scope: Scope }>();
  return row ? { id: row.id, scope: row.scope } : null;
}
