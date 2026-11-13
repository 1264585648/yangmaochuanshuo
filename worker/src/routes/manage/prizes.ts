/* Admin endpoints for limited prizes:
 *   GET   /api/manage/prizes
 *   POST  /api/manage/prizes                         create (draft)
 *   PATCH /api/manage/prizes/:id                     edit (not once ended)
 *   POST  /api/manage/prizes/:id/codes   { codes }   add stock
 *   GET   /api/manage/prizes/:id/winners             claimed units, codes masked
 *   POST  /api/manage/prizes/:id/(activate|pause|end)
 * All admin scope and audited. Codes never enter the audit log or any
 * response here; uploads are recorded by count only. */
import { PRIZE_LIMITS } from '../../config';
import { fail, notFound, ok } from '../../http/respond';
import {
  CHANCE_CAP_SQL,
  codesUploadSchema,
  getManagedPrize,
  listManagedPrizes,
  listWinners,
  prizeCreateSchema,
  prizePatchSchema,
  type ManagedPrize,
  type PrizeStatus,
} from '../../prizes/prizes';
import { slugSchema } from '../../domain/schema';
import { plan } from '../../write/commit';
import { forbidden, invalid, type Handler } from './shared';

const TRANSITIONS: Readonly<Record<string, { from: PrizeStatus[]; to: PrizeStatus }>> = {
  activate: { from: ['draft', 'paused'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  end: { from: ['draft', 'active', 'paused'], to: 'ended' },
};

const chanceCapExceeded = () =>
  fail(
    422,
    'chance_cap_exceeded',
    `Active prizes may add up to at most ${PRIZE_LIMITS.maxTotalChance * 100}% per draw`,
  );

async function loadPrize(db: Parameters<Handler>[0]['db'], id: string | undefined) {
  if (!id || !slugSchema.safeParse(id).success) return null;
  return getManagedPrize(db, id);
}

export const listPrizesHandler: Handler = async ({ db, client }) => {
  if (client.scope !== 'admin') return forbidden();
  return ok(await listManagedPrizes(db));
};

export const createPrize: Handler = async ({ db, client, now, body }) => {
  if (client.scope !== 'admin') return forbidden();
  const parsed = prizeCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const p = parsed.data;
  const at = now.toISOString();
  const statement = db
    .prepare(
      `INSERT INTO prizes (id, title, description, value_note, redeem_url, chance, status,
                           starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    )
    .bind(
      p.id,
      p.title,
      p.description,
      p.valueNote,
      p.redeemUrl,
      p.chance,
      p.startsAt,
      p.endsAt,
      at,
      at,
    );
  const after: ManagedPrize = {
    ...p,
    status: 'draft',
    createdAt: at,
    updatedAt: at,
    total: 0,
    claimed: 0,
  };
  return plan({
    steps: [{ statement }],
    audit: { action: 'prize.create', entityType: 'prize', entityId: p.id, before: null, after },
    status: 201,
    data: after,
  });
};

export const editPrize: Handler = async ({ db, client, now, body }, [id]) => {
  if (client.scope !== 'admin') return forbidden();
  const current = await loadPrize(db, id);
  if (!current) return notFound();
  if (current.status === 'ended') return fail(409, 'invalid_state', 'An ended prize is final');
  const parsed = prizePatchSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const next = { ...current, ...parsed.data, updatedAt: now.toISOString() };
  if (next.startsAt && next.endsAt && Date.parse(next.startsAt) >= Date.parse(next.endsAt)) {
    return fail(422, 'invalid_window', 'startsAt must be before endsAt');
  }
  // Raising the chance of an active prize must keep the total within the cap.
  const statement = db
    .prepare(
      `UPDATE prizes SET title = ?3, description = ?4, value_note = ?5, redeem_url = ?6,
              chance = ?2, starts_at = ?7, ends_at = ?8, updated_at = ?9
        WHERE id = ?1 AND status = ?10 AND updated_at = ?11
          AND (status <> 'active' OR ${CHANCE_CAP_SQL})`,
    )
    .bind(
      current.id,
      next.chance,
      next.title,
      next.description,
      next.valueNote,
      next.redeemUrl,
      next.startsAt,
      next.endsAt,
      next.updatedAt,
      current.status,
      current.updatedAt,
    );
  return plan({
    steps: [{ statement, guarded: true }],
    audit: {
      action: 'prize.update',
      entityType: 'prize',
      entityId: current.id,
      before: current,
      after: next,
    },
    status: 200,
    data: next,
    conflict: async () => {
      const fresh = await getManagedPrize(db, current.id);
      return fresh && fresh.updatedAt === current.updatedAt && fresh.status === 'active'
        ? chanceCapExceeded()
        : fail(409, 'conflict', 'The prize changed; reload and retry');
    },
  });
};

export const transitionPrize: Handler = async ({ db, client, now }, [id, action]) => {
  if (client.scope !== 'admin') return forbidden();
  const rule = action && Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : undefined;
  if (!rule) return notFound();
  const current = await loadPrize(db, id);
  if (!current) return notFound();
  if (!rule.from.includes(current.status)) {
    return fail(409, 'invalid_state', `Cannot ${action} a prize that is ${current.status}`);
  }
  const at = now.toISOString();
  const capCheck = rule.to === 'active' ? `AND ${CHANCE_CAP_SQL}` : '';
  const statement = db
    .prepare(
      `UPDATE prizes SET status = ?3, updated_at = ?4
        WHERE id = ?1 AND status = ?5 ${capCheck}`,
    )
    .bind(current.id, current.chance, rule.to, at, current.status);
  const after = { ...current, status: rule.to, updatedAt: at };
  return plan({
    steps: [{ statement, guarded: true }],
    audit: {
      action: `prize.${action}`,
      entityType: 'prize',
      entityId: current.id,
      before: current,
      after,
    },
    status: 200,
    data: after,
    conflict: async () => {
      const fresh = await getManagedPrize(db, current.id);
      return fresh?.status === current.status && rule.to === 'active'
        ? chanceCapExceeded()
        : fail(409, 'conflict', 'The prize changed; reload and retry');
    },
  });
};

export const addPrizeCodes: Handler = async ({ db, client, now, body }, [id]) => {
  if (client.scope !== 'admin') return forbidden();
  const current = await loadPrize(db, id);
  if (!current) return notFound();
  if (current.status === 'ended') return fail(409, 'invalid_state', 'An ended prize is final');
  const parsed = codesUploadSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const codes = [...new Set(parsed.data.codes)];
  const json = JSON.stringify(codes);
  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM prize_codes
        WHERE prize_id = ? AND code IN (SELECT value FROM json_each(?))`,
    )
    .bind(current.id, json)
    .first<{ n: number }>();
  const added = codes.length - Number(existing?.n ?? 0);
  if (added === 0) return fail(422, 'no_changes', 'Every code is already in stock');
  const statement = db
    .prepare(
      `INSERT OR IGNORE INTO prize_codes (prize_id, code)
       SELECT ?1, value FROM json_each(?2)
        WHERE EXISTS (SELECT 1 FROM prizes WHERE id = ?1 AND updated_at = ?3)`,
    )
    .bind(current.id, json, current.updatedAt);
  // Guarded: a concurrent edit, end or upload since the read aborts the batch.
  const touch = db
    .prepare('UPDATE prizes SET updated_at = ? WHERE id = ? AND updated_at = ?')
    .bind(now.toISOString(), current.id, current.updatedAt);
  const stock = { total: current.total + added, claimed: current.claimed };
  return plan({
    steps: [{ statement }, { statement: touch, guarded: true }],
    conflict: { code: 'conflict', message: 'The prize changed; reload and retry' },
    audit: {
      action: 'prize.codes',
      entityType: 'prize',
      entityId: current.id,
      // Counts only: codes are secrets and the audit log is append-only.
      before: { total: current.total, claimed: current.claimed },
      after: { ...stock, added },
    },
    status: 200,
    data: { added, ...stock },
  });
};

export const listWinnersHandler: Handler = async ({ db, client }, [id]) => {
  if (client.scope !== 'admin') return forbidden();
  const current = await loadPrize(db, id);
  if (!current) return notFound();
  return ok(await listWinners(db, current.id));
};
