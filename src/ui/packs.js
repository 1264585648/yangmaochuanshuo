import { ICONS } from './icons.js';
import { escapeHTML as e } from './escape.js';

/**
 * @param {string} poolId
 * @returns {string} Trusted inline SVG.
 */
function iconSVG(poolId) {
  const markup = ICONS[poolId] ?? '';
  return `<svg viewBox="0 0 64 64" aria-hidden="true" class="${poolId === 'ai' ? 'fill-icon' : ''}">${markup}</svg>`;
}

const PACK_DECOR =
  '<span class="pack-seam"></span><span class="pack-spine"></span><span class="pack-strap"></span><span class="pack-corner tl"></span><span class="pack-corner tr"></span><span class="pack-corner bl"></span><span class="pack-corner br"></span><span class="pack-stud s1"></span><span class="pack-stud s2"></span><span class="pack-stud s3"></span><span class="pack-stud s4"></span>';

/**
 * @param {import('../data/pools.js').Pool} pool
 * @param {number} index
 * @returns {string}
 */
export function packHTML(pool, index) {
  return `<button type="button" class="pack pack--${e(pool.id)}" data-index="${index}" aria-label="选择${e(pool.title)}" aria-pressed="false"><span class="pack-leather">${PACK_DECOR}<span class="pack-emblem"><span class="pack-glyph">${iconSVG(pool.id)}</span></span><span class="pack-ribbon">${e(pool.label)}</span></span></button>`;
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
