/* Limited prizes: benefits the site owner holds, each unit a redemption code.
 * Every real draw rolls once against the live prizes; a win claims one unit in
 * the same batch as the draw insert (see users/draws.ts). Codes leave the
 * database only towards the winning session. */
import { z } from 'zod';
import { PRIZE_LIMITS } from '../config';
import { httpsUrl, slugSchema } from '../domain/schema';

type DB = Env['DB'];
type Statement = ReturnType<DB['prepare']>;

export const PRIZE_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type PrizeStatus = (typeof PRIZE_STATUSES)[number];

/** Tolerance for float sums when checking the total chance cap. */
const CHANCE_EPSILON = 1e-9;

const text = (max: number) => z.string().trim().max(max);
/** Stored in canonical UTC form so the SQL window checks can compare text. */
const utcTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
const isoTime = utcTime.nullable().default(null);
const chance = z.number().gt(0).max(PRIZE_LIMITS.maxChance);

const windowOk = (v: { startsAt?: string | null; endsAt?: string | null }) =>
  !v.startsAt || !v.endsAt || Date.parse(v.startsAt) < Date.parse(v.endsAt);
const windowError = { message: 'startsAt must be before endsAt', path: ['endsAt'] };

const prizeFields = {
  title: text(PRIZE_LIMITS.title).min(1),
  description: text(PRIZE_LIMITS.description).default(''),
  valueNote: text(PRIZE_LIMITS.valueNote).default(''),
  redeemUrl: httpsUrl.nullable().default(null),
  chance,
  startsAt: isoTime,
  endsAt: isoTime,
};

export const prizeCreateSchema = z
  .strictObject({ id: slugSchema, ...prizeFields })
  .refine(windowOk, windowError);

export const prizePatchSchema = z
  .strictObject({
    title: prizeFields.title.optional(),
    description: text(PRIZE_LIMITS.description).optional(),
    valueNote: text(PRIZE_LIMITS.valueNote).optional(),
    redeemUrl: httpsUrl.nullable().optional(),
    chance: chance.optional(),
    startsAt: utcTime.nullable().optional(),
    endsAt: utcTime.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

export const codesUploadSchema = z.strictObject({
  codes: z
    .array(z.string().trim().min(1).max(PRIZE_LIMITS.codeMax))
    .min(1)
    .max(PRIZE_LIMITS.codesPerUpload),
});

export type PrizeInput = z.infer<typeof prizeCreateSchema>;

export interface PrizeRecord {
  id: string;
  title: string;
  description: string;
  valueNote: string;
  redeemUrl: string | null;
  chance: number;
  status: PrizeStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin view: the prize plus its stock. Never includes codes. */
export interface ManagedPrize extends PrizeRecord {
  total: number;
  claimed: number;
}

/** Public rules for one live prize. */
export interface PublicPrize {
  id: string;
  title: string;
  description: string;
  valueNote: string;
  chance: number;
  total: number;
  remaining: number;
  startsAt: string | null;
  endsAt: string | null;
}

/** What the winner sees, in the draw reply and under `/api/me/prizes`. */
export interface WonPrize {
  id: string;
  title: string;
  description: string;
  redeemUrl: string | null;
  code: string;
  claimedAt: string;
}

export interface RollablePrize {
  id: string;
  chance: number;
}

interface PrizeRow {
  id: string;
  title: string;
  description: string;
  value_note: string;
  redeem_url: string | null;
  chance: number;
  status: PrizeStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  total?: number;
  claimed?: number;
}

export const toPrizeRecord = (r: PrizeRow): PrizeRecord => ({
  id: r.id,
  title: r.title,
  description: r.description,
  valueNote: r.value_note,
  redeemUrl: r.redeem_url,
  chance: Number(r.chance),
  status: r.status,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toManaged = (r: PrizeRow): ManagedPrize => ({
  ...toPrizeRecord(r),
  total: Number(r.total ?? 0),
  claimed: Number(r.claimed ?? 0),
});

/** WHERE fragment for prizes that take part in draws; bind `?1` to now (ISO). */
const LIVE_SQL = `p.status = 'active' AND (p.starts_at IS NULL OR p.starts_at <= ?1)
  AND (p.ends_at IS NULL OR p.ends_at > ?1)`;

const STOCK_SQL = `(SELECT COUNT(*) FROM prize_codes c WHERE c.prize_id = p.id) AS total,
  (SELECT COUNT(*) FROM prize_codes c WHERE c.prize_id = p.id AND c.draw_id IS NOT NULL) AS claimed`;

/** Live prizes with stock left, in a stable order so the roll is reproducible. */
export async function listRollablePrizes(db: DB, now: Date): Promise<RollablePrize[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.chance FROM prizes p
        WHERE ${LIVE_SQL}
          AND EXISTS (SELECT 1 FROM prize_codes c WHERE c.prize_id = p.id AND c.draw_id IS NULL)
        ORDER BY p.id`,
    )
    .bind(now.toISOString())
    .all<{ id: string; chance: number }>();
  return results.map((r) => ({ id: r.id, chance: Number(r.chance) }));
}

/**
 * One roll against the live prizes. Each prize keeps its own published chance;
 * the total is capped by the API, so the leftover is "no prize".
 */
export function rollPrize(prizes: readonly RollablePrize[], random: () => number): string | null {
  if (prizes.length === 0) return null;
  const roll = random();
  let edge = 0;
  for (const prize of prizes) {
    edge += prize.chance;
    if (roll < edge) return prize.id;
  }
  return null;
}

export interface ClaimInput {
  prizeId: string;
  drawId: string;
  userId: string;
  visitor: string;
  day: string;
  now: Date;
}

/**
 * Assign one unclaimed unit to a draw. Runs after the draw insert in the same
 * batch: it does nothing unless that draw row exists (a replay or a spent quota
 * inserted none), the prize is still live and has stock, and neither the user
 * nor the network has hit its win cap, and the day's total stays under the cap. `OR IGNORE` keeps a race on the unique
 * cap indexes from aborting the draw itself.
 */
export function claimStatement(
  db: DB,
  input: ClaimInput,
  maxWinsPerDay: number = PRIZE_LIMITS.maxWinsPerDay,
): Statement {
  const { prizeId, drawId, userId, visitor, day, now } = input;
  return db
    .prepare(
      `UPDATE OR IGNORE prize_codes
          SET draw_id = ?2, user_id = ?3, visitor = ?4, day = ?5, claimed_at = ?6
        WHERE id = (SELECT c.id FROM prize_codes c
                     WHERE c.prize_id = ?1 AND c.draw_id IS NULL ORDER BY c.id LIMIT 1)
          AND EXISTS (SELECT 1 FROM draws d WHERE d.id = ?2 AND d.user_id = ?3)
          AND EXISTS (SELECT 1 FROM prizes p WHERE p.id = ?1 AND ${LIVE_SQL.replaceAll('?1', '?6')})
          AND NOT EXISTS (SELECT 1 FROM prize_codes w WHERE w.user_id = ?3)
          AND NOT EXISTS (SELECT 1 FROM prize_codes w WHERE w.visitor = ?4 AND w.day = ?5)
          AND (SELECT COUNT(*) FROM prize_codes w WHERE w.day = ?5) < ?7`,
    )
    .bind(prizeId, drawId, userId, visitor, day, now.toISOString(), maxWinsPerDay);
}

/** Columns of a won prize, for joins on `prize_codes c` and `prizes p`. */
export const WON_COLUMNS = `p.id AS prize_id, p.title AS prize_title,
  p.description AS prize_description, p.redeem_url AS prize_redeem_url,
  c.code AS prize_code, c.claimed_at AS prize_claimed_at`;

export interface WonRow {
  prize_id: string | null;
  prize_title: string | null;
  prize_description: string | null;
  prize_redeem_url: string | null;
  prize_code: string | null;
  prize_claimed_at: string | null;
}

export const toWonPrize = (r: WonRow): WonPrize | null =>
  r.prize_id && r.prize_code && r.prize_claimed_at
    ? {
        id: r.prize_id,
        title: r.prize_title ?? '',
        description: r.prize_description ?? '',
        redeemUrl: r.prize_redeem_url,
        code: r.prize_code,
        claimedAt: r.prize_claimed_at,
      }
    : null;

/** Prizes this user has won, newest first. */
export async function listWonPrizes(db: DB, userId: string): Promise<WonPrize[]> {
  const { results } = await db
    .prepare(
      `SELECT ${WON_COLUMNS} FROM prize_codes c JOIN prizes p ON p.id = c.prize_id
        WHERE c.user_id = ? ORDER BY c.claimed_at DESC`,
    )
    .bind(userId)
    .all<WonRow>();
  return results.map(toWonPrize).filter((p): p is WonPrize => p !== null);
}

/** Public rules: live prizes, including sold-out ones so people see they existed. */
export async function listPublicPrizes(db: DB, now: Date): Promise<PublicPrize[]> {
  const { results } = await db
    .prepare(`SELECT p.*, ${STOCK_SQL} FROM prizes p WHERE ${LIVE_SQL} ORDER BY p.id`)
    .bind(now.toISOString())
    .all<PrizeRow>();
  return results.map((r) => {
    const total = Number(r.total ?? 0);
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      valueNote: r.value_note,
      chance: Number(r.chance),
      total,
      remaining: total - Number(r.claimed ?? 0),
      startsAt: r.starts_at,
      endsAt: r.ends_at,
    };
  });
}

export async function listManagedPrizes(db: DB): Promise<ManagedPrize[]> {
  const { results } = await db
    .prepare(`SELECT p.*, ${STOCK_SQL} FROM prizes p ORDER BY p.created_at DESC, p.id`)
    .all<PrizeRow>();
  return results.map(toManaged);
}

export async function getManagedPrize(db: DB, id: string): Promise<ManagedPrize | null> {
  const row = await db
    .prepare(`SELECT p.*, ${STOCK_SQL} FROM prizes p WHERE p.id = ?`)
    .bind(id)
    .first<PrizeRow>();
  return row ? toManaged(row) : null;
}

export interface Winner {
  code: string;
  claimedAt: string;
  day: string;
  user: string;
}

const MASK_KEEP = 4;

/** Enough of a code to match it against the owner's list, not enough to redeem it. */
export function maskCode(code: string): string {
  const keep = Math.min(MASK_KEEP, Math.floor(code.length / 3));
  return keep === 0 ? '*'.repeat(code.length) : `****${code.slice(-keep)}`;
}

export async function listWinners(db: DB, prizeId: string): Promise<Winner[]> {
  const { results } = await db
    .prepare(
      `SELECT code, claimed_at, day, user_id FROM prize_codes
        WHERE prize_id = ? AND draw_id IS NOT NULL ORDER BY claimed_at DESC`,
    )
    .bind(prizeId)
    .all<{ code: string; claimed_at: string; day: string; user_id: string }>();
  return results.map((r) => ({
    code: maskCode(r.code),
    claimedAt: r.claimed_at,
    day: r.day,
    user: r.user_id.slice(0, 10),
  }));
}

/** True when the sum of active chances (with `id` at `chance`) stays within the cap. */
export const CHANCE_CAP_SQL = `(SELECT COALESCE(SUM(chance), 0) FROM prizes
  WHERE status = 'active' AND id <> ?1) + ?2 <= ${PRIZE_LIMITS.maxTotalChance + CHANCE_EPSILON}`;
