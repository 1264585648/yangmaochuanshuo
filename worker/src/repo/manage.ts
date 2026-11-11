import type { OfferCreate } from '../domain/schema';
import type { Status } from '../domain/status';
import { toPublicOffer, type OfferRow, type PublicOffer } from './offers';

type DB = Env['DB'];

/** Editable offer content: everything a caller may set except id and provider. */
export type OfferContent = Omit<OfferCreate, 'id' | 'providerId'>;

export const CONTENT_KEYS = [
  'pool',
  'rarity',
  'title',
  'summary',
  'benefit',
  'officialUrl',
  'sourceUrl',
  'conditions',
  'validFrom',
  'validUntil',
] as const satisfies readonly (keyof OfferContent)[];

export interface ManagedOffer extends PublicOffer {
  status: Status;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface FullOfferRow extends OfferRow {
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function toManagedOffer(row: FullOfferRow): ManagedOffer {
  return {
    ...toPublicOffer(row),
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function contentOf(offer: PublicOffer): OfferContent {
  return {
    pool: offer.pool as OfferContent['pool'],
    rarity: offer.rarity as OfferContent['rarity'],
    title: offer.title,
    summary: offer.summary,
    benefit: offer.benefit,
    officialUrl: offer.officialUrl,
    sourceUrl: offer.sourceUrl,
    conditions: offer.conditions,
    validFrom: offer.validFrom,
    validUntil: offer.validUntil,
  };
}

/** Column values for the content part of an offers row, in CONTENT_COLUMNS order. */
export const CONTENT_COLUMNS = [
  'pool',
  'rarity',
  'title',
  'summary',
  'benefit',
  'official_url',
  'source_url',
  'new_users_only',
  'student_only',
  'requires_payment_method',
  'auto_renews',
  'regions',
  'conditions_note',
  'valid_from',
  'valid_until',
] as const;

export function contentColumns(c: OfferContent) {
  return {
    pool: c.pool,
    rarity: c.rarity,
    title: c.title,
    summary: c.summary,
    benefit: c.benefit,
    official_url: c.officialUrl,
    source_url: c.sourceUrl,
    new_users_only: c.conditions.newUsersOnly ? 1 : 0,
    student_only: c.conditions.studentOnly ? 1 : 0,
    requires_payment_method: c.conditions.requiresPaymentMethod ? 1 : 0,
    auto_renews: c.conditions.autoRenews ? 1 : 0,
    regions: JSON.stringify(c.conditions.regions),
    conditions_note: c.conditions.note,
    valid_from: c.validFrom,
    valid_until: c.validUntil,
  };
}

/** Row as it will look after a write, for responses and audit snapshots. */
export function nextRow(base: FullOfferRow, changes: Partial<FullOfferRow>): FullOfferRow {
  return { ...base, ...changes };
}

export async function getOfferRow(db: DB, id: string): Promise<FullOfferRow | null> {
  return db
    .prepare(
      'SELECT o.*, p.name AS provider_name FROM offers o JOIN providers p ON p.id = o.provider_id WHERE o.id = ?',
    )
    .bind(id)
    .first<FullOfferRow>();
}

export async function listOfferRows(
  db: DB,
  status: Status | undefined,
  limit: number,
  offset: number,
): Promise<{ rows: FullOfferRow[]; total: number }> {
  const where = status ? 'WHERE o.status = ?1' : '';
  const binds = status ? [status] : [];
  const n = binds.length;
  const [page, count] = await db.batch([
    db
      .prepare(
        `SELECT o.*, p.name AS provider_name FROM offers o JOIN providers p ON p.id = o.provider_id
         ${where} ORDER BY o.updated_at DESC, o.id LIMIT ?${n + 1} OFFSET ?${n + 2}`,
      )
      .bind(...binds, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM offers o ${where}`).bind(...binds),
  ]);
  return {
    rows: (page?.results ?? []) as FullOfferRow[],
    total: Number((count?.results?.[0] as { total?: number } | undefined)?.total ?? 0),
  };
}

export type { FullOfferRow };

export interface ProviderRecord {
  id: string;
  name: string;
  officialDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export async function getProvider(db: DB, id: string): Promise<ProviderRecord | null> {
  const row = await db.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first<{
    id: string;
    name: string;
    official_domains: string;
    created_at: string;
    updated_at: string;
  }>();
  if (!row) return null;
  const domains: unknown = JSON.parse(row.official_domains);
  return {
    id: row.id,
    name: row.name,
    officialDomains: Array.isArray(domains)
      ? domains.filter((d): d is string => typeof d === 'string')
      : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ChangeRecord {
  id: string;
  offerId: string;
  changes: Record<string, unknown>;
  sourceUrl: string;
  baseVersion: number;
  status: 'pending' | 'applied' | 'rejected';
  createdBy: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

interface ChangeRow {
  id: string;
  offer_id: string;
  patch: string;
  source_url: string;
  base_version: number;
  status: ChangeRecord['status'];
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

const toChange = (r: ChangeRow): ChangeRecord => ({
  id: r.id,
  offerId: r.offer_id,
  changes: JSON.parse(r.patch) as Record<string, unknown>,
  sourceUrl: r.source_url,
  baseVersion: r.base_version,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
});

export async function getChange(db: DB, id: string): Promise<ChangeRecord | null> {
  const row = await db
    .prepare('SELECT * FROM offer_changes WHERE id = ?')
    .bind(id)
    .first<ChangeRow>();
  return row ? toChange(row) : null;
}

export async function listChanges(
  db: DB,
  filters: { status?: string; offerId?: string },
  limit: number,
): Promise<ChangeRecord[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filters.status) {
    binds.push(filters.status);
    clauses.push(`status = ?${binds.length}`);
  }
  if (filters.offerId) {
    binds.push(filters.offerId);
    clauses.push(`offer_id = ?${binds.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await db
    .prepare(
      `SELECT * FROM offer_changes ${where} ORDER BY created_at DESC, id LIMIT ?${binds.length + 1}`,
    )
    .bind(...binds, limit)
    .all<ChangeRow>();
  return results.map(toChange);
}

export interface AuditRecord {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  sourceUrl: string | null;
  createdAt: string;
}

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: string | null;
  after: string | null;
  source_url: string | null;
  created_at: string;
}

const toAudit = (r: AuditRow): AuditRecord => ({
  id: r.id,
  actor: r.actor,
  action: r.action,
  entityType: r.entity_type,
  entityId: r.entity_id,
  before: r.before === null ? null : JSON.parse(r.before),
  after: r.after === null ? null : JSON.parse(r.after),
  sourceUrl: r.source_url,
  createdAt: r.created_at,
});

export async function getAudit(db: DB, id: number): Promise<AuditRecord | null> {
  const row = await db.prepare('SELECT * FROM audit_log WHERE id = ?').bind(id).first<AuditRow>();
  return row ? toAudit(row) : null;
}

export async function listAudit(
  db: DB,
  filters: { entityType?: string; entityId?: string },
  limit: number,
): Promise<AuditRecord[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filters.entityType) {
    binds.push(filters.entityType);
    clauses.push(`entity_type = ?${binds.length}`);
  }
  if (filters.entityId) {
    binds.push(filters.entityId);
    clauses.push(`entity_id = ?${binds.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?${binds.length + 1}`)
    .bind(...binds, limit)
    .all<AuditRow>();
  return results.map(toAudit);
}
