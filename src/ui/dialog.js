/**
 * Modal dialog with focus return. `show` accepts trusted HTML from views.js.
 * @param {{ overlay: HTMLElement, content: HTMLElement, closeButton: HTMLElement }} elements
 */
export function createDialog({ overlay, content, closeButton }) {
  /** @type {Element | null} */
  let opener = null;

  /** @param {string} html */
  function show(html) {
    opener = document.activeElement;
    content.innerHTML = html;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    closeButton.focus();
  }

  function close() {
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (opener instanceof HTMLElement) opener.focus();
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-close]')) close();
  });

  return { show, close, isOpen: () => !overlay.hidden };
}

/**
 * @param {HTMLElement} element
 * @param {number} durationMs
 * @returns {(message: string) => void}
 */
export function createToast(element, durationMs) {
  let timer = null;
  return (message) => {
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => element.classList.remove('visible'), durationMs);
  };
}
