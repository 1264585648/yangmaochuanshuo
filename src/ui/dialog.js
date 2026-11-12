/**
 * Modal dialog with enter/exit animation, focus trap and focus return.
 * `show` accepts trusted HTML from views.js.
 * @param {{ overlay: HTMLElement, content: HTMLElement, closeButton: HTMLElement,
 *   background: HTMLElement | null, exitMs: number, onClose?: () => void,
 *   fallbackFocus?: HTMLElement | null }} elements
 */
export function createDialog({
  overlay,
  content,
  closeButton,
  background,
  exitMs,
  onClose,
  fallbackFocus = null,
}) {
  const frame = overlay.querySelector('.dialog-frame');
  /** @type {Element | null} */
  let opener = null;
  let exitTimer = null;
  let open = false;

  const focusables = () =>
    [
      ...overlay.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.closest('[hidden]'));

  function finishClose() {
    exitTimer = null;
    overlay.hidden = true;
    overlay.dataset.state = '';
    content.innerHTML = '';
  }

  /**
   * @param {string} html
   * @param {{ wide?: boolean, returnFocus?: HTMLElement | null }} [options]
   *   `returnFocus` overrides the element focused on close, for openers that
   *   lose focus before the dialog appears (e.g. a button disabled while busy).
   */
  function show(html, { wide = false, returnFocus = null } = {}) {
    if (exitTimer) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
    // Keep the original opener when one dialog replaces another.
    if (!open) opener = returnFocus ?? document.activeElement;
    open = true;
    content.innerHTML = html;
    frame?.classList.toggle('is-wide', wide);
    frame?.scrollTo?.(0, 0);
    overlay.hidden = false;
    overlay.dataset.state = 'open';
    document.body.style.overflow = 'hidden';
    if (background) background.inert = true;
    closeButton.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    onClose?.();
    overlay.dataset.state = 'closing';
    document.body.style.overflow = '';
    if (background) background.inert = false;
    if (opener instanceof HTMLElement && opener.isConnected && !opener.matches(':disabled')) {
      opener.focus();
    } else {
      fallbackFocus?.focus();
    }
    exitTimer = setTimeout(finishClose, exitMs);
  }

  /** @param {KeyboardEvent} event */
  function trapFocus(event) {
    if (event.key !== 'Tab' || !open) return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('keydown', trapFocus);
  overlay.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-close]')) close();
  });

  return { show, close, isOpen: () => open };
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
