/* Idempotency for draws. A draw whose outcome is unknown (network error,
   timeout, 5xx, unreadable reply) may already be recorded on the server, so the
   next try must reuse its key: the server then replays the stored result
   instead of spending another draw. A definite answer ends the attempt. */
import { ApiError } from '../api/client.js';

/** @typedef {{ pool: string, key: string }} DrawAttempt */

/**
 * @param {DrawAttempt | null} pending Attempt left over from an unknown outcome.
 * @param {string} pool
 * @param {() => string} makeKey
 * @returns {DrawAttempt}
 */
export function attemptFor(pending, pool, makeKey) {
  return pending && pending.pool === pool ? pending : { pool, key: makeKey() };
}

/**
 * Whether an outcome is final. `null` means the request succeeded.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSettled(error) {
  if (error === null) return true;
  return (
    error instanceof ApiError &&
    error.kind === 'http' &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  );
}

/** Random idempotency key; letters, digits and `-` only, as the API requires. */
export function newDrawKey() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
