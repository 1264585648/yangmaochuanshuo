/* Admin endpoints for the closed beta:
 *   GET  /api/manage/feedback?status=&limit=&offset=
 *   POST /api/manage/feedback/:id/(resolve|dismiss|reopen)   { note? }
 *   GET  /api/manage/stats/clicks?days=
 *   GET  /api/manage/community
 *   PUT  /api/manage/community
 * All admin scope. Status changes and settings go through `commit`, so they
 * are audited and idempotent like every other management write. */
import {
  communityUpdateSchema,
  communityWrites,
  prepareQr,
  readCommunity,
  type CommunitySettings,
  type ManagedCommunity,
  type PreparedQr,
} from '../../engagement/community';
import { readClickStats } from '../../engagement/clicks';
import {
  FEEDBACK_STATUSES,
  feedbackActionSchema,
  getFeedback,
  listFeedback,
  type FeedbackStatus,
} from '../../engagement/feedback';
import { fail, notFound, ok } from '../../http/respond';
import { quotaDay } from '../../users/day';
import { plan } from '../../write/commit';
import { forbidden, invalid, parseIntParam, parseOffset, type Handler } from './shared';

const DAY_MS = 24 * 60 * 60 * 1000;

const TRANSITIONS: Readonly<Record<string, { from: FeedbackStatus[]; to: FeedbackStatus }>> = {
  resolve: { from: ['open'], to: 'resolved' },
  dismiss: { from: ['open'], to: 'dismissed' },
  reopen: { from: ['resolved', 'dismissed'], to: 'open' },
};

const isFeedbackStatus = (v: string): v is FeedbackStatus =>
  (FEEDBACK_STATUSES as readonly string[]).includes(v);

export const listFeedbackHandler: Handler = async ({ db, client, url }) => {
  if (client.scope !== 'admin') return forbidden();
  const rawStatus = url.searchParams.get('status');
  if (rawStatus !== null && !isFeedbackStatus(rawStatus)) {
    return fail(400, 'invalid_query', 'Unknown status');
  }
  const limit = parseIntParam(url.searchParams.get('limit'), 50, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  if (limit === null || offset === null) return fail(400, 'invalid_query', 'Invalid paging');
  const { items, total } = await listFeedback(db, { status: rawStatus, limit, offset });
  return ok(items, { meta: { total, limit, offset } });
};

export const transitionFeedback: Handler = async ({ db, client, now, body }, [idParam, action]) => {
  if (client.scope !== 'admin') return forbidden();
  const rule = action && Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : undefined;
  const id = Number(idParam);
  if (!rule || !/^\d{1,15}$/.test(idParam ?? '') || !Number.isSafeInteger(id)) return notFound();
  const parsed = feedbackActionSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const current = await getFeedback(db, id);
  if (!current) return notFound();
  if (!rule.from.includes(current.status)) {
    return fail(409, 'invalid_state', `Cannot ${action} feedback that is ${current.status}`);
  }
  const at = now.toISOString();
  const note = parsed.data.note ?? current.note;
  const statement = db
    .prepare('UPDATE feedback SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status = ?')
    .bind(rule.to, note, at, id, current.status);
  const after = { ...current, status: rule.to, note, updatedAt: at };
  return plan({
    steps: [{ statement, guarded: true }],
    audit: {
      action: `feedback.${action}`,
      entityType: 'feedback',
      entityId: String(id),
      before: current,
      after,
    },
    status: 200,
    data: after,
  });
};

export const clickStatsHandler: Handler = async ({ db, client, now, url }) => {
  if (client.scope !== 'admin') return forbidden();
  const days = parseIntParam(url.searchParams.get('days'), 7, 90);
  if (days === null) return fail(400, 'invalid_query', 'days must be 1–90');
  const since = quotaDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return ok(await readClickStats(db, since));
};

export const getCommunityHandler: Handler = async ({ db, client }) => {
  if (client.scope !== 'admin') return forbidden();
  return ok(await readCommunity(db));
};

export const putCommunityHandler: Handler = async ({ db, client, now, body }) => {
  if (client.scope !== 'admin') return forbidden();
  const parsed = communityUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const { qr: upload, ...fields } = parsed.data;
  let qr: PreparedQr | null | undefined = upload === null ? null : undefined;
  if (upload) {
    const prepared = await prepareQr(upload.base64);
    if (!prepared.ok) return fail(422, 'invalid_image', prepared.message);
    qr = prepared.qr;
  }
  const before = await readCommunity(db);
  const settings: CommunitySettings = { ...fields, updatedAt: now.toISOString() };
  const keptQr = qr === undefined ? (before?.qr ?? null) : qr;
  const after: ManagedCommunity = {
    ...settings,
    qr: keptQr ? { sha256: keptQr.sha256, contentType: keptQr.contentType } : null,
  };
  if (after.enabled && !after.link && !after.qr) {
    return fail(422, 'nothing_to_show', 'An enabled group needs a link or a QR image');
  }
  return plan({
    steps: communityWrites(db, settings, qr).map((statement) => ({ statement })),
    audit: {
      action: 'community.update',
      entityType: 'setting',
      entityId: 'community',
      // The image is recorded by fingerprint only, never by content.
      before,
      after,
    },
    status: 200,
    data: after,
  });
};
