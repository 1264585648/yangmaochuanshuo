import { hashToken } from '../auth/tokens';
import { fail, sendJson } from '../http/respond';

type DB = Env['DB'];

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

/** Stored responses are replayable for this long, then purged. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const cutoff = (now: Date) => new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString();

export interface IdempotencyRef {
  key: string;
  hash: string;
}

interface StoredResponse {
  request_hash: string;
  response_status: number;
  response_body: string;
}

export function validateKey(
  header: string | null,
): { ok: true; key: string } | { ok: false; response: Response } {
  if (!header) {
    return {
      ok: false,
      response: fail(400, 'idempotency_key_required', 'Writes require an Idempotency-Key header'),
    };
  }
  if (!KEY_PATTERN.test(header)) {
    return {
      ok: false,
      response: fail(
        400,
        'invalid_idempotency_key',
        'Idempotency-Key must be 1-100 characters of letters, digits, _ . : -',
      ),
    };
  }
  return { ok: true, key: header };
}

/** Fingerprint of the request a key was first used with. */
export function requestHash(method: string, path: string, rawBody: string): Promise<string> {
  return hashToken(`${method}\n${path}\n${rawBody}`);
}

/**
 * Replay a stored response for this caller and key, reject reuse with a
 * different request, or return null when the key is new.
 */
export async function checkIdempotency(
  db: DB,
  actor: string,
  ref: IdempotencyRef,
  now: Date,
): Promise<Response | null> {
  const stored = await db
    .prepare(
      `SELECT request_hash, response_status, response_body FROM idempotency_keys
       WHERE actor = ? AND key = ? AND created_at >= ?`,
    )
    .bind(actor, ref.key, cutoff(now))
    .first<StoredResponse>();
  if (!stored) return null;
  if (stored.request_hash !== ref.hash) {
    return fail(
      422,
      'idempotency_key_reused',
      'This Idempotency-Key was already used with a different request',
    );
  }
  return sendJson(stored.response_status, stored.response_body, {
    'cache-control': 'no-store',
    'idempotent-replayed': 'true',
  });
}

export function recordStatement(
  db: DB,
  actor: string,
  ref: IdempotencyRef,
  status: number,
  body: string,
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO idempotency_keys (actor, key, request_hash, response_status, response_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(actor, ref.key, ref.hash, status, body, at);
}

/** Drop this caller's expired keys; runs inside each write batch. */
export function purgeStatement(db: DB, actor: string, now: Date) {
  return db
    .prepare('DELETE FROM idempotency_keys WHERE actor = ? AND created_at < ?')
    .bind(actor, cutoff(now));
}
