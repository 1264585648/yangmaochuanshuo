/* One pack opening: the server draw runs alongside the opening animation.
   Keeps the idempotency key of a draw whose outcome is unknown, so retrying
   replays it instead of spending another draw. */
import { ApiError } from '../api/client.js';
import { attemptFor, isSettled, newDrawKey } from '../domain/draw-attempt.js';
import { normalizeQuota } from '../domain/me.js';

/**
 * @typedef {import('../domain/me.js').DrawResult} DrawReply
 * @typedef {{ kind: 'drawn', result: DrawReply }
 *   | { kind: 'empty' }
 *   | { kind: 'exhausted', quota: import('../domain/me.js').Quota | null }
 *   | { kind: 'failed', error: unknown, unknownOutcome: boolean }} DrawOutcome
 */

/**
 * @param {{ draw: (pool: string, key: string) => Promise<DrawReply>, makeKey?: () => string }} deps
 */
export function createDrawFlow({ draw, makeKey = newDrawKey }) {
  /**
   * Attempts whose outcome is unknown, per pool: switching pools must not
   * forget a draw the server may already have recorded.
   * @type {Map<string, import('../domain/draw-attempt.js').DrawAttempt>}
   */
  const pending = new Map();

  /**
   * @param {string} pool
   * @param {Promise<unknown>} animation Resolves when the opening sequence may end.
   * @returns {Promise<DrawOutcome>}
   */
  async function open(pool, animation) {
    const attempt = attemptFor(pending.get(pool) ?? null, pool, makeKey);
    pending.set(pool, attempt);
    const [settled] = await Promise.all([
      draw(pool, attempt.key).then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error }),
      ),
      animation,
    ]);
    if (isSettled(settled.error)) pending.delete(pool);
    if (settled.result) return { kind: 'drawn', result: settled.result };

    const { error } = settled;
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'pool_empty') return { kind: 'empty' };
    if (code === 'quota_exhausted') {
      return { kind: 'exhausted', quota: normalizeQuota(error.details) };
    }
    return { kind: 'failed', error, unknownOutcome: !isSettled(error) };
  }

  return { open };
}
