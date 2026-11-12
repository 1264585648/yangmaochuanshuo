/* Data access for server-side draws. `draws` is the single source of truth for
 * the daily quota (rows per user and day) and, later, the collection. */
import { randomToken } from '../auth/tokens';

type DB = Env['DB'];

const DRAW_ID_BYTES = 16;

export interface DrawView {
  id: string;
  offerId: string;
  pool: string;
  rarity: string;
  createdAt: string;
  /** First time this user drew this card. */
  isNew: boolean;
}

export interface DrawState {
  /** The draw stored under this user's idempotency key, or null. */
  draw: DrawView | null;
  /** Draws the user has made on the given quota day. */
  used: number;
}

export interface NewDraw {
  userId: string;
  offerId: string;
  pool: string;
  rarity: string;
  day: string;
  key: string;
  now: Date;
}

interface DrawRow {
  id: string;
  offer_id: string;
  pool: string;
  rarity: string;
  created_at: string;
  is_new: number;
}

const toView = (row: DrawRow): DrawView => ({
  id: row.id,
  offerId: row.offer_id,
  pool: row.pool,
  rarity: row.rarity,
  createdAt: row.created_at,
  isNew: row.is_new === 1,
});

function selectByKey(db: DB, userId: string, key: string) {
  return db
    .prepare(
      `SELECT d.id, d.offer_id, d.pool, d.rarity, d.created_at,
              NOT EXISTS (SELECT 1 FROM draws e
                           WHERE e.user_id = d.user_id AND e.offer_id = d.offer_id
                             AND e.rowid < d.rowid) AS is_new
         FROM draws d WHERE d.user_id = ? AND d.idem_key = ?`,
    )
    .bind(userId, key);
}

function countOnDay(db: DB, userId: string, day: string) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM draws WHERE user_id = ? AND day = ?')
    .bind(userId, day);
}

const firstRow = <T>(result: D1Result | undefined): T | null =>
  (result?.results?.[0] as T | undefined) ?? null;

const usedFrom = (result: D1Result | undefined): number =>
  Number(firstRow<{ n: number }>(result)?.n ?? 0);

export async function countDrawsOnDay(db: DB, userId: string, day: string): Promise<number> {
  return usedFrom(await countOnDay(db, userId, day).run());
}

/** The draw under `key` (for replays) and the user's count for `day`, read together. */
export async function readDrawState(
  db: DB,
  userId: string,
  key: string,
  day: string,
): Promise<DrawState> {
  const [byKey, count] = await db.batch([
    selectByKey(db, userId, key),
    countOnDay(db, userId, day),
  ]);
  const row = firstRow<DrawRow>(byKey);
  return { draw: row ? toView(row) : null, used: usedFrom(count) };
}

/**
 * Record a draw if the user still has quota for the day. The quota check and
 * the insert are one statement, so concurrent requests cannot overspend; a
 * repeated key inserts nothing. `inserted` is false when either happened, and
 * `state.draw` then tells a replay (set) from an exhausted quota (null).
 */
export async function insertDraw(
  db: DB,
  input: NewDraw,
  max: number,
): Promise<{ inserted: boolean; state: DrawState }> {
  const { userId, offerId, pool, rarity, day, key, now } = input;
  const [insert, byKey, count] = await db.batch([
    db
      .prepare(
        `INSERT INTO draws (id, user_id, offer_id, pool, rarity, day, idem_key, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
          WHERE (SELECT COUNT(*) FROM draws WHERE user_id = ?2 AND day = ?6) < ?9
         ON CONFLICT (user_id, idem_key) DO NOTHING`,
      )
      .bind(
        randomToken('d_', DRAW_ID_BYTES),
        userId,
        offerId,
        pool,
        rarity,
        day,
        key,
        now.toISOString(),
        max,
      ),
    selectByKey(db, userId, key),
    countOnDay(db, userId, day),
  ]);
  const row = firstRow<DrawRow>(byKey);
  return {
    inserted: (insert?.meta?.changes ?? 0) === 1,
    state: { draw: row ? toView(row) : null, used: usedFrom(count) },
  };
}
