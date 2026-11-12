import type { z } from 'zod';
import type { Client } from '../../auth/tokens';
import { INSPECTOR_PENDING_CAP, MAX_OFFSET } from '../../config';
import { guideOfficialUrls, guideRuleViolation } from '../../domain/guide';
import { offerCreateSchema, type OfferPatch } from '../../domain/schema';
import { isOfficialUrl } from '../../domain/urls';
import { fail } from '../../http/respond';
import type { WritePlan } from '../../write/commit';
import {
  CONTENT_COLUMNS,
  contentColumns,
  contentOf,
  getProvider,
  nextRow,
  toManagedOffer,
  type FullOfferRow,
  type ManagedOffer,
  type OfferContent,
  type ProviderRecord,
} from '../../repo/manage';

export type DB = Env['DB'];
type Statement = ReturnType<DB['prepare']>;

export interface ManageRequest {
  db: DB;
  client: Client;
  now: Date;
  body: unknown;
  url: URL;
}

export type HandlerResult = Response | WritePlan;
export type Handler = (req: ManageRequest, params: string[]) => Promise<HandlerResult>;

export const forbidden = () => fail(403, 'forbidden', 'This token is not allowed to do that');

export const invalid = (error: z.ZodError) =>
  fail(400, 'invalid_body', 'Request body failed validation', {
    details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });

export const unofficial = (field: string) =>
  fail(422, 'unofficial_url', `${field} must be on one of the provider's official domains`);

export const VERSION_CONFLICT = {
  code: 'version_conflict',
  message: 'The offer changed since baseVersion; reload and retry',
};

/** Load the provider and check every URL against its registered domains. */
export async function checkOfficial(
  db: DB,
  providerId: string,
  urls: Record<string, string | undefined>,
): Promise<{ ok: true; provider: ProviderRecord } | { ok: false; response: Response }> {
  const provider = await getProvider(db, providerId);
  if (!provider) {
    return { ok: false, response: fail(422, 'unknown_provider', 'providerId does not exist') };
  }
  for (const [field, url] of Object.entries(urls)) {
    if (url !== undefined && !isOfficialUrl(url, provider.officialDomains)) {
      return { ok: false, response: unofficial(field) };
    }
  }
  return { ok: true, provider };
}

const hostOf = (url: string) => new URL(url).hostname.toLowerCase();

/**
 * Evidence for verify/expire must come from the same host as the offer's own
 * source or official link, not merely any page on the provider's domains.
 */
export function evidenceMatchesOffer(evidence: string, row: FullOfferRow): boolean {
  const host = hostOf(evidence);
  return host === hostOf(row.source_url) || host === hostOf(row.official_url);
}

/**
 * Apply a patch to the current content and validate the result as a whole,
 * so cross-field rules (validity window) hold after partial edits.
 */
export function mergeContent(
  row: FullOfferRow,
  changes: OfferPatch,
): { ok: true; content: OfferContent } | { ok: false; response: Response } {
  const merged = {
    id: row.id,
    providerId: row.provider_id,
    ...contentOf(toManagedOffer(row)),
    ...changes,
  };
  const parsed = offerCreateSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, response: invalid(parsed.error) };
  const { id: _id, providerId: _providerId, ...content } = parsed.data;
  return { ok: true, content };
}

/** True when writing `content` would leave every content column as it is. */
export function isUnchanged(row: FullOfferRow, content: OfferContent): boolean {
  const cols = contentColumns(content);
  return CONTENT_COLUMNS.every((c) => cols[c] === row[c]);
}

/** Every URL in the content that must sit on the provider's official domains. */
export function officialUrlsOf(content: OfferContent): Record<string, string> {
  return {
    officialUrl: content.officialUrl,
    sourceUrl: content.sourceUrl,
    ...guideOfficialUrls(content.guide),
  };
}

/** Rejects content that a published offer may not carry; null when fine. */
export function guideRule(content: OfferContent): Response | null {
  const violation = guideRuleViolation(content.rarity, content.guide);
  return violation ? fail(422, violation.code, violation.message) : null;
}

export const noChanges = () =>
  fail(422, 'no_changes', 'The requested content is identical to the current offer');

/**
 * Content update shared by edits, applied change requests and reverts. It is
 * conditional on the exact row that was read (version, status and
 * verification time), so the audit snapshot can never be stale.
 */
export function contentUpdate(
  db: DB,
  row: FullOfferRow,
  content: OfferContent,
  at: string,
): { statement: Statement; after: ManagedOffer } {
  const cols = contentColumns(content);
  const assignments = CONTENT_COLUMNS.map((c) => `${c} = ?`).join(', ');
  const statement = db
    .prepare(
      `UPDATE offers SET ${assignments}, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND status = ? AND last_verified_at IS ?`,
    )
    .bind(
      ...CONTENT_COLUMNS.map((c) => cols[c]),
      at,
      row.id,
      row.version,
      row.status,
      row.last_verified_at,
    );
  const after = toManagedOffer(nextRow(row, { ...cols, version: row.version + 1, updated_at: at }));
  return { statement, after };
}

/** Inspectors may not bury the human review queue. */
export async function reviewQueueFull(db: DB, client: Client): Promise<Response | null> {
  if (client.scope !== 'inspector') return null;
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM offers WHERE created_by = ?1 AND status = 'pending_review') +
         (SELECT COUNT(*) FROM offer_changes WHERE created_by = ?1 AND status = 'pending') AS n`,
    )
    .bind(client.id)
    .first<{ n: number }>();
  if (Number(row?.n ?? 0) < INSPECTOR_PENDING_CAP) return null;
  return fail(
    429,
    'review_queue_full',
    `This token already has ${INSPECTOR_PENDING_CAP} items awaiting review`,
  );
}

export function parseIntParam(value: string | null, fallback: number, max: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= max ? n : null;
}

export function parseOffset(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_OFFSET ? n : null;
}
