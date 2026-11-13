/* Client for the beta endpoints: official-link clicks, feedback and the
   community group. Click reporting is best-effort and never throws. */
import { ApiError } from './client.js';
import { safeHttpsUrl } from '../ui/format.js';

/**
 * @typedef {object} Community
 * @property {string} title
 * @property {string} description
 * @property {string | null} link Checked https URL.
 * @property {string} linkLabel
 * @property {{ src: string, expiresAt: string | null } | null} qr Same-origin image path.
 */

/**
 * @typedef {{ kind: 'offer', offerId: string, category: string, message: string, contact: string }
 *   | { kind: 'general', category: string, message: string, contact: string }} FeedbackPayload
 */

const isObject = (v) => v !== null && typeof v === 'object';
const isString = (v) => typeof v === 'string';
const QR_SRC = /^\/api\/community\/qr\?v=[0-9a-f]{1,64}$/;

/**
 * @param {unknown} raw
 * @returns {Community | null} null for "no group", or a malformed reply.
 */
export function normalizeCommunity(raw) {
  if (!isObject(raw)) return null;
  const { title, description, link, linkLabel, qr } = /** @type {Record<string, unknown>} */ (raw);
  if (!isString(title) || !title.trim() || !isString(description)) return null;
  const safeLink = isString(link) ? safeHttpsUrl(link) : null;
  const image =
    isObject(qr) && isString(qr.src) && QR_SRC.test(qr.src)
      ? { src: qr.src, expiresAt: isString(qr.expiresAt) ? qr.expiresAt : null }
      : null;
  if (!safeLink && !image) return null;
  return Object.freeze({
    title,
    description,
    link: safeLink,
    linkLabel: isString(linkLabel) ? linkLabel : '',
    qr: image ? Object.freeze(image) : null,
  });
}

/**
 * @param {{ request: ReturnType<typeof import('./client.js').createApiClient>['request'],
 *   baseUrl?: string, fetchImpl?: typeof fetch }} options
 */
export function createEngagementClient({ request, baseUrl = '', fetchImpl }) {
  const doFetch = (...args) => (fetchImpl ?? globalThis.fetch)(...args);

  return {
    /**
     * Count a visit to an offer's official page. `keepalive` lets the request
     * finish when the browser leaves the page (WeChat opens links in place).
     * @param {string} offerId
     * @returns {Promise<void>}
     */
    async trackOfficialClick(offerId) {
      try {
        await doFetch(`${baseUrl}/api/offers/${encodeURIComponent(offerId)}/click`, {
          method: 'POST',
          keepalive: true,
          credentials: 'same-origin',
        });
      } catch {
        // Stats are best-effort; the link opens regardless.
      }
    },

    /**
     * @param {FeedbackPayload} payload
     * @returns {Promise<{ id: number }>}
     */
    async sendFeedback(payload) {
      const { data } = await request('/api/feedback', { method: 'POST', body: payload });
      if (!isObject(data) || !Number.isInteger(data.id)) {
        throw new ApiError('invalid', 'Feedback reply has an unexpected shape');
      }
      return { id: data.id };
    },

    /** @returns {Promise<Community | null>} */
    async getCommunity() {
      const { data } = await request('/api/community');
      return normalizeCommunity(data);
    },
  };
}
