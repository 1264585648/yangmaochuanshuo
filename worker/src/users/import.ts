/* One-time import of the legacy browser collection and favorites.
 * The browser data is untrusted: only ids of cards that are public today are
 * kept, pool and rarity come from the catalog, timestamps are clamped, and
 * imported rows never count toward the daily quota. */
import { PUBLIC_WHERE } from '../repo/offers';
import { utcDay } from '../domain/visibility';
import { quotaDay } from './day';

type DB = Env['DB'];

/** Longest look-back accepted for legacy timestamps. */
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Idempotency keys of import rows. `#` is not allowed in client keys
 * (`Idempotency-Key`), so a draw request can never replay an import row.
 */
const IMPORT_KEY_PREFIX = 'import#';

export interface LegacyEntry {
  id: string;
  ts: number;
}

export interface ImportResult {
  imported: number;
  favorites: number;
}

/** Earliest clamped time per unique id, as ISO strings. */
export function firstSeen(entries: readonly LegacyEntry[], now: Date): Map<string, string> {
  const floor = now.getTime() - MAX_AGE_MS;
  const earliest = new Map<string, number>();
  for (const { id, ts } of entries) {
    const at = Math.min(now.getTime(), Math.max(floor, ts));
    earliest.set(id, Math.min(earliest.get(id) ?? at, at));
  }
  return new Map([...earliest].map(([id, at]) => [id, new Date(at).toISOString()]));
}

/** The subset of `ids` that are public today. */
export async function liveOfferIds(
  db: DB,
  ids: readonly string[],
  today: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT o.id FROM offers o
        WHERE ${PUBLIC_WHERE} AND o.id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(today, JSON.stringify(ids))
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

const changed = (result: D1Result | undefined) =>
  Number((result?.results?.[0] as { n?: number } | undefined)?.n ?? 0);

/**
 * Write the import for `userId`, claiming `users.imported_at` in the same
 * batch. Returns null when the user has already imported (or a concurrent
 * import won): the write guard then aborts the whole batch.
 */
export async function applyImport(
  db: DB,
  userId: string,
  { cards, favorites }: { cards: ReadonlyMap<string, string>; favorites: readonly string[] },
  now: Date,
): Promise<ImportResult | null> {
  const at = now.toISOString();
  const today = utcDay(now);
  const rows = [...cards].map(([id, seenAt]) => ({
    id,
    at: seenAt,
    day: quotaDay(new Date(seenAt)),
  }));
  try {
    const results = await db.batch([
      db
        .prepare('UPDATE users SET imported_at = ? WHERE id = ? AND imported_at IS NULL')
        .bind(at, userId),
      db.prepare('INSERT INTO write_guard (expected) VALUES (changes())'),
      db
        .prepare(
          `INSERT INTO draws (id, user_id, offer_id, pool, rarity, day, idem_key, created_at, source)
           SELECT 'i_' || lower(hex(randomblob(16))), ?2, o.id, o.pool, o.rarity,
                  json_extract(j.value, '$.day'), ?3 || o.id, json_extract(j.value, '$.at'), 'import'
             FROM json_each(?4) j JOIN offers o ON o.id = json_extract(j.value, '$.id')
            WHERE ${PUBLIC_WHERE}
           ON CONFLICT (user_id, idem_key) DO NOTHING`,
        )
        .bind(today, userId, IMPORT_KEY_PREFIX, JSON.stringify(rows)),
      db.prepare('SELECT changes() AS n'),
      db
        .prepare(
          `INSERT INTO favorites (user_id, offer_id, created_at)
           SELECT ?1, j.value, ?2 FROM json_each(?3) j
            WHERE EXISTS (SELECT 1 FROM draws d WHERE d.user_id = ?1 AND d.offer_id = j.value)
           ON CONFLICT (user_id, offer_id) DO NOTHING`,
        )
        .bind(userId, at, JSON.stringify(favorites)),
      db.prepare('SELECT changes() AS n'),
    ]);
    return { imported: changed(results[3]), favorites: changed(results[5]) };
  } catch (error: unknown) {
    if (String(error instanceof Error ? error.message : error).includes('write_conflict')) {
      return null;
    }
    throw error;
  }
}
