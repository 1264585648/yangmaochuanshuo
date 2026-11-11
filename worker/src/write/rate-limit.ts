type DB = Env['DB'];

export interface RateLimit {
  max: number;
  windowSeconds: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = { max: 60, windowSeconds: 60 };

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/**
 * Fixed-window counter per caller. The upsert is a single atomic statement,
 * so concurrent requests cannot both read a stale count.
 */
export async function consumeRateLimit(
  db: DB,
  actor: string,
  now: Date,
  { max, windowSeconds }: RateLimit,
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  const [, upsert] = await db.batch([
    db
      .prepare('DELETE FROM rate_limits WHERE actor = ? AND window_start < ?')
      .bind(actor, windowStart),
    db
      .prepare(
        `INSERT INTO rate_limits (actor, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT (actor, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(actor, windowStart),
  ]);
  const count = Number((upsert?.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  if (count <= max) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, windowStart + windowSeconds - nowSeconds) };
}
