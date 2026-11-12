import { poolIconSVG } from './icons.js';
import { escapeHTML as e } from './escape.js';

const PACK_DECOR =
  '<span class="pack-seam"></span><span class="pack-spine"></span><span class="pack-strap"></span><span class="pack-corner tl"></span><span class="pack-corner tr"></span><span class="pack-corner bl"></span><span class="pack-corner br"></span><span class="pack-stud s1"></span><span class="pack-stud s2"></span><span class="pack-stud s3"></span><span class="pack-stud s4"></span><span class="pack-sheen"></span>';

/**
 * @param {import('../data/pools.js').Pool} pool
 * @param {number} index
 * @returns {string}
 */
export function packHTML(pool, index) {
  return `<button type="button" class="pack pack--${e(pool.id)}" data-index="${index}" data-pool="${e(pool.id)}" aria-label="选择${e(pool.title)}" aria-pressed="false"><span class="pack-tilt"><span class="pack-leather">${PACK_DECOR}<span class="pack-emblem"><span class="pack-glyph">${poolIconSVG(pool.id)}</span></span><span class="pack-ribbon">${e(pool.label)}</span></span><span class="pack-count" aria-hidden="true"></span></span></button>`;
}

/**
 * Slot of a pack relative to the selected one: 0 front, 1 and 2 behind, -1 hidden.
 * @param {number} index
 * @param {number} activeIndex
 * @param {number} count
 * @returns {number}
 */
export function positionFor(index, activeIndex, count) {
  const offset = (index - activeIndex + count) % count;
  return offset <= 2 ? offset : -1;
}

/**
 * @param {HTMLElement} scene
 * @param {readonly import('../data/pools.js').Pool[]} pools
 */
export function renderPacks(scene, pools) {
  scene.innerHTML = pools.map(packHTML).join('');
}

/**
 * @param {HTMLElement} scene
 * @param {readonly import('../data/pools.js').Pool[]} pools
 * @param {number} activeIndex
 */
export function applySelection(scene, pools, activeIndex) {
  for (const pack of scene.querySelectorAll('.pack')) {
    const index = Number(pack.dataset.index);
    const isSelected = index === activeIndex;
    pack.dataset.position = String(positionFor(index, activeIndex, pools.length));
    pack.setAttribute('aria-pressed', String(isSelected));
    pack.setAttribute('aria-label', `${pools[index].title}${isSelected ? '，当前已选中' : ''}`);
  }
}

/**
 * Show live card counts on each pack. `null` counts mean the catalog is not loaded.
 * @param {HTMLElement} scene
 * @param {Record<string, number> | null} counts
 */
export function updatePackCounts(scene, counts) {
  for (const pack of scene.querySelectorAll('.pack')) {
    const badge = pack.querySelector('.pack-count');
    const n = counts ? (counts[pack.dataset.pool] ?? 0) : null;
    pack.classList.toggle('is-empty', n === 0);
    if (badge) badge.textContent = n === null ? '' : n === 0 ? '补充中' : `${n} 张`;
  }
}
