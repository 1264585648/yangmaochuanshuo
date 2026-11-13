/* Client for the cookie-authenticated user API: identity, quota, draws,
   collection, history, favorites and the one-time legacy import. Every reply
   is validated; a malformed one rejects with an `invalid` ApiError. */
import { ApiError } from './client.js';
import {
  normalizeCollection,
  normalizeDrawResult,
  normalizeHistory,
  normalizeMe,
} from '../domain/me.js';
import { normalizeWonPrizes } from '../domain/prize.js';

/**
 * @template T
 * @param {T | null} value
 * @param {string} what
 * @returns {T}
 */
function expectValid(value, what) {
  if (value === null) throw new ApiError('invalid', `${what} has an unexpected shape`);
  return value;
}

/**
 * @param {{ request: ReturnType<typeof import('./client.js').createApiClient>['request'] }} api
 */
export function createMeClient({ request }) {
  return {
    /** @param {{ signal?: AbortSignal }} [options] */
    async getMe(options = {}) {
      const { data } = await request('/api/me', options);
      return expectValid(normalizeMe(data), 'Profile');
    },

    /**
     * @param {string} pool
     * @param {string} key Idempotency key; reuse it to retry an unknown outcome.
     */
    async draw(pool, key) {
      const { data } = await request('/api/draws', {
        method: 'POST',
        body: { pool },
        headers: { 'idempotency-key': key },
      });
      return expectValid(normalizeDrawResult(data), 'Draw');
    },

    async getCollection() {
      const { data } = await request('/api/me/collection');
      return expectValid(normalizeCollection(data), 'Collection');
    },

    /** Limited prizes this user won, codes included. */
    async getMyPrizes() {
      const { data } = await request('/api/me/prizes');
      return expectValid(normalizeWonPrizes(data), 'Prizes');
    },

    /** @param {string | null} [before] Cursor from the previous page. */
    async getHistory(before = null) {
      const query = before ? `?before=${encodeURIComponent(before)}` : '';
      const { data } = await request(`/api/me/draws${query}`);
      return expectValid(normalizeHistory(data), 'History');
    },

    /** @param {string} offerId @param {boolean} favorite */
    async setFavorite(offerId, favorite) {
      await request(`/api/me/favorites/${encodeURIComponent(offerId)}`, {
        method: favorite ? 'PUT' : 'DELETE',
      });
      return favorite;
    },

    /**
     * @param {{ collection: { id: string, ts: number }[], favorites: string[] }} payload
     * @returns {Promise<{ imported: number, favorites: number }>}
     */
    async importLegacy(payload) {
      const { data } = await request('/api/me/import', { method: 'POST', body: payload });
      const valid =
        data !== null &&
        typeof data === 'object' &&
        Number.isInteger(data.imported) &&
        Number.isInteger(data.favorites);
      return expectValid(
        valid ? { imported: data.imported, favorites: data.favorites } : null,
        'Import',
      );
    },
  };
}
