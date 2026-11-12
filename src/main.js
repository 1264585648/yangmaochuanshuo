/* DealDex entry: wires the live catalog, local quota and dialogs to the page.
   Offers come from the public `/api/offers` endpoint. The draw itself runs in
   the browser over published offers until server-side draws ship (phase 3). */
import {
  API,
  COLLECTION_LIMIT,
  DEFAULT_POOL_INDEX,
  MAX_DRAWS,
  STORAGE_KEYS,
  TIMINGS,
} from './config.js';
import { POOLS, poolLabel } from './data/pools.js';
import { createApiClient, describeError } from './api/client.js';
import { RARITIES } from './domain/draw.js';
import { countByPool, drawFromPool, poolOdds, resolveCollection } from './domain/catalog.js';
import { dayKey, normalizeDaily, remainingDraws, consumeDraw } from './domain/quota.js';
import { recordDraw, toggleFavorite } from './domain/collection.js';
import {
  createStore,
  getBrowserStorage,
  loadCollection,
  loadFavorites,
  readDaily,
} from './storage/local.js';
import { renderPacks, applySelection, updatePackCounts } from './ui/packs.js';
import { createDialog, createToast } from './ui/dialog.js';
import {
  probabilityDialog,
  dailyDialog,
  resultDialog,
  detailDialog,
  favoriteLabel,
  collectionDialog,
  collectionUnavailableDialog,
} from './ui/views.js';
import { createCatalogStore } from './app/catalog-store.js';
import { initialView, renderLobby } from './app/lobby.js';
import {
  bindPackTilt,
  bindSwipe,
  flashClass,
  prefersReducedMotion,
  replayClass,
  wait,
} from './app/motion.js';

const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
const store = createStore(getBrowserStorage());
const api = createApiClient({ baseUrl: API.baseUrl, timeoutMs: API.timeoutMs });
const toast = createToast($('#toast'), TIMINGS.toastMs);
const scene = $('#packScene');

/** Cleanup for the view currently in the dialog (e.g. pending searches). */
let disposeView = null;
const disposeCurrentView = () => {
  disposeView?.();
  disposeView = null;
};

const dialog = createDialog({
  overlay: $('#overlay'),
  content: $('#dialogContent'),
  closeButton: $('#closeDialog'),
  background: document.querySelector('.app'),
  exitMs: TIMINGS.dialogExitMs,
  onClose: disposeCurrentView,
  // Used when the opener can no longer take focus (e.g. out of draws).
  fallbackFocus: $('#probabilityButton'),
});

let activeIndex = DEFAULT_POOL_INDEX;
let opening = false;
let daily = readDaily(store);
let collection = loadCollection(store);
let favorites = loadFavorites(store);
/** Dialog requested by the URL hash on load (e.g. `/#collection`), opened once the catalog settles. */
let pendingView = initialView(window.location.hash);

const catalog = createCatalogStore({
  load: (signal) => api.listAllOffers({ pageSize: API.pageSize, maxPages: API.maxPages, signal }),
  ttlMs: API.catalogTtlMs,
  onChange: (state) => {
    updatePackCounts(scene, state.status === 'ready' ? countByPool(state.offers) : null);
    refresh();
    openPendingView(state);
  },
});

/** @param {import('./app/catalog-store.js').CatalogState} state */
function openPendingView(state) {
  if (!pendingView || (state.status !== 'ready' && state.status !== 'error')) return;
  const action = NAV_ACTIONS[pendingView];
  pendingView = null;
  if (action && !dialog.isOpen()) guarded(action)();
}

/** Validate today's record, persisting only when it had to be reset. */
function currentDaily() {
  const normalized = normalizeDaily(daily, dayKey(new Date()));
  if (normalized !== daily) store.write(STORAGE_KEYS.daily, normalized);
  daily = normalized;
  return daily;
}

const remaining = () => remainingDraws(currentDaily(), MAX_DRAWS);

function refresh() {
  const state = catalog.get();
  const pool = POOLS[activeIndex];
  renderLobby($, {
    remaining: remaining(),
    max: MAX_DRAWS,
    opening,
    catalog: state,
    poolCount: state.status === 'ready' ? (countByPool(state.offers)[pool.id] ?? 0) : null,
    description: pool.description,
  });
}

function choose(index) {
  activeIndex = (index + POOLS.length) % POOLS.length;
  applySelection(scene, POOLS, activeIndex);
  refresh();
}

function cycle(direction) {
  if (!opening && !dialog.isOpen()) choose(activeIndex + direction);
}

const openDelay = () => (prefersReducedMotion() ? TIMINGS.openReducedMotionMs : TIMINGS.openMs);

function spendDraw(offer) {
  daily = consumeDraw(currentDaily());
  store.write(STORAGE_KEYS.daily, daily);
  collection = recordDraw(collection, offer.id, Date.now(), COLLECTION_LIMIT);
  store.write(STORAGE_KEYS.collection, collection);
  replayClass($('#headerRemaining'), 'bump');
}

async function draw() {
  if (opening) return;
  if (remaining() <= 0) {
    toast(`今天的 ${MAX_DRAWS} 次免费开包已用完，明天再来吧。`);
    return;
  }
  const pool = POOLS[activeIndex];
  opening = true;
  document.body.classList.add('is-opening');
  refresh();
  // A stale catalog refreshes during the animation. If the refresh is slower
  // than the animation, draw from the cached offers; it finishes in the background.
  const delay = openDelay();
  const latest = Promise.race([catalog.ensureFresh(), wait(delay).then(catalog.get)]);
  const [state] = await Promise.all([latest, wait(delay)]);
  const offer = state.status === 'ready' ? drawFromPool(state.offers, pool.id) : null;
  document.body.classList.remove('is-opening');
  opening = false;
  if (!offer) {
    flashClass(scene, 'is-fizzle', TIMINGS.fizzleMs);
    refresh();
    toast(
      state.status === 'ready'
        ? '这个卡池暂时没有有效福利，换一个试试吧。'
        : describeError(state.error),
    );
    return;
  }
  spendDraw(offer);
  refresh();
  showResult(offer);
}

function bindFavorite(offer) {
  const button = $('#favoriteResult');
  button.addEventListener('click', () => {
    favorites = toggleFavorite(favorites, offer.id);
    store.write(STORAGE_KEYS.favorites, favorites);
    const isFavorite = favorites.includes(offer.id);
    button.textContent = favoriteLabel(isFavorite);
    button.setAttribute('aria-pressed', String(isFavorite));
    replayClass(button, 'pop');
    toast(isFavorite ? '已加入收藏' : '已取消收藏');
  });
}

/** While a pack is opening, the result dialog is about to appear; don't open others. */
const guarded =
  (fn) =>
  (...args) => {
    if (!opening) fn(...args);
  };

function showView(html, { wide = false, dispose = null, returnFocus = null } = {}) {
  disposeCurrentView();
  dialog.show(html, { wide, returnFocus });
  disposeView = dispose;
}

function showResult(offer) {
  showView(
    resultDialog({
      offer,
      poolLabel: poolLabel(offer.pool),
      isFavorite: favorites.includes(offer.id),
      canDrawAgain: remaining() > 0,
      now: new Date(),
    }),
    // The open button was disabled during the animation and lost focus.
    { returnFocus: $('#openPack') },
  );
  bindFavorite(offer);
  $('#nextDraw').addEventListener('click', dialog.close);
}

/**
 * @param {import('./domain/offer.js').Offer} offer
 * @param {{ label: string, open: () => void } | null} back
 */
function showDetail(offer, back) {
  showView(
    detailDialog({
      offer,
      poolLabel: poolLabel(offer.pool),
      isFavorite: favorites.includes(offer.id),
      backLabel: back?.label ?? null,
      now: new Date(),
    }),
  );
  bindFavorite(offer);
  if (back) $('#dialogBack').addEventListener('click', back.open);
}

function openCollection() {
  const state = catalog.get();
  if (state.status !== 'ready') {
    // Resolving against an empty catalog would report every card as expired.
    showView(
      collectionUnavailableDialog(
        state.status === 'error'
          ? describeError(state.error)
          : '福利目录还在载入，请稍候再打开图鉴。',
      ),
    );
    return;
  }
  const offers = state.offers;
  const { found, missing } = resolveCollection(collection, offers);
  showView(collectionDialog({ found, missing, total: offers.length, favorites }));
  // Listen on the view's own root: it is replaced with each new view.
  $('#dialogContent .dialog-inner').addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest('.collection-item') : null;
    const offer = item && found.find((o) => o.id === item.getAttribute('data-offer-id'));
    if (offer) showDetail(offer, { label: '返回图鉴', open: openCollection });
  });
}

function openOdds() {
  const state = catalog.get();
  const pools =
    state.status === 'ready'
      ? POOLS.map((p) => ({ label: p.label, odds: poolOdds(state.offers, p.id) }))
      : null;
  showView(probabilityDialog({ base: RARITIES, pools }));
}

const NAV_ACTIONS = { collection: openCollection };

function onKeydown(event) {
  if (dialog.isOpen()) {
    if (event.key === 'Escape') dialog.close();
    return;
  }
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowLeft') cycle(-1);
  if (event.key === 'ArrowRight') cycle(1);
}

function onStorage(event) {
  // key is null when another tab calls localStorage.clear().
  if (event.key !== null && !Object.values(STORAGE_KEYS).includes(event.key)) return;
  daily = readDaily(store);
  collection = loadCollection(store);
  favorites = loadFavorites(store);
  refresh();
}

function bindEvents() {
  scene.addEventListener('click', (event) => {
    const pack = event.target instanceof Element ? event.target.closest('.pack') : null;
    if (pack instanceof HTMLElement && !opening) choose(Number(pack.dataset.index));
  });
  bindPackTilt(scene, () => opening);
  bindSwipe(scene, TIMINGS.swipeThresholdPx, cycle);
  $('#prevPack').addEventListener('click', () => cycle(-1));
  $('#nextPack').addEventListener('click', () => cycle(1));
  $('#openPack').addEventListener('click', draw);
  $('#catalogRetry').addEventListener('click', () => catalog.refresh());
  $('#probabilityButton').addEventListener('click', guarded(openOdds));
  $('#headerCount').addEventListener(
    'click',
    guarded(() => showView(dailyDialog({ remaining: remaining(), max: MAX_DRAWS }))),
  );
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => {
      const action = NAV_ACTIONS[button.dataset.nav];
      if (action) guarded(action)();
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  window.addEventListener('hashchange', () => {
    const action = NAV_ACTIONS[initialView(window.location.hash) ?? ''];
    if (action && !dialog.isOpen()) guarded(action)();
  });
  document.addEventListener('keydown', onKeydown);
  // Keep counts correct across tabs, across local midnight, and after reconnecting.
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', () => {
    if (catalog.get().status === 'error') catalog.refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

renderPacks(scene, POOLS);
choose(DEFAULT_POOL_INDEX);
bindEvents();
// Entrance animation runs once; later class changes must not replay it.
document.body.classList.add('is-intro');
setTimeout(() => document.body.classList.remove('is-intro'), TIMINGS.introMs);
catalog.refresh();
