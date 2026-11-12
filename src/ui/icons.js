/* Trusted, static SVG markup. Never interpolate data into these strings. */
export const ICONS = Object.freeze({
  ai: '<path d="m32 3 5.5 18.5L56 27l-18.5 5.5L32 51l-5.5-18.5L8 27l18.5-5.5L32 3Z"/><path d="m49 45 2.5 6.5L58 54l-6.5 2.5L49 63l-2.5-6.5L40 54l6.5-2.5L49 45Z"/>',
  cloud: '<path d="M19 47h27a13 13 0 0 0 0-26 17 17 0 0 0-32.3 3.3A11.5 11.5 0 0 0 19 47Z"/>',
  software:
    '<rect x="8" y="8" width="19" height="19" rx="2"/><rect x="37" y="8" width="19" height="19" rx="2"/><rect x="8" y="37" width="19" height="19" rx="2"/><rect x="37" y="37" width="19" height="19" rx="2"/>',
  education: '<path d="M3 22 32 9l29 13-29 13L3 22Zm11 8v15c12 10 24 10 36 0V30M61 22v18"/>',
});

/**
 * @param {string} poolId
 * @param {string} [className]
 * @returns {string} Trusted inline SVG; unknown pools render an empty icon.
 */
export function poolIconSVG(poolId, className = '') {
  const markup = Object.hasOwn(ICONS, poolId) ? ICONS[poolId] : '';
  const fill = poolId === 'ai' ? ' fill-icon' : '';
  return `<svg viewBox="0 0 64 64" aria-hidden="true" class="pool-icon${fill} ${className}">${markup}</svg>`;
}

export const EXTERNAL_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" class="inline-icon"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
