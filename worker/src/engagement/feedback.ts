/* Visitor feedback: problems with one offer, or the site in general. Stored
 * as plain text and only ever shown escaped in /admin. */
import { z } from 'zod';

type DB = Env['DB'];

export const OFFER_ISSUES = ['expired', 'wrong_info', 'link_broken', 'other'] as const;
export const GENERAL_TOPICS = ['suggestion', 'bug', 'want_offer', 'other'] as const;
export const FEEDBACK_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const MESSAGE_MAX = 1000;
const CONTACT_MAX = 100;
const NOTE_MAX = 500;

const text = (max: number) => z.string().trim().max(max);

export const feedbackSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('offer'),
    offerId: z.string().min(1).max(100),
    category: z.enum(OFFER_ISSUES),
    message: text(MESSAGE_MAX).default(''),
    contact: text(CONTACT_MAX).default(''),
  }),
  z.strictObject({
    kind: z.literal('general'),
    category: z.enum(GENERAL_TOPICS),
    message: text(MESSAGE_MAX).min(2),
    contact: text(CONTACT_MAX).default(''),
  }),
]);

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export const feedbackActionSchema = z.strictObject({ note: text(NOTE_MAX).optional() });

export interface FeedbackRecord {
  id: number;
  kind: 'offer' | 'general';
  offer: { id: string; title: string } | null;
  category: string;
  message: string;
  contact: string;
  status: FeedbackStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface FeedbackRow {
  id: number;
  kind: 'offer' | 'general';
  offer_id: string | null;
  offer_title: string | null;
  category: string;
  message: string;
  contact: string;
  status: FeedbackStatus;
  note: string;
  created_at: string;
  updated_at: string;
}

const toRecord = (r: FeedbackRow): FeedbackRecord => ({
  id: r.id,
  kind: r.kind,
  offer: r.offer_id ? { id: r.offer_id, title: r.offer_title ?? r.offer_id } : null,
  category: r.category,
  message: r.message,
  contact: r.contact,
  status: r.status,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Store one submission. An offer report must name an existing offer (any
 * status: people report withdrawn cards too). Returns null when it does not.
 */
export async function insertFeedback(
  db: DB,
  input: FeedbackInput,
  now: Date,
): Promise<{ id: number } | null> {
  const at = now.toISOString();
  const offerId = input.kind === 'offer' ? input.offerId : null;
  const row = await db
    .prepare(
      `INSERT INTO feedback (kind, offer_id, category, message, contact, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6
       WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM offers WHERE id = ?2)
       RETURNING id`,
    )
    .bind(input.kind, offerId, input.category, input.message, input.contact, at)
    .first<{ id: number }>();
  return row ? { id: Number(row.id) } : null;
}

const SELECT_FEEDBACK = `SELECT f.*, o.title AS offer_title FROM feedback f
  LEFT JOIN offers o ON o.id = f.offer_id`;

export async function listFeedback(
  db: DB,
  { status, limit, offset }: { status: FeedbackStatus | null; limit: number; offset: number },
): Promise<{ items: FeedbackRecord[]; total: number }> {
  const where = status ? 'WHERE f.status = ?1' : 'WHERE ?1 IS NULL';
  const [page, count] = await db.batch([
    db
      .prepare(`${SELECT_FEEDBACK} ${where} ORDER BY f.id DESC LIMIT ?2 OFFSET ?3`)
      .bind(status, limit, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM feedback f ${where}`).bind(status),
  ]);
  return {
    items: ((page?.results ?? []) as FeedbackRow[]).map(toRecord),
    total: Number((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
}

export async function getFeedback(db: DB, id: number): Promise<FeedbackRecord | null> {
  const row = await db.prepare(`${SELECT_FEEDBACK} WHERE f.id = ?1`).bind(id).first<FeedbackRow>();
  return row ? toRecord(row) : null;
}

export async function countOpenFeedback(db: DB): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'")
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
