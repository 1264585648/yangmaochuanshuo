/* Interest labels on offer cards. Only real signals are shown: a count of
   people who opened the official page (the server sends it only once it is
   large enough to mean something), or "新上架" for recently published offers.
   Nothing is shown otherwise. */
import { escapeHTML as e } from './escape.js';

/** How long an offer counts as newly listed. */
export const NEW_OFFER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ publishedAt: string | null, officialVisitors: number | null }} offer
 * @param {Date} now
 * @returns {{ kind: 'hot' | 'new', label: string } | null}
 */
export function popularity(offer, now) {
  if (offer.officialVisitors) {
    return { kind: 'hot', label: `${offer.officialVisitors} 人看过官方页面` };
  }
  const published = offer.publishedAt ? Date.parse(offer.publishedAt) : Number.NaN;
  if (Number.isFinite(published) && now.getTime() - published < NEW_OFFER_DAYS * DAY_MS) {
    return { kind: 'new', label: '新上架' };
  }
  return null;
}

/**
 * @param {{ publishedAt: string | null, officialVisitors: number | null }} offer
 * @param {Date} [now]
 * @returns {string} A badge, or '' when there is nothing true to say.
 */
export function popularityBadge(offer, now = new Date()) {
  const p = popularity(offer, now);
  return p ? `<span class="pop-badge is-${p.kind}">${e(p.label)}</span>` : '';
}
