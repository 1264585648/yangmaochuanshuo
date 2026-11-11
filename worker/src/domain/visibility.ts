import type { Status } from './status';

export interface VisibilityFields {
  status: Status;
  validFrom: string | null;
  validUntil: string | null;
}

/** Calendar date in UTC, YYYY-MM-DD. Validity windows are compared in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Must stay equivalent to PUBLIC_OFFER_SQL. */
export function isPubliclyVisible(offer: VisibilityFields, today: string): boolean {
  return (
    offer.status === 'published' &&
    (offer.validFrom === null || offer.validFrom <= today) &&
    (offer.validUntil === null || offer.validUntil >= today)
  );
}

/** WHERE fragment for public reads; bind `?1` to today's UTC date. */
export const PUBLIC_OFFER_SQL =
  "status = 'published' AND (valid_from IS NULL OR valid_from <= ?1) AND (valid_until IS NULL OR valid_until >= ?1)";
