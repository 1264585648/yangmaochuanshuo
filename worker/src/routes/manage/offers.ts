import { z } from 'zod';
import { INSPECTOR_EXPIRE_LIMIT } from '../../config';
import { httpsUrl, offerCreateSchema, offerPatchSchema, slugSchema } from '../../domain/schema';
import {
  ACTIONS,
  STATUSES,
  canEditDirectly,
  initialStatus,
  planTransition,
  scopeMayAttempt,
  type Action,
  type Status,
} from '../../domain/status';
import { fail, notFound, ok } from '../../http/respond';
import {
  CONTENT_COLUMNS,
  contentColumns,
  contentOf,
  getOfferRow,
  listOfferRows,
  nextRow,
  toManagedOffer,
  type FullOfferRow,
} from '../../repo/manage';
import { plan } from '../../write/commit';
import { consumeRateLimit } from '../../write/rate-limit';
import {
  VERSION_CONFLICT,
  checkOfficial,
  contentUpdate,
  evidenceMatchesOffer,
  forbidden,
  guideRule,
  invalid,
  isUnchanged,
  mergeContent,
  noChanges,
  officialUrlsOf,
  parseIntParam,
  parseOffset,
  reviewQueueFull,
  type Handler,
} from './shared';

const editSchema = z.strictObject({
  baseVersion: z.number().int().min(1),
  changes: offerPatchSchema,
});

const actionSchema = z.strictObject({
  sourceUrl: httpsUrl.optional(),
  /** publish only: also record a verification, under the same evidence rules as `verify`. */
  verified: z.literal(true).optional(),
});

/** Actions that change what users see based on outside evidence. */
const EVIDENCE_REQUIRED: readonly Action[] = ['verify', 'expire'];

/** Whether this request records a verification (and so needs matching evidence). */
const recordsVerification = (action: Action, verified: boolean) =>
  action === 'verify' || (action === 'publish' && verified);

export const createOffer: Handler = async ({ db, client, now, body }) => {
  const parsed = offerCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const { id, providerId, ...content } = parsed.data;
  const official = await checkOfficial(db, providerId, officialUrlsOf(content));
  if (!official.ok) return official.response;
  const queueFull = await reviewQueueFull(db, client);
  if (queueFull) return queueFull;

  const at = now.toISOString();
  const row: FullOfferRow = {
    id,
    provider_id: providerId,
    provider_name: official.provider.name,
    ...contentColumns(content),
    status: initialStatus(client.scope),
    last_verified_at: null,
    version: 1,
    created_by: client.id,
    created_at: at,
    updated_at: at,
  };
  const columns = [
    'id',
    'provider_id',
    ...CONTENT_COLUMNS,
    'status',
    'created_by',
    'created_at',
    'updated_at',
  ] as const;
  const statement = db
    .prepare(
      `INSERT INTO offers (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .bind(...columns.map((c) => row[c]));
  const offer = toManagedOffer(row);
  return plan({
    steps: [{ statement }],
    audit: {
      action: 'offer.create',
      entityType: 'offer',
      entityId: id,
      before: null,
      after: offer,
      sourceUrl: content.sourceUrl,
    },
    status: 201,
    data: offer,
  });
};

export const editOffer: Handler = async ({ db, client, now, body }, [id]) => {
  if (!canEditDirectly(client.scope)) return forbidden();
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const row = await getOfferRow(db, id ?? '');
  if (!row) return notFound();
  if (row.version !== parsed.data.baseVersion) {
    return fail(409, VERSION_CONFLICT.code, VERSION_CONFLICT.message);
  }
  const merged = mergeContent(row, parsed.data.changes);
  if (!merged.ok) return merged.response;
  if (isUnchanged(row, merged.content)) return noChanges();
  if (row.status === 'published') {
    const broken = guideRule(merged.content);
    if (broken) return broken;
  }
  const official = await checkOfficial(db, row.provider_id, officialUrlsOf(merged.content));
  if (!official.ok) return official.response;
  const update = contentUpdate(db, row, merged.content, now.toISOString());
  return plan({
    steps: [{ statement: update.statement, guarded: true }],
    audit: {
      action: 'offer.update',
      entityType: 'offer',
      entityId: row.id,
      before: toManagedOffer(row),
      after: update.after,
    },
    status: 200,
    data: update.after,
    conflict: VERSION_CONFLICT,
  });
};

/** Validate evidence for actions that need it; null when acceptable. */
async function checkEvidence(
  db: Env['DB'],
  row: FullOfferRow,
  action: Action,
  sourceUrl: string | undefined,
  verifies: boolean,
): Promise<Response | null> {
  const required = verifies || EVIDENCE_REQUIRED.includes(action);
  if (!sourceUrl) {
    return required
      ? fail(400, 'source_required', `${action} requires a sourceUrl as evidence`)
      : null;
  }
  const official = await checkOfficial(db, row.provider_id, { sourceUrl });
  if (!official.ok) return official.response;
  if (required && !evidenceMatchesOffer(sourceUrl, row)) {
    return fail(
      422,
      'evidence_mismatch',
      'sourceUrl must be on the same host as the offer sourceUrl or officialUrl',
    );
  }
  return null;
}

export const transitionOffer: Handler = async ({ db, client, now, body }, [id, actionParam]) => {
  const action = ACTIONS.find((a) => a === actionParam);
  if (!action) return notFound();
  if (!scopeMayAttempt(client.scope, action)) return forbidden();
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const { sourceUrl, verified = false } = parsed.data;
  if (verified && action !== 'publish') {
    return fail(400, 'invalid_body', 'verified is only accepted by publish', {
      details: [{ path: 'verified', message: 'Only allowed for publish' }],
    });
  }
  const row = await getOfferRow(db, id ?? '');
  if (!row) return notFound();
  const result = planTransition(client.scope, action, row.status);
  if (!result.ok) {
    return result.reason === 'forbidden'
      ? forbidden()
      : fail(409, 'invalid_state', `Cannot ${action} an offer that is ${row.status}`);
  }
  // verify only refreshes the date, so legacy offers without a guide can still be verified.
  if (result.to === 'published' && action !== 'verify') {
    const broken = guideRule(contentOf(toManagedOffer(row)));
    if (broken) return broken;
  }
  const verifies = recordsVerification(action, verified);
  const badEvidence = await checkEvidence(db, row, action, sourceUrl, verifies);
  if (badEvidence) return badEvidence;
  if (action === 'expire' && client.scope === 'inspector') {
    const limited = await consumeRateLimit(db, `${client.id}:expire`, now, INSPECTOR_EXPIRE_LIMIT);
    if (!limited.ok) {
      return fail(429, 'rate_limited', 'Too many expirations; a human should review', {
        headers: { 'retry-after': String(limited.retryAfter) },
      });
    }
  }

  const at = now.toISOString();
  const verifiedAt = verifies ? at : row.last_verified_at;
  const statement = db
    .prepare(
      `UPDATE offers SET status = ?, last_verified_at = ?, updated_at = ?
       WHERE id = ? AND status = ? AND version = ?`,
    )
    .bind(result.to, verifiedAt, at, row.id, row.status, row.version);
  const after = toManagedOffer(
    nextRow(row, { status: result.to, last_verified_at: verifiedAt, updated_at: at }),
  );
  return plan({
    steps: [{ statement, guarded: true }],
    audit: {
      action: `offer.${action}`,
      entityType: 'offer',
      entityId: row.id,
      before: toManagedOffer(row),
      after,
      sourceUrl: sourceUrl ?? null,
    },
    status: 200,
    data: after,
  });
};

const isStatus = (value: string): value is Status =>
  (STATUSES as readonly string[]).includes(value);

export const listManagedOffers: Handler = async ({ db, url }) => {
  const status = url.searchParams.get('status');
  if (status !== null && !isStatus(status)) return fail(400, 'invalid_query', 'Unknown status');
  const limit = parseIntParam(url.searchParams.get('limit'), 50, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  if (limit === null || offset === null) return fail(400, 'invalid_query', 'Invalid paging');
  const { rows, total } = await listOfferRows(db, status ?? undefined, limit, offset);
  return ok(rows.map(toManagedOffer), { meta: { total, limit, offset } });
};

export const getManagedOffer: Handler = async ({ db }, [id]) => {
  if (!slugSchema.safeParse(id).success) return notFound();
  const row = await getOfferRow(db, id ?? '');
  return row ? ok(toManagedOffer(row)) : notFound();
};
