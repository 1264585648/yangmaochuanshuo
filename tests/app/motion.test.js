// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bindPackTilt,
  bindSwipe,
  prefersReducedMotion,
  replayClass,
} from '../../src/app/motion.js';

const pointer = (type, init) => {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return event;
};

function media({ reduced = false, fine = true } = {}) {
  window.matchMedia = vi.fn((q) => ({
    matches: q.includes('reduce') ? reduced : fine,
  }));
}

beforeEach(() => {
  document.body.innerHTML =
    '<div id="scene"><button class="pack" data-position="0"><span class="inner"></span></button><button class="pack" data-position="1"></button></div>';
  window.requestAnimationFrame = (cb) => {
    cb(0);
    return 1;
  };
  window.cancelAnimationFrame = () => {};
});

describe('prefersReducedMotion', () => {
  it('follows the media query and tolerates a missing matchMedia', () => {
    media({ reduced: true });
    expect(prefersReducedMotion()).toBe(true);
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('bindPackTilt', () => {
  const setup = (locked = false) => {
    const scene = document.getElementById('scene');
    const front = scene.querySelector('[data-position="0"]');
    front.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 });
    bindPackTilt(scene, () => locked);
    return { scene, front };
  };

  it('tilts the front pack toward a mouse pointer and resets on leave', () => {
    media();
    const { front } = setup();
    front
      .querySelector('.inner')
      .dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 0 }));
    expect(front.style.getPropertyValue('--tilt-y')).toBe('3.50deg');
    expect(front.style.getPropertyValue('--tilt-x')).toBe('3.50deg');
    expect(front.style.getPropertyValue('--sheen-x')).toBe('100%');
    front.dispatchEvent(pointer('pointerout', { relatedTarget: document.body }));
    expect(front.style.getPropertyValue('--tilt-y')).toBe('');
  });

  it('ignores back packs, touch, locked state and reduced motion', () => {
    media();
    const { scene, front } = setup(true);
    front.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 0 }));
    expect(front.style.getPropertyValue('--tilt-y')).toBe('');

    document.body.innerHTML = scene.outerHTML;
    const again = setup(false);
    again.scene
      .querySelector('[data-position="1"]')
      .dispatchEvent(pointer('pointermove', { clientX: 1, clientY: 1 }));
    again.front.dispatchEvent(
      pointer('pointermove', { clientX: 1, clientY: 1, pointerType: 'touch' }),
    );
    media({ reduced: true });
    again.front.dispatchEvent(pointer('pointermove', { clientX: 1, clientY: 1 }));
    expect(again.front.style.getPropertyValue('--tilt-y')).toBe('');
  });
});

describe('bindSwipe', () => {
  const swipe = (el, dx, dy = 0, pointerType = 'touch') => {
    el.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, pointerType }));
    el.dispatchEvent(pointer('pointerup', { clientX: 100 + dx, clientY: 100 + dy, pointerType }));
  };

  it('reports horizontal swipes past the threshold', () => {
    const el = document.getElementById('scene');
    const onSwipe = vi.fn();
    bindSwipe(el, 40, onSwipe);
    swipe(el, -60);
    swipe(el, 60);
    expect(onSwipe.mock.calls).toEqual([[1], [-1]]);
  });

  it('ignores short, vertical, mouse and cancelled gestures', () => {
    const el = document.getElementById('scene');
    const onSwipe = vi.fn();
    bindSwipe(el, 40, onSwipe);
    swipe(el, 20);
    swipe(el, 60, 80);
    swipe(el, 60, 0, 'mouse');
    el.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0, pointerType: 'touch' }));
    el.dispatchEvent(pointer('pointercancel', {}));
    el.dispatchEvent(pointer('pointerup', { clientX: 90, clientY: 0, pointerType: 'touch' }));
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe('replayClass', () => {
  it('re-adds the class so the animation restarts', () => {
    const el = document.createElement('span');
    el.classList.add('bump');
    replayClass(el, 'bump');
    expect(el.classList.contains('bump')).toBe(true);
  });
});
