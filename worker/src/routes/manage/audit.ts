import { offerCreateSchema } from '../../domain/schema';
import { fail, notFound, ok } from '../../http/respond';
import { CONTENT_KEYS, getAudit, getOfferRow, listAudit, toManagedOffer } from '../../repo/manage';
import { plan } from '../../write/commit';
import {
  checkOfficial,
  contentUpdate,
  forbidden,
  invalid,
  isUnchanged,
  noChanges,
  parseIntParam,
  type Handler,
} from './shared';

/** Audit actions whose `before` snapshot holds offer content that can be restored. */
const REVERTIBLE = ['offer.update', 'change.apply', 'audit.revert'];

export const listAuditEntries: Handler = async ({ db, client, url }) => {
  if (client.scope !== 'admin') return forbidden();
  const limit = parseIntParam(url.searchParams.get('limit'), 50, 200);
  if (limit === null) return fail(400, 'invalid_query', 'Invalid limit');
  const entityType = url.searchParams.get('entityType') ?? undefined;
  const entityId = url.searchParams.get('entityId') ?? undefined;
  return ok(await listAudit(db, { entityType, entityId }, limit));
};

/**
 * Restore an offer's content to the `before` snapshot of an audit entry. Only
 * allowed while the offer is still exactly as that entry left it, and recorded
 * as a new audited write rather than rewriting history.
 */
export const revertAuditEntry: Handler = async ({ db, client, now }, [idParam]) => {
  if (client.scope !== 'admin') return forbidden();
  const auditId = Number(idParam);
  if (!/^\d{1,15}$/.test(idParam ?? '') || !Number.isSafeInteger(auditId)) return notFound();
  const entry = await getAudit(db, auditId);
  if (!entry) return notFound();
  if (entry.entityType !== 'offer' || !REVERTIBLE.includes(entry.action)) {
    return fail(422, 'not_revertible', `Audit action ${entry.action} cannot be reverted`);
  }
  const before = entry.before as Record<string, unknown>;
  const after = entry.after as { version?: number };
  const row = await getOfferRow(db, entry.entityId);
  if (!row) return notFound();
  if (row.version !== after.version) {
    return fail(
      409,
      'version_conflict',
      'The offer changed after this entry; revert newer entries first',
    );
  }
  const snapshot = Object.fromEntries(CONTENT_KEYS.map((k) => [k, before[k]]));
  const parsed = offerCreateSchema.safeParse({
    id: row.id,
    providerId: row.provider_id,
    ...snapshot,
  });
  if (!parsed.success) return invalid(parsed.error);
  const { id: _id, providerId: _providerId, ...content } = parsed.data;
  if (isUnchanged(row, content)) return noChanges();
  const official = await checkOfficial(db, row.provider_id, {
    officialUrl: content.officialUrl,
    sourceUrl: content.sourceUrl,
  });
  if (!official.ok) return official.response;

  const update = contentUpdate(db, row, content, now.toISOString());
  return plan({
    steps: [{ statement: update.statement, guarded: true }],
    audit: {
      action: 'audit.revert',
      entityType: 'offer',
      entityId: row.id,
      before: toManagedOffer(row),
      after: update.after,
    },
    status: 200,
    data: update.after,
    conflict: { code: 'version_conflict', message: 'The offer changed during revert; retry' },
  });
};
