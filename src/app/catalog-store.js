/* Holds the live catalog for the lobby: loading, error and freshness state. */

/**
 * @typedef {import('../domain/offer.js').Offer} Offer
 * @typedef {{ status: 'idle' | 'loading' | 'ready' | 'error', offers: readonly Offer[],
 *   error: unknown, loadedAt: number }} CatalogState
 */

/**
 * @param {{ load: (signal: AbortSignal) => Promise<Offer[]>, ttlMs: number,
 *   now?: () => number, onChange: (state: CatalogState) => void }} options
 */
export function createCatalogStore({ load, ttlMs, now = Date.now, onChange }) {
  /** @type {CatalogState} */
  let state = { status: 'idle', offers: [], error: null, loadedAt: 0 };
  /** @type {Promise<CatalogState> | null} */
  let inflight = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  /**
   * Fetch the catalog. Concurrent callers share one request. A failed refresh
   * keeps previously loaded offers so the lobby stays usable.
   * @returns {Promise<CatalogState>}
   */
  function refresh() {
    if (inflight) return inflight;
    const controller = new AbortController();
    const hadData = state.status === 'ready';
    if (!hadData) set({ status: 'loading', error: null });
    inflight = load(controller.signal)
      .then((offers) => {
        set({ status: 'ready', offers, error: null, loadedAt: now() });
        return state;
      })
      .catch((error) => {
        set(hadData ? { error } : { status: 'error', error });
        return state;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  /** Refresh only when the catalog is missing or older than the TTL. */
  function ensureFresh() {
    const fresh = state.status === 'ready' && now() - state.loadedAt < ttlMs;
    return fresh ? Promise.resolve(state) : refresh();
  }

  return { refresh, ensureFresh, get: () => state };
}
