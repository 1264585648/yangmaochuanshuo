/* Daily cleanup of rows that only grow: expired rate-limit windows, stale
 * idempotency keys, dead sessions and guests that never drew a card. Each
 * delete is bounded so one run stays well inside D1's query limits; anything
 * left over is picked up the next day. */
import { CLEANUP } from '../config';
import { IDEMPOTENCY_TTL_MS } from '../write/idempotency';

type DB = Env['DB'];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupReport {
  rateLimits: number;
  idempotencyKeys: number;
  sessions: number;
  emptyGuests: number;
}

export interface CleanupOptions {
  batchSize?: number;
}

/** Guests that hold nothing worth keeping. Ordered so both uses pick the same rows. */
const EMPTY_GUESTS = `
  SELECT u.id FROM users u
   WHERE u.kind = 'guest' AND u.imported_at IS NULL AND u.created_at < ?1
     AND NOT EXISTS (SELECT 1 FROM draws d WHERE d.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = u.id)
   ORDER BY u.id LIMIT ?2`;

export async function runCleanup(
  db: DB,
  now: Date,
  { batchSize = CLEANUP.batchSize }: CleanupOptions = {},
): Promise<CleanupReport> {
  const nowIso = now.toISOString();
  const windowCutoff = Math.floor(now.getTime() / 1000) - CLEANUP.rateLimitRetentionSeconds;
  const idemCutoff = new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString();
  const guestCutoff = new Date(now.getTime() - CLEANUP.emptyGuestGraceDays * DAY_MS).toISOString();

  // One batch is one transaction: guest sessions go before their user rows
  // (sessions reference users), and the guest set cannot change in between.
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM rate_limits WHERE rowid IN
           (SELECT rowid FROM rate_limits WHERE window_start < ? LIMIT ?)`,
      )
      .bind(windowCutoff, batchSize),
    db
      .prepare(
        `DELETE FROM idempotency_keys WHERE rowid IN
           (SELECT rowid FROM idempotency_keys WHERE created_at < ? LIMIT ?)`,
      )
      .bind(idemCutoff, batchSize),
    db
      .prepare(
        `DELETE FROM sessions WHERE rowid IN
           (SELECT rowid FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL LIMIT ?)`,
      )
      .bind(nowIso, batchSize),
    db
      .prepare(`DELETE FROM sessions WHERE user_id IN (${EMPTY_GUESTS})`)
      .bind(guestCutoff, batchSize),
    db.prepare(`DELETE FROM users WHERE id IN (${EMPTY_GUESTS})`).bind(guestCutoff, batchSize),
  ]);
  const changed = (i: number) => Number(results[i]?.meta?.changes ?? 0);
  return {
    rateLimits: changed(0),
    idempotencyKeys: changed(1),
    sessions: changed(2),
    emptyGuests: changed(4),
  };
}
