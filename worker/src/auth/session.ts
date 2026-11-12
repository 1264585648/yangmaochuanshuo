/* Cookie sessions for anonymous (and, later, signed-in) users.
 *
 * The cookie holds a random token; D1 stores only its SHA-256 hash, the same
 * scheme as API tokens. `__Host-` pins the cookie to this exact origin over
 * HTTPS with Path=/. Most browsers accept Secure cookies on http://localhost;
 * confirm in a real browser when the first session is issued (U2).
 */
import { SESSION } from '../config';
import { quotaDay } from '../users/day';
import { hashToken, randomToken } from './tokens';

type DB = Env['DB'];

export const SESSION_COOKIE = '__Host-ddx_sid';

const TOKEN_PREFIX = 'dds_';
/** 32 random bytes in base64url are 43 characters. */
const TOKEN_PATTERN = /^dds_[A-Za-z0-9_-]{43}$/;
const USER_ID_BYTES = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = SESSION.ttlDays * DAY_MS;
const RENEW_AFTER_MS = SESSION.renewAfterDays * DAY_MS;

export type UserKind = 'guest' | 'member';

export interface User {
  id: string;
  kind: UserKind;
  createdAt: string;
}

export interface NewSession {
  user: User;
  token: string;
  /** `Set-Cookie` value to send with the response that created the session. */
  cookie: string;
}

export interface ResolvedSession {
  user: User;
  /** `Set-Cookie` value when the session was just extended, otherwise null. */
  renewCookie: string | null;
}

interface SessionRow {
  user_id: string;
  kind: UserKind;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

function sessionCookie(token: string): string {
  const maxAge = Math.floor(TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** Value of cookie `name` in a `Cookie` header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Create a guest user with a fresh session. */
export async function createSession(db: DB, now: Date): Promise<NewSession> {
  const at = now.toISOString();
  const user: User = { id: randomToken('u_', USER_ID_BYTES), kind: 'guest', createdAt: at };
  const token = randomToken(TOKEN_PREFIX);
  const expires = new Date(now.getTime() + TTL_MS).toISOString();
  await db.batch([
    db
      .prepare('INSERT INTO users (id, kind, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, user.kind, at, at),
    db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .bind(await hashToken(token), user.id, at, expires),
  ]);
  return { user, token, cookie: sessionCookie(token) };
}

/** Bookkeeping writes for an active session; at most one renewal per interval, one touch per day. */
function maintenance(db: DB, hash: string, row: SessionRow, now: Date) {
  const at = now.toISOString();
  const statements = [];
  const renew = now.getTime() - (Date.parse(row.expires_at) - TTL_MS) >= RENEW_AFTER_MS;
  if (renew) {
    // Conditional on the old expiry so concurrent requests extend it once.
    statements.push(
      db
        .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at = ?')
        .bind(new Date(now.getTime() + TTL_MS).toISOString(), hash, row.expires_at),
    );
  }
  if (quotaDay(new Date(row.last_seen_at)) !== quotaDay(now)) {
    statements.push(
      db
        .prepare('UPDATE users SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?')
        .bind(at, row.user_id, at),
    );
  }
  return { renew, statements };
}

/** The user behind the request's session cookie; null when missing, unknown, expired or revoked. */
export async function resolveSession(
  db: DB,
  request: Request,
  now: Date,
): Promise<ResolvedSession | null> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.kind, u.created_at, u.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .bind(hash, now.toISOString())
    .first<SessionRow>();
  if (!row) return null;

  const { renew, statements } = maintenance(db, hash, row, now);
  if (statements.length > 0) await db.batch(statements);
  return {
    user: { id: row.user_id, kind: row.kind, createdAt: row.created_at },
    renewCookie: renew ? sessionCookie(token) : null,
  };
}

/** Revoke one session token. Its user and data are kept. */
export async function revokeSession(db: DB, token: string, now: Date): Promise<void> {
  await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(now.toISOString(), await hashToken(token))
    .run();
}
