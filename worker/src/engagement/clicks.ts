/* Official-link click stats. A click is "this visitor opened the official
 * page", not "claimed the offer". Each (offer, Beijing day, visitor) is stored
 * at most once, so repeat clicks write nothing. */
import { PUBLIC_WHERE } from '../repo/offers';

type DB = Env['DB'];

/**
 * Record one visit to an offer's official page. Only currently public offers
 * count. Returns true when a new row was written.
 */
export async function recordClick(
  db: DB,
  {
    offerId,
    day,
    visitor,
    today,
  }: { offerId: string; day: string; visitor: string; today: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO offer_clicks (offer_id, day, visitor)
       SELECT o.id, ?2, ?3 FROM offers o WHERE ${PUBLIC_WHERE} AND o.id = ?4`,
    )
    .bind(today, day, visitor, offerId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export interface DailyVisitors {
  day: string;
  visitors: number;
}

export interface OfferClickStats {
  id: string;
  title: string;
  pool: string;
  status: string;
  visitors: number;
  recentVisitors: number;
}

export interface ClickStats {
  since: string;
  /** Distinct visitors per day (any offer), oldest first, days without clicks omitted. */
  daily: DailyVisitors[];
  totals: { visitors: number; recentVisitors: number; clicks: number; recentClicks: number };
  topOffers: OfferClickStats[];
}

const TOP_OFFERS = 50;

/** Admin view of click activity. `since` is the first Beijing day of the recent window. */
export async function readClickStats(db: DB, since: string): Promise<ClickStats> {
  const [daily, totals, top] = await db.batch([
    db
      .prepare(
        `SELECT day, COUNT(DISTINCT visitor) AS visitors FROM offer_clicks
         WHERE day >= ?1 GROUP BY day ORDER BY day`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor) AS visitors,
           (SELECT COUNT(DISTINCT visitor) FROM offer_clicks WHERE day >= ?1) AS recent_visitors,
           COUNT(*) AS clicks,
           (SELECT COUNT(*) FROM offer_clicks WHERE day >= ?1) AS recent_clicks
         FROM offer_clicks`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT o.id, o.title, o.pool, o.status,
           COUNT(DISTINCT c.visitor) AS visitors,
           COUNT(DISTINCT CASE WHEN c.day >= ?1 THEN c.visitor END) AS recent_visitors
         FROM offer_clicks c JOIN offers o ON o.id = c.offer_id
         GROUP BY o.id ORDER BY visitors DESC, o.id LIMIT ?2`,
      )
      .bind(since, TOP_OFFERS),
  ]);
  const t = (totals?.results?.[0] ?? {}) as Record<string, number | null>;
  return {
    since,
    daily: ((daily?.results ?? []) as { day: string; visitors: number }[]).map((r) => ({
      day: r.day,
      visitors: Number(r.visitors),
    })),
    totals: {
      visitors: Number(t.visitors ?? 0),
      recentVisitors: Number(t.recent_visitors ?? 0),
      clicks: Number(t.clicks ?? 0),
      recentClicks: Number(t.recent_clicks ?? 0),
    },
    topOffers: (
      (top?.results ?? []) as {
        id: string;
        title: string;
        pool: string;
        status: string;
        visitors: number;
        recent_visitors: number;
      }[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      pool: r.pool,
      status: r.status,
      visitors: Number(r.visitors),
      recentVisitors: Number(r.recent_visitors),
    })),
  };
}
