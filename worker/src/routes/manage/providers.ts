import { notFound, ok } from '../../http/respond';
import { providerSchema } from '../../domain/schema';
import { canManageProviders } from '../../domain/status';
import { getProvider, listProviders, type ProviderRecord } from '../../repo/manage';
import { plan } from '../../write/commit';
import { forbidden, invalid, type Handler } from './shared';

export const listProvidersHandler: Handler = async ({ db }) => ok(await listProviders(db));

const providerUpdateSchema = providerSchema
  .pick({ name: true, officialDomains: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'update must change at least one field');

export const createProvider: Handler = async ({ db, client, now, body }) => {
  if (!canManageProviders(client.scope)) return forbidden();
  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const at = now.toISOString();
  const provider: ProviderRecord = { ...parsed.data, createdAt: at, updatedAt: at };
  const statement = db
    .prepare(
      'INSERT INTO providers (id, name, official_domains, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(provider.id, provider.name, JSON.stringify(provider.officialDomains), at, at);
  return plan({
    steps: [{ statement }],
    audit: {
      action: 'provider.create',
      entityType: 'provider',
      entityId: provider.id,
      before: null,
      after: provider,
    },
    status: 201,
    data: provider,
  });
};

export const updateProvider: Handler = async ({ db, client, now, body }, [id]) => {
  if (!canManageProviders(client.scope)) return forbidden();
  const parsed = providerUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const current = await getProvider(db, id ?? '');
  if (!current) return notFound();
  const at = now.toISOString();
  const next: ProviderRecord = { ...current, ...parsed.data, updatedAt: at };
  const statement = db
    .prepare(
      `UPDATE providers SET name = ?, official_domains = ?, updated_at = ?
       WHERE id = ? AND name = ? AND official_domains = ?`,
    )
    .bind(
      next.name,
      JSON.stringify(next.officialDomains),
      at,
      current.id,
      current.name,
      JSON.stringify(current.officialDomains),
    );
  return plan({
    steps: [{ statement, guarded: true }],
    audit: {
      action: 'provider.update',
      entityType: 'provider',
      entityId: current.id,
      before: current,
      after: next,
    },
    status: 200,
    data: next,
  });
};
