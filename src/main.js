/* Lobby entry: wires the live catalog, the server-side user state (identity,
   quota, draws, collection, favorites) and dialogs to the page. Offers for the
   pool counts and odds come from `/api/offers`; draws run on the server. */
import '../styles/collection.css';
import { API, DEFAULT_DAILY_DRAWS, DEFAULT_POOL_INDEX, TIMINGS } from './config.js';
import { POOLS, poolLabel } from './data/pools.js';
import { createApiClient, describeError } from './api/client.js';
import { createMeClient } from './api/me-client.js';
import { createEngagementClient } from './api/engagement-client.js';
import { RARITIES } from './domain/draw.js';
import { countByPool, poolOdds } from './domain/catalog.js';
import { isRetired, remainingDraws } from './domain/me.js';
import { createStore, getBrowserStorage } from './storage/local.js';
import { renderPacks, applySelection, updatePackCounts } from './ui/packs.js';
import { createDialog, createToast } from './ui/dialog.js';
import {
  probabilityDialog,
  dailyDialog,
  resultDialog,
  detailDialog,
  favoriteLabel,
} from './ui/views.js';
import { createCatalogStore } from './app/catalog-store.js';
import { createCollectionView } from './app/collection-view.js';
import { createDrawFlow } from './app/draw-flow.js';
import { importLegacyOnce } from './app/legacy-import.js';
import { initialView, renderLobby } from './app/lobby.js';
import { createMeStore } from './app/me-store.js';
import { bindOfficialClicks, createEngagement } from './app/engagement.js';
import {
  bindPackTilt,
  bindSwipe,
  flashClass,
  prefersReducedMotion,
  replayClass,
  wait,
} from './app/motion.js';

const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
const api = createApiClient({ baseUrl: API.baseUrl, timeoutMs: API.timeoutMs });
const meClient = createMeClient(api);
const engagementClient = createEngagementClient({ request: api.request, baseUrl: API.baseUrl });
const toast = createToast($('#toast'), TIMINGS.toastMs);
const scene = $('#packScene');

/** Cleanup for the view currently in the dialog (e.g. a pending load). */
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

const catalog = createCatalogStore({
  load: (signal) => api.listAllOffers({ pageSize: API.pageSize, maxPages: API.maxPages, signal }),
  ttlMs: API.catalogTtlMs,
  onChange: (state) => {
    updatePackCounts(scene, state.status === 'ready' ? countByPool(state.offers) : null);
    refresh();
  },
});

const me = createMeStore({ load: () => meClient.getMe(), onChange: () => refresh() });
/** Settles once the quota is loaded and any legacy import is done. */
let userLoaded = Promise.resolve();
const drawFlow = createDrawFlow({
  // A first draw sent while the import is in flight would carry no cookie and
  // create a second guest; wait for the import to settle first.
  draw: (pool, key) => userLoaded.then(() => meClient.draw(pool, key)),
});

/** Remaining draws, or null until the server has reported the quota. */
function quotaCounts() {
  const { quota } = me.get();
  return quota
    ? { remaining: remainingDraws(quota), max: quota.max }
    : { remaining: null, max: DEFAULT_DAILY_DRAWS };
}

function refresh() {
  const state = catalog.get();
  const pool = POOLS[activeIndex];
  renderLobby($, {
    ...quotaCounts(),
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

/** @param {import('./app/draw-flow.js').DrawOutcome} outcome */
function reportFailure(outcome) {
  if (outcome.kind === 'empty') {
    flashClass(scene, 'is-fizzle', TIMINGS.fizzleMs);
    catalog.refresh();
    toast('这个卡池暂时没有有效福利，换一个试试吧。');
  } else if (outcome.kind === 'exhausted') {
    if (outcome.quota) me.applyQuota(outcome.quota);
    else me.refresh();
    toast('今天的免费开包次数已用完，北京时间 0 点后再来吧。');
  } else if (outcome.kind === 'failed') {
    const retry = outcome.unknownOutcome ? '再次开包不会重复扣次。' : '';
    toast(`${describeError(outcome.error)}${retry}`);
  }
}

async function draw() {
  if (opening) return;
  if (quotaCounts().remaining === 0) {
    toast('今天的免费开包次数已用完，北京时间 0 点后再来吧。');
    return;
  }
  const pool = POOLS[activeIndex];
  opening = true;
  document.body.classList.add('is-opening');
  refresh();
  const outcome = await drawFlow.open(pool.id, wait(openDelay()));
  document.body.classList.remove('is-opening');
  opening = false;
  if (outcome.kind !== 'drawn') {
    reportFailure(outcome);
    refresh();
    return;
  }
  const { result } = outcome;
  me.applyQuota(result.quota);
  replayClass($('#headerRemaining'), 'bump');
  refresh();
  if (isRetired(result.offer)) {
    toast('上次未完成的开包已记录，但那张卡已下架，可在图鉴中查看。');
    return;
  }
  showResult(result.offer, result.draw);
}

/**
 * @param {import('./domain/offer.js').Offer} offer
 * @param {boolean} initial
 */
function bindFavorite(offer, initial) {
  const button = /** @type {HTMLButtonElement} */ ($('#favoriteResult'));
  let isFavorite = initial;
  const show = () => {
    button.textContent = favoriteLabel(isFavorite);
    button.setAttribute('aria-pressed', String(isFavorite));
  };
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const next = !isFavorite;
    isFavorite = next;
    show();
    replayClass(button, 'pop');
    button.disabled = true;
    try {
      await meClient.setFavorite(offer.id, next);
      toast(next ? '已加入收藏' : '已取消收藏');
    } catch (error) {
      isFavorite = !next;
      show();
      toast(describeError(error));
    } finally {
      button.disabled = false;
    }
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

/**
 * @param {import('./domain/offer.js').Offer} offer
 * @param {{ favorite: boolean, isNew: boolean }} draw
 */
function showResult(offer, { favorite, isNew }) {
  showView(
    resultDialog({
      offer,
      poolLabel: poolLabel(offer.pool),
      isFavorite: favorite,
      isNew,
      canDrawAgain: quotaCounts().remaining !== 0,
      now: new Date(),
    }),
    // The open button was disabled during the animation and lost focus.
    { returnFocus: $('#openPack') },
  );
  bindFavorite(offer, favorite);
  bindReport(offer);
  $('#nextDraw').addEventListener('click', dialog.close);
}

/**
 * @param {import('./domain/offer.js').Offer} offer
 * @param {boolean} isFavorite
 * @param {{ label: string, open: () => void } | null} back
 */
function showDetail(offer, isFavorite, back) {
  showView(
    detailDialog({
      offer,
      poolLabel: poolLabel(offer.pool),
      isFavorite,
      backLabel: back?.label ?? null,
      now: new Date(),
    }),
  );
  bindFavorite(offer, isFavorite);
  bindReport(offer);
  if (back) $('#dialogBack').addEventListener('click', back.open);
}

const engagement = createEngagement({
  client: engagementClient,
  showView: (html) => showView(html),
  root: () => $('#dialogContent'),
  onCommunity: (community) => {
    $('#communityButton').hidden = community === null;
  },
});

/** @param {import('./domain/offer.js').Offer} offer */
function bindReport(offer) {
  $('#reportOffer').addEventListener('click', () => engagement.openFeedback(offer));
}

const collectionView = createCollectionView({
  me: meClient,
  showView,
  root: () => $('#dialogContent .dialog-inner'),
  poolLabel,
  showDetail,
  toast,
});

function openOdds() {
  const state = catalog.get();
  const pools =
    state.status === 'ready'
      ? POOLS.map((p) => ({ label: p.label, odds: poolOdds(state.offers, p.id) }))
      : null;
  showView(probabilityDialog({ base: RARITIES, pools }));
}

function openDaily() {
  showView(dailyDialog(quotaCounts()));
}

/** Settles once the community group (if any) is known; started after the catalog. */
let communityLoaded = null;
const loadCommunity = () => (communityLoaded ??= engagement.loadCommunity());

const NAV_ACTIONS = {
  collection: collectionView.open,
  feedback: () => engagement.openFeedback(null),
  community: () => loadCommunity().then(() => engagement.openCommunity()),
};

function onKeydown(event) {
  if (dialog.isOpen()) {
    if (event.key === 'Escape') dialog.close();
    return;
  }
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowLeft') cycle(-1);
  if (event.key === 'ArrowRight') cycle(1);
}

/** Pick up a new quota day and other tabs' draws when the page comes back into view. */
function onVisible() {
  if (!document.hidden) me.refresh();
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
  $('#headerCount').addEventListener('click', guarded(openDaily));
  $('#feedbackButton').addEventListener(
    'click',
    guarded(() => engagement.openFeedback(null)),
  );
  $('#communityButton').addEventListener('click', guarded(engagement.openCommunity));
  bindOfficialClicks(document, engagementClient.trackOfficialClick);
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
  window.addEventListener('online', () => {
    if (catalog.get().status === 'error') catalog.refresh();
    if (me.get().status !== 'ready') me.refresh();
  });
  document.addEventListener('visibilitychange', onVisible);
}

/** Load the quota, then move any pre-account browser data to the server once. */
async function loadUser() {
  await me.refresh();
  if (me.get().status !== 'ready') return;
  const imported = await importLegacyOnce({
    store: createStore(getBrowserStorage()),
    importLegacy: (payload) => meClient.importLegacy(payload),
  });
  if (imported) toast(`已把本机记录的 ${imported} 张卡迁入你的图鉴。`);
}

renderPacks(scene, POOLS);
choose(DEFAULT_POOL_INDEX);
bindEvents();
// Entrance animation runs once; later class changes must not replay it.
document.body.classList.add('is-intro');
setTimeout(() => document.body.classList.remove('is-intro'), TIMINGS.introMs);
catalog.refresh();
userLoaded = loadUser();
loadCommunity();
// The collection no longer depends on the catalog, so `/#collection` opens at once.
const linked = NAV_ACTIONS[initialView(window.location.hash) ?? ''];
if (linked) linked();
