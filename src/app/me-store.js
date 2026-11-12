/* The caller's identity and daily quota, as the server reports them. Refreshes
   itself when the quota day rolls over (Beijing midnight) so a page left open
   overnight does not stay on "明日再来". */
import { describeError } from '../api/client.js';

/**
 * @typedef {import('../domain/me.js').Quota} Quota
 * @typedef {import('../domain/me.js').User} User
 * @typedef {{ status: 'idle' | 'loading' | 'ready' | 'error', user: User | null,
 *   quota: Quota | null, error: string | null }} MeState
 */

/** Refresh a moment after the reset so the server is already on the new day. */
const RESET_GRACE_MS = 1000;
/** setTimeout cannot wait longer than ~24.8 days; cap well below. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
/**
 * Shortest wait between automatic refreshes: also the retry delay after a
 * failure, and the guard against a loop when the client clock runs ahead.
 */
const MIN_TIMER_MS = 30 * 1000;

/**
 * @param {{
 *   load: () => Promise<{ user: User | null, quota: Quota }>,
 *   onChange: (state: MeState) => void,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 *   clearTimer?: (id: unknown) => void,
 * }} options
 */
export function createMeStore({
  load,
  onChange,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(/** @type {number} */ (id)),
}) {
  /** @type {MeState} */
  let state = { status: 'idle', user: null, quota: null, error: null };
  let timer = null;
  let inflight = null;
  /** Bumped by pushed quotas, so an older `/api/me` reply cannot overwrite them. */
  let generation = 0;

  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  /** @param {number} wait */
  function schedule(wait) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(
      () => {
        timer = null;
        refresh();
      },
      Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, wait)),
    );
  }

  const scheduleReset = () => {
    if (state.quota) schedule(state.quota.resetsAt - now() + RESET_GRACE_MS);
  };

  /** The quota is past its reset time, or was never loaded. */
  function isStale() {
    return !state.quota || now() >= state.quota.resetsAt;
  }

  /** Reload from the server; concurrent calls share one request. */
  function refresh() {
    if (inflight) return inflight;
    set({ status: state.quota ? state.status : 'loading' });
    const started = generation;
    inflight = load()
      .then(({ user, quota }) => {
        // A draw reply that arrived meanwhile is newer than this read.
        set({
          status: 'ready',
          user,
          quota: started === generation ? quota : state.quota,
          error: null,
        });
        scheduleReset();
      })
      .catch((error) => {
        set({ status: 'error', error: describeError(error) });
        if (isStale()) schedule(MIN_TIMER_MS);
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    get: () => state,
    refresh,
    isStale,
    /** @param {Quota} quota Fresh quota from a draw reply or a 429's details. */
    applyQuota(quota) {
      generation += 1;
      set({ quota });
      scheduleReset();
    },
  };
}
