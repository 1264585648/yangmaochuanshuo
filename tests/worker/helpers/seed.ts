type D1Database = Env['DB'];

const TS = '2026-11-01T00:00:00Z';

export interface SeedOffer {
  id: string;
  providerId?: string;
  pool?: string;
  rarity?: string;
  title?: string;
  summary?: string;
  status?: string;
  validFrom?: string | null;
  validUntil?: string | null;
  newUsersOnly?: boolean;
  studentOnly?: boolean;
  requiresPaymentMethod?: boolean;
  autoRenews?: boolean;
  regions?: string[];
  lastVerifiedAt?: string | null;
}

export async function seedProvider(
  db: D1Database,
  id = 'example',
  name = 'Example',
  domains: string[] = ['example.com'],
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO providers (id, name, official_domains, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, name, JSON.stringify(domains), TS, TS)
    .run();
}

export async function seedOffers(db: D1Database, offers: SeedOffer[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO offers (id, provider_id, pool, rarity, title, summary, benefit, official_url,
       source_url, new_users_only, student_only, requires_payment_method, auto_renews, regions,
       conditions_note, status, valid_from, valid_until, last_verified_at, created_by, created_at,
       updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'benefit', 'https://www.example.com/deal',
       'https://docs.example.com/deal', ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'seed', ?, ?)`,
  );
  await db.batch(
    offers.map((o) =>
      stmt.bind(
        o.id,
        o.providerId ?? 'example',
        o.pool ?? 'ai',
        o.rarity ?? 'A',
        o.title ?? `Offer ${o.id}`,
        o.summary ?? 'summary',
        o.newUsersOnly ? 1 : 0,
        o.studentOnly ? 1 : 0,
        o.requiresPaymentMethod ? 1 : 0,
        o.autoRenews ? 1 : 0,
        JSON.stringify(o.regions ?? []),
        o.status ?? 'published',
        o.validFrom ?? null,
        o.validUntil ?? null,
        o.lastVerifiedAt === undefined ? '2026-11-10T08:00:00Z' : o.lastVerifiedAt,
        TS,
        TS,
      ),
    ),
  );
}
