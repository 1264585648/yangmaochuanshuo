/* Small interaction effects. All respect `prefers-reduced-motion`. */

/** @returns {boolean} */
export const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const finePointer = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const MAX_TILT_DEG = 7;

/**
 * Tilt the front pack toward the pointer and move its sheen. Writes CSS
 * variables only; the stylesheet decides how they are used.
 * @param {HTMLElement} scene
 * @param {() => boolean} isLocked
 */
export function bindPackTilt(scene, isLocked) {
  let frame = 0;
  const reset = (pack) => {
    pack.style.removeProperty('--tilt-x');
    pack.style.removeProperty('--tilt-y');
    pack.style.removeProperty('--sheen-x');
  };

  scene.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || isLocked() || prefersReducedMotion() || !finePointer()) {
      return;
    }
    const pack = event.target instanceof Element ? event.target.closest('.pack') : null;
    if (!(pack instanceof HTMLElement) || pack.dataset.position !== '0') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = pack.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      pack.style.setProperty('--tilt-x', `${(-y * MAX_TILT_DEG).toFixed(2)}deg`);
      pack.style.setProperty('--tilt-y', `${(x * MAX_TILT_DEG).toFixed(2)}deg`);
      pack.style.setProperty('--sheen-x', `${Math.round((x + 0.5) * 100)}%`);
    });
  });
  scene.addEventListener('pointerout', (event) => {
    const pack = event.target instanceof Element ? event.target.closest('.pack') : null;
    if (pack instanceof HTMLElement && !pack.contains(/** @type {Node} */ (event.relatedTarget))) {
      cancelAnimationFrame(frame);
      reset(pack);
    }
  });
}

/**
 * Horizontal swipe on touch screens. Returns -1 / 1 through `onSwipe`.
 * @param {HTMLElement} element
 * @param {number} thresholdPx
 * @param {(direction: number) => void} onSwipe
 */
export function bindSwipe(element, thresholdPx, onSwipe) {
  let start = null;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') start = { x: event.clientX, y: event.clientY };
  });
  element.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) > thresholdPx && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
  });
  element.addEventListener('pointercancel', () => {
    start = null;
  });
}

/**
 * Replay a one-shot CSS animation class on an element.
 * @param {Element} element
 * @param {string} className
 */
export function replayClass(element, className) {
  element.classList.remove(className);
  // Force a style flush so the animation restarts.
  void (/** @type {HTMLElement} */ (element).offsetWidth);
  element.classList.add(className);
}

/**
 * Play a one-shot animation class and remove it afterwards, so it neither
 * replays on later state changes nor out-ranks other animations.
 * @param {Element} element
 * @param {string} className
 * @param {number} durationMs
 */
export function flashClass(element, className, durationMs) {
  replayClass(element, className);
  setTimeout(() => element.classList.remove(className), durationMs);
}

/** @param {number} ms */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
