import type { ListQuery } from '../domain/query';
import type { Conditions } from '../domain/schema';
import type { Status } from '../domain/status';
import { PUBLIC_OFFER_SQL } from '../domain/visibility';

type DB = Env['DB'];

/** Raw `offers` row joined with the provider name. */
export interface OfferRow {
  id: string;
  provider_id: string;
  provider_name: string;
  pool: string;
  rarity: string;
  title: string;
  summary: string;
  benefit: string;
  official_url: string;
  source_url: string;
  new_users_only: number;
  student_only: number;
  requires_payment_method: number;
  auto_renews: number;
  regions: string;
  conditions_note: string;
  status: Status;
  valid_from: string | null;
  valid_until: string | null;
  last_verified_at: string | null;
  version: number;
}

export interface PublicOffer {
  id: string;
  provider: { id: string; name: string };
  pool: string;
  rarity: string;
  title: string;
  summary: string;
  benefit: string;
  officialUrl: string;
  sourceUrl: string;
  conditions: Conditions;
  validFrom: string | null;
  validUntil: string | null;
  lastVerifiedAt: string | null;
}

function parseRegions(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function toPublicOffer(row: OfferRow): PublicOffer {
  return {
    id: row.id,
    provider: { id: row.provider_id, name: row.provider_name },
    pool: row.pool,
    rarity: row.rarity,
    title: row.title,
    summary: row.summary,
    benefit: row.benefit,
    officialUrl: row.official_url,
    sourceUrl: row.source_url,
    conditions: {
      newUsersOnly: row.new_users_only === 1,
      studentOnly: row.student_only === 1,
      requiresPaymentMethod: row.requires_payment_method === 1,
      autoRenews: row.auto_renews === 1,
      regions: parseRegions(row.regions),
      note: row.conditions_note,
    },
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastVerifiedAt: row.last_verified_at,
  };
}

const SELECT_OFFER = `SELECT o.*, p.name AS provider_name FROM offers o JOIN providers p ON p.id = o.provider_id`;

/** Qualify the shared visibility fragment with the offers alias. */
const PUBLIC_WHERE = PUBLIC_OFFER_SQL.replace(/\b(status|valid_from|valid_until)\b/g, 'o.$1');

const RARITY_ORDER = `CASE o.rarity WHEN 'SSR' THEN 0 WHEN 'S' THEN 1 ELSE 2 END`;

const FLAG_COLUMNS = {
  newUsersOnly: 'o.new_users_only',
  studentOnly: 'o.student_only',
  requiresPaymentMethod: 'o.requires_payment_method',
  autoRenews: 'o.auto_renews',
} as const;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Build WHERE clauses and bindings. `?1` is always today's UTC date. */
function buildFilters(query: ListQuery, today: string): { where: string; binds: unknown[] } {
  const clauses = [PUBLIC_WHERE];
  const binds: unknown[] = [today];
  const add = (clause: string, value: unknown) => {
    binds.push(value);
    clauses.push(clause.replaceAll('?', `?${binds.length}`));
  };
  if (query.pool) add('o.pool = ?', query.pool);
  if (query.rarity) add('o.rarity = ?', query.rarity);
  if (query.provider) add('o.provider_id = ?', query.provider);
  for (const [key, column] of Object.entries(FLAG_COLUMNS)) {
    const value = query[key as keyof typeof FLAG_COLUMNS];
    if (value !== undefined) add(`${column} = ?`, value ? 1 : 0);
  }
  if (query.q) {
    add(
      `(o.title LIKE ? ESCAPE '\\' OR o.summary LIKE ? ESCAPE '\\' OR o.benefit LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')`,
      `%${escapeLike(query.q)}%`,
    );
  }
  return { where: clauses.join(' AND '), binds };
}

export async function listPublicOffers(
  db: DB,
  query: ListQuery,
  today: string,
): Promise<{ offers: PublicOffer[]; total: number }> {
  const { where, binds } = buildFilters(query, today);
  const limitIndex = binds.length + 1;
  const [page, count] = await db.batch([
    db
      .prepare(
        `${SELECT_OFFER} WHERE ${where} ORDER BY ${RARITY_ORDER}, o.title, o.id LIMIT ?${limitIndex} OFFSET ?${limitIndex + 1}`,
      )
      .bind(...binds, query.limit, query.offset),
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM offers o JOIN providers p ON p.id = o.provider_id WHERE ${where}`,
      )
      .bind(...binds),
  ]);
  const rows = (page?.results ?? []) as OfferRow[];
  const total = Number((count?.results?.[0] as { total?: number } | undefined)?.total ?? 0);
  return { offers: rows.map(toPublicOffer), total };
}

export async function getPublicOffer(
  db: DB,
  id: string,
  today: string,
): Promise<PublicOffer | null> {
  const row = await db
    .prepare(`${SELECT_OFFER} WHERE ${PUBLIC_WHERE} AND o.id = ?2`)
    .bind(today, id)
    .first<OfferRow>();
  return row ? toPublicOffer(row) : null;
}
