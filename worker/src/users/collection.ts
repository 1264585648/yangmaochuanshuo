/* Collection, history and favorites, all derived from `draws`. */
import { POOLS, RARITIES } from '../domain/schema';
import {
  PUBLIC_OFFER_COLUMNS,
  PUBLIC_WHERE,
  toOwnedOffer,
  type PublicOffer,
  type PublicOfferRow,
  type RetiredOffer,
} from '../repo/offers';

type DB = Env['DB'];

/** Rarity order for display, rarest first. */
const RARITY_ORDER = [...RARITIES].reverse();

export interface CollectionCard {
  offer: PublicOffer | RetiredOffer;
  firstDrawnAt: string;
  lastDrawnAt: string;
  drawCount: number;
  favorite: boolean;
  /** Still published and in date; retired cards stay in the collection. */
  live: boolean;
}

export interface Tally {
  found: number;
  total: number;
}

export interface Progress {
  /** Live cards found out of all live cards. */
  live: Tally;
  /** Owned cards that are no longer live. */
  retired: number;
  byPool: (Tally & { pool: string })[];
  byRarity: (Tally & { rarity: string })[];
}

export interface HistoryItem {
  id: string;
  pool: string;
  rarity: string;
  createdAt: string;
  offer: PublicOffer | RetiredOffer;
  live: boolean;
}

interface CardRow extends PublicOfferRow {
  first_at: string;
  last_at: string;
  n: number;
  favorite: number;
  live: number;
}

interface TallyRow {
  pool: string;
  rarity: string;
  total: number;
  found: number;
}

interface HistoryRow extends PublicOfferRow {
  draw_id: string;
  draw_pool: string;
  draw_rarity: string;
  created_at: string;
  live: number;
}

const OFFER_JOIN = 'JOIN offers o ON o.id = c.offer_id JOIN providers p ON p.id = o.provider_id';

/** `?1` is today's UTC date (offer validity), `?2` the user id. */
const CARDS_SQL = `
  SELECT ${PUBLIC_OFFER_COLUMNS}, c.first_at, c.last_at, c.n,
         EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = ?2 AND f.offer_id = c.offer_id) AS favorite,
         (${PUBLIC_WHERE}) AS live
    FROM (SELECT offer_id, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
                 COUNT(*) AS n, MAX(rowid) AS last_row
            FROM draws WHERE user_id = ?2 GROUP BY offer_id) c
    ${OFFER_JOIN}
   ORDER BY c.last_row DESC`;

const TALLY_SQL = `
  SELECT o.pool, o.rarity, COUNT(*) AS total,
         SUM(EXISTS (SELECT 1 FROM draws d WHERE d.user_id = ?2 AND d.offer_id = o.id)) AS found
    FROM offers o WHERE ${PUBLIC_WHERE}
   GROUP BY o.pool, o.rarity`;

function sumWhere(rows: readonly TallyRow[], match: (row: TallyRow) => boolean): Tally {
  const matching = rows.filter(match);
  return {
    found: matching.reduce((sum, r) => sum + Number(r.found), 0),
    total: matching.reduce((sum, r) => sum + Number(r.total), 0),
  };
}

const toCard = (row: CardRow): CollectionCard => ({
  offer: toOwnedOffer(row, row.live === 1),
  firstDrawnAt: row.first_at,
  lastDrawnAt: row.last_at,
  drawCount: Number(row.n),
  favorite: row.favorite === 1,
  live: row.live === 1,
});

/** Cards the user owns (newest activity first) and progress over the live catalog. */
export async function readCollection(
  db: DB,
  userId: string | null,
  today: string,
): Promise<{ cards: CollectionCard[]; progress: Progress }> {
  // An anonymous caller matches no draws, so the same queries give empty progress.
  const owner = userId ?? '';
  const [cardsResult, tallyResult] = await db.batch([
    db.prepare(CARDS_SQL).bind(today, owner),
    db.prepare(TALLY_SQL).bind(today, owner),
  ]);
  const cards = ((cardsResult?.results ?? []) as CardRow[]).map(toCard);
  const rows = (tallyResult?.results ?? []) as TallyRow[];
  const byPool = POOLS.map((pool) => ({ pool, ...sumWhere(rows, (r) => r.pool === pool) }));
  return {
    cards,
    progress: {
      live: {
        found: byPool.reduce((sum, t) => sum + t.found, 0),
        total: byPool.reduce((sum, t) => sum + t.total, 0),
      },
      retired: cards.filter((c) => !c.live).length,
      byPool,
      byRarity: RARITY_ORDER.map((rarity) => ({
        rarity,
        ...sumWhere(rows, (r) => r.rarity === rarity),
      })),
    },
  };
}

/** Real draws, newest first, keyset-paged by draw id. */
export async function readHistory(
  db: DB,
  userId: string,
  today: string,
  { before, limit }: { before: string | null; limit: number },
): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
  const { results } = await db
    .prepare(
      `SELECT ${PUBLIC_OFFER_COLUMNS}, c.id AS draw_id, c.pool AS draw_pool,
              c.rarity AS draw_rarity, c.created_at, (${PUBLIC_WHERE}) AS live
         FROM draws c ${OFFER_JOIN}
        WHERE c.user_id = ?2 AND c.source = 'draw'
          AND (?3 IS NULL OR c.rowid < (SELECT rowid FROM draws WHERE id = ?3 AND user_id = ?2))
        ORDER BY c.rowid DESC LIMIT ?4`,
    )
    .bind(today, userId, before, limit + 1)
    .all<HistoryRow>();
  const page = results.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.draw_id,
      pool: row.draw_pool,
      rarity: row.draw_rarity,
      createdAt: row.created_at,
      offer: toOwnedOffer(row, row.live === 1),
      live: row.live === 1,
    })),
    nextCursor: results.length > limit ? (page.at(-1)?.draw_id ?? null) : null,
  };
}

/** Mark an owned card as favorite. False when the user does not own it. */
export async function addFavorite(
  db: DB,
  userId: string,
  offerId: string,
  now: Date,
): Promise<boolean> {
  const [, owned] = await db.batch([
    db
      .prepare(
        `INSERT INTO favorites (user_id, offer_id, created_at)
         SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM draws WHERE user_id = ?1 AND offer_id = ?2)
         ON CONFLICT (user_id, offer_id) DO NOTHING`,
      )
      .bind(userId, offerId, now.toISOString()),
    db
      .prepare('SELECT EXISTS (SELECT 1 FROM favorites WHERE user_id = ? AND offer_id = ?) AS n')
      .bind(userId, offerId),
  ]);
  return Number((owned?.results?.[0] as { n?: number } | undefined)?.n ?? 0) === 1;
}

export async function removeFavorite(db: DB, userId: string, offerId: string): Promise<void> {
  await db
    .prepare('DELETE FROM favorites WHERE user_id = ? AND offer_id = ?')
    .bind(userId, offerId)
    .run();
}
