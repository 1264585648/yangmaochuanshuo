/* DealDex MVP entry. All cards and daily draws are a browser-only demonstration.
   No coupon, credit, or real-world entitlement is granted by this page. */
import {
  MAX_DRAWS,
  COLLECTION_LIMIT,
  DEFAULT_POOL_INDEX,
  STORAGE_KEYS,
  TIMINGS,
} from './config.js';
import { POOLS, poolLabel } from './data/pools.js';
import { DEMO_OFFERS } from './data/offers.js';
import { RARITIES, drawRarity, pickOffer } from './domain/draw.js';
import { dayKey, normalizeDaily, remainingDraws, consumeDraw } from './domain/quota.js';
import { recordDraw, toggleFavorite, discoveredOffers, searchOffers } from './domain/collection.js';
import {
  createStore,
  getBrowserStorage,
  loadCollection,
  loadFavorites,
  readDaily,
} from './storage/local.js';
import { renderPacks, applySelection } from './ui/packs.js';
import { createDialog, createToast } from './ui/dialog.js';
import {
  probabilityDialog,
  dailyDialog,
  resultDialog,
  favoriteLabel,
  collectionDialog,
  discoverDialog,
  offerRows,
} from './ui/views.js';

const $ = (selector) => document.querySelector(selector);
const store = createStore(getBrowserStorage());
const dialog = createDialog({
  overlay: $('#overlay'),
  content: $('#dialogContent'),
  closeButton: $('#closeDialog'),
});
const toast = createToast($('#toast'), TIMINGS.toastMs);
const scene = $('#packScene');
const openButton = $('#openPack');

let activeIndex = DEFAULT_POOL_INDEX;
let opening = false;
let daily = readDaily(store);
let collection = loadCollection(store);
let favorites = loadFavorites(store);

/** Validate today's record, persisting only when it had to be reset. */
function currentDaily() {
  const normalized = normalizeDaily(daily, dayKey(new Date()));
  if (normalized !== daily) store.write(STORAGE_KEYS.daily, normalized);
  daily = normalized;
  return daily;
}

const remaining = () => remainingDraws(currentDaily(), MAX_DRAWS);

function refreshCounts() {
  const n = remaining();
  $('#headerRemaining').textContent = `${n} / ${MAX_DRAWS}`;
  $('#metaRemaining').textContent = `${n} / ${MAX_DRAWS}`;
  openButton.disabled = n <= 0 || opening;
  openButton.querySelector('span:nth-child(2)').textContent = n > 0 ? '打开卡包' : '明日再来';
}

function choose(index) {
  activeIndex = (index + POOLS.length) % POOLS.length;
  applySelection(scene, POOLS, activeIndex);
  $('#selectedDescription').textContent = POOLS[activeIndex].description;
}

function cycle(direction) {
  if (!opening) choose(activeIndex + direction);
}

const openDelay = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? TIMINGS.openReducedMotionMs
    : TIMINGS.openMs;

async function draw() {
  if (opening) return;
  if (remaining() <= 0) {
    toast(`今天的 ${MAX_DRAWS} 次免费体验已用完，明天再来吧。`);
    return;
  }
  const pool = POOLS[activeIndex];
  const offer = pickOffer(DEMO_OFFERS, pool.id, drawRarity());
  if (!offer) {
    toast('这个卡池暂时没有可抽的卡，换一个试试吧。');
    return;
  }
  opening = true;
  daily = consumeDraw(currentDaily());
  store.write(STORAGE_KEYS.daily, daily);
  collection = recordDraw(collection, offer.id, Date.now(), COLLECTION_LIMIT);
  store.write(STORAGE_KEYS.collection, collection);
  refreshCounts();
  document.body.classList.add('is-opening');
  await new Promise((resolve) => setTimeout(resolve, openDelay()));
  document.body.classList.remove('is-opening');
  opening = false;
  refreshCounts();
  showResult(offer);
}

function showResult(offer) {
  dialog.show(
    resultDialog({
      offer,
      poolLabel: poolLabel(offer.pool),
      isFavorite: favorites.includes(offer.id),
      canDrawAgain: remaining() > 0,
    }),
  );
  const favoriteButton = $('#favoriteResult');
  favoriteButton.addEventListener('click', () => {
    favorites = toggleFavorite(favorites, offer.id);
    store.write(STORAGE_KEYS.favorites, favorites);
    const isFavorite = favorites.includes(offer.id);
    favoriteButton.textContent = favoriteLabel(isFavorite);
    toast(isFavorite ? '已加入收藏' : '已取消收藏');
  });
  $('#nextDraw').addEventListener('click', dialog.close);
}

function openCollection() {
  dialog.show(
    collectionDialog({
      seen: discoveredOffers(collection, DEMO_OFFERS),
      total: DEMO_OFFERS.length,
      favorites,
    }),
  );
}

function openDiscover() {
  dialog.show(discoverDialog());
  const input = $('#offerSearch');
  const results = $('#offerResults');
  const update = () => {
    results.innerHTML = offerRows(searchOffers(DEMO_OFFERS, POOLS, input.value));
  };
  input.addEventListener('input', update);
  update();
}

const NAV_ACTIONS = {
  collection: openCollection,
  discover: openDiscover,
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

function onStorage(event) {
  // key is null when another tab calls localStorage.clear().
  if (event.key !== null && !Object.values(STORAGE_KEYS).includes(event.key)) return;
  daily = readDaily(store);
  collection = loadCollection(store);
  favorites = loadFavorites(store);
  refreshCounts();
}

function bindEvents() {
  scene.addEventListener('click', (event) => {
    const pack = event.target instanceof Element ? event.target.closest('.pack') : null;
    if (pack && !opening) choose(Number(pack.dataset.index));
  });
  $('#prevPack').addEventListener('click', () => cycle(-1));
  $('#nextPack').addEventListener('click', () => cycle(1));
  openButton.addEventListener('click', draw);
  $('#probabilityButton').addEventListener('click', () => dialog.show(probabilityDialog(RARITIES)));
  $('#headerCount').addEventListener('click', () =>
    dialog.show(dailyDialog({ remaining: remaining(), max: MAX_DRAWS })),
  );
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => {
      const action = NAV_ACTIONS[button.dataset.nav];
      if (action) action();
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  document.addEventListener('keydown', onKeydown);
  // Keep counts correct across tabs and across local midnight while the page stays open.
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCounts();
  });
}

renderPacks(scene, POOLS);
choose(DEFAULT_POOL_INDEX);
refreshCounts();
bindEvents();
