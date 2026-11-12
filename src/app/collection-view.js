/* Controller for the collection dialog: loads cards, progress and the first
   history page from the server, then wires detail views and paging. */
import { describeError } from '../api/client.js';
import { isRetired } from '../domain/me.js';
import {
  collectionDialog,
  collectionLoadingDialog,
  collectionUnavailableDialog,
  historyRows,
  retiredDetailDialog,
} from '../ui/collection-views.js';

/**
 * @typedef {import('../domain/me.js').CollectionCard} CollectionCard
 * @typedef {{ label: string, open: () => void }} BackLink
 */

const BACK_LABEL = '返回图鉴';

/**
 * Progress bar widths come from data attributes: the CSP allows no inline
 * `style`, but CSSOM changes are fine.
 * @param {ParentNode} root
 */
export function applyProgressWidths(root) {
  for (const fill of root.querySelectorAll('.progress-fill')) {
    const pct = Number(/** @type {HTMLElement} */ (fill).dataset.percent);
    if (Number.isFinite(pct)) {
      /** @type {HTMLElement} */ (fill).style.setProperty('width', `${Math.min(100, pct)}%`);
    }
  }
}

/**
 * @param {{
 *   me: ReturnType<typeof import('../api/me-client.js').createMeClient>,
 *   showView: (html: string, options?: { dispose?: (() => void) | null }) => void,
 *   root: () => HTMLElement,
 *   poolLabel: (poolId: string) => string,
 *   showDetail: (offer: import('../domain/offer.js').Offer, favorite: boolean, back: BackLink) => void,
 *   toast: (message: string) => void,
 * }} deps
 */
export function createCollectionView({ me, showView, root, poolLabel, showDetail, toast }) {
  const back = () => ({ label: BACK_LABEL, open });

  /** @param {CollectionCard} card */
  function openCard(card) {
    if (isRetired(card.offer)) {
      showView(
        retiredDetailDialog({
          offer: card.offer,
          poolLabel: poolLabel(card.offer.pool),
          backLabel: BACK_LABEL,
        }),
      );
      root().querySelector('#dialogBack')?.addEventListener('click', open);
      return;
    }
    showDetail(
      /** @type {import('../domain/offer.js').Offer} */ (card.offer),
      card.favorite,
      back(),
    );
  }

  /** @param {string | null} cursor */
  function bindHistoryPaging(cursor) {
    let next = cursor;
    const button = /** @type {HTMLButtonElement | null} */ (root().querySelector('#historyMore'));
    button?.addEventListener('click', async () => {
      // Captured now: if the view is closed or replaced meanwhile, drop the reply.
      const list = root().querySelector('#historyList');
      if (!list) return;
      button.disabled = true;
      try {
        const page = await me.getHistory(next);
        if (!list.isConnected) return;
        list.insertAdjacentHTML('beforeend', historyRows(page.items, poolLabel));
        next = page.nextCursor;
        if (next) button.disabled = false;
        else button.remove();
      } catch (error) {
        if (!list.isConnected) return;
        button.disabled = false;
        toast(describeError(error));
      }
    });
  }

  /**
   * @param {CollectionCard[]} cards
   * @param {import('../domain/me.js').Progress} progress
   * @param {{ items: import('../domain/me.js').HistoryItem[], nextCursor: string | null } | null} history
   */
  function render(cards, progress, history) {
    showView(collectionDialog({ cards, progress, history, poolLabel }));
    const inner = root();
    applyProgressWidths(inner);
    // Listen on the view's own root: it is replaced with each new view.
    inner.addEventListener('click', (event) => {
      const item =
        event.target instanceof Element ? event.target.closest('.collection-item') : null;
      const card = item && cards.find((c) => c.offer.id === item.getAttribute('data-offer-id'));
      if (card) openCard(card);
    });
    bindHistoryPaging(history?.nextCursor ?? null);
  }

  function open() {
    let cancelled = false;
    // Closing or replacing the loading view cancels the pending render.
    showView(collectionLoadingDialog(), { dispose: () => (cancelled = true) });
    Promise.all([me.getCollection(), me.getHistory().catch(() => null)])
      .then(([collection, history]) => {
        if (!cancelled) render(collection.cards, collection.progress, history);
      })
      .catch((error) => {
        if (cancelled) return;
        showView(collectionUnavailableDialog(describeError(error)));
        root().querySelector('#collectionRetry')?.addEventListener('click', open);
      });
  }

  return { open };
}
