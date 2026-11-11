import { z } from 'zod';
import { httpsUrl, offerPatchSchema } from '../../domain/schema';
import { fail, notFound, ok } from '../../http/respond';
import {
  getChange,
  getOfferRow,
  listChanges,
  toManagedOffer,
  type ChangeRecord,
} from '../../repo/manage';
import { plan } from '../../write/commit';
import {
  checkOfficial,
  contentUpdate,
  forbidden,
  invalid,
  isUnchanged,
  mergeContent,
  noChanges,
  parseIntParam,
  reviewQueueFull,
  type DB,
  type Handler,
} from './shared';

const proposalSchema = z.strictObject({
  baseVersion: z.number().int().min(1),
  changes: offerPatchSchema,
  sourceUrl: httpsUrl,
});

const CHANGE_STATUSES = ['pending', 'applied', 'rejected'] as const;

const notPending = (change: ChangeRecord) =>
  fail(409, 'change_not_pending', `This change request is already ${change.status}`);

const staleBase = () =>
  fail(
    409,
    'version_conflict',
    'The offer changed since this request was made; ask for a new proposal',
  );

/** After a lost race, report whichever precondition no longer holds. */
const explainChangeConflict = (db: DB, id: string) => async (): Promise<Response> => {
  const current = await getChange(db, id);
  return current && current.status !== 'pending' ? notPending(current) : staleBase();
};

const reviewStatement = (
  db: DB,
  status: 'applied' | 'rejected',
  reviewer: string,
  at: string,
  id: string,
) =>
  db
    .prepare(
      `UPDATE offer_changes SET status = ?, reviewed_by = ?, reviewed_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(status, reviewer, at, id);

export const proposeChange: Handler = async ({ db, client, now, body }, [offerId]) => {
  const parsed = proposalSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const row = await getOfferRow(db, offerId ?? '');
  if (!row) return notFound();
  if (row.version !== parsed.data.baseVersion) return staleBase();
  const merged = mergeContent(row, parsed.data.changes);
  if (!merged.ok) return merged.response;
  if (isUnchanged(row, merged.content)) return noChanges();
  const official = await checkOfficial(db, row.provider_id, {
    sourceUrl: parsed.data.sourceUrl,
    officialUrl: merged.content.officialUrl,
    'changes.sourceUrl': merged.content.sourceUrl,
  });
  if (!official.ok) return official.response;
  const queueFull = await reviewQueueFull(db, client);
  if (queueFull) return queueFull;

  const at = now.toISOString();
  const change: ChangeRecord = {
    id: crypto.randomUUID(),
    offerId: row.id,
    changes: parsed.data.changes,
    sourceUrl: parsed.data.sourceUrl,
    baseVersion: row.version,
    status: 'pending',
    createdBy: client.id,
    createdAt: at,
    reviewedBy: null,
    reviewedAt: null,
  };
  const statement = db
    .prepare(
      `INSERT INTO offer_changes (id, offer_id, patch, source_url, base_version, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      change.id,
      row.id,
      JSON.stringify(change.changes),
      change.sourceUrl,
      row.version,
      client.id,
      at,
    );
  return plan({
    steps: [{ statement }],
    audit: {
      action: 'change.propose',
      entityType: 'change',
      entityId: change.id,
      before: null,
      after: change,
      sourceUrl: change.sourceUrl,
    },
    status: 201,
    data: change,
  });
};

export const applyChange: Handler = async ({ db, client, now }, [changeId]) => {
  if (client.scope !== 'admin') return forbidden();
  const change = await getChange(db, changeId ?? '');
  if (!change) return notFound();
  if (change.status !== 'pending') return notPending(change);
  const row = await getOfferRow(db, change.offerId);
  if (!row) return notFound();
  if (row.version !== change.baseVersion) return staleBase();
  const patch = offerPatchSchema.safeParse(change.changes);
  if (!patch.success) {
    return fail(422, 'invalid_change', 'Stored change no longer passes validation; reject it');
  }
  const merged = mergeContent(row, patch.data);
  if (!merged.ok) return merged.response;
  if (isUnchanged(row, merged.content)) return noChanges();
  // Domains may have changed since the proposal was made.
  const official = await checkOfficial(db, row.provider_id, {
    officialUrl: merged.content.officialUrl,
    sourceUrl: merged.content.sourceUrl,
  });
  if (!official.ok) return official.response;

  const at = now.toISOString();
  const update = contentUpdate(db, row, merged.content, at);
  const applied: ChangeRecord = {
    ...change,
    status: 'applied',
    reviewedBy: client.id,
    reviewedAt: at,
  };
  return plan({
    steps: [
      { statement: reviewStatement(db, 'applied', client.id, at, change.id), guarded: true },
      { statement: update.statement, guarded: true },
    ],
    // Logged against the offer so the content change can be reverted; the
    // snapshot names the change request it came from.
    audit: {
      action: 'change.apply',
      entityType: 'offer',
      entityId: row.id,
      before: toManagedOffer(row),
      after: { ...update.after, appliedChangeId: change.id },
      sourceUrl: change.sourceUrl,
    },
    status: 200,
    data: { offer: update.after, change: applied },
    conflict: explainChangeConflict(db, change.id),
  });
};

export const rejectChange: Handler = async ({ db, client, now }, [changeId]) => {
  if (client.scope !== 'admin') return forbidden();
  const change = await getChange(db, changeId ?? '');
  if (!change) return notFound();
  if (change.status !== 'pending') return notPending(change);
  const at = now.toISOString();
  const rejected: ChangeRecord = {
    ...change,
    status: 'rejected',
    reviewedBy: client.id,
    reviewedAt: at,
  };
  return plan({
    steps: [
      { statement: reviewStatement(db, 'rejected', client.id, at, change.id), guarded: true },
    ],
    audit: {
      action: 'change.reject',
      entityType: 'change',
      entityId: change.id,
      before: change,
      after: rejected,
    },
    status: 200,
    data: rejected,
    conflict: explainChangeConflict(db, change.id),
  });
};

export const listChangeRequests: Handler = async ({ db, url }) => {
  const status = url.searchParams.get('status') ?? undefined;
  if (status && !(CHANGE_STATUSES as readonly string[]).includes(status)) {
    return fail(400, 'invalid_query', 'Unknown status');
  }
  const limit = parseIntParam(url.searchParams.get('limit'), 50, 200);
  if (limit === null) return fail(400, 'invalid_query', 'Invalid limit');
  const offerId = url.searchParams.get('offerId') ?? undefined;
  return ok(await listChanges(db, { status, offerId }, limit));
};
