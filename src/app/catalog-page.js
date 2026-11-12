/* Browser side of the catalog page (`/offers`, `/offers/<id>`).
 *
 * The Worker sends fully rendered HTML; this script only takes over
 * navigation: filter changes and in-page links update the URL with the
 * History API and re-render from `/api/offers` using the same builders, and
 * back/forward re-renders whatever the URL says. Without server content
 * (Vite dev, or a server render failure) it renders the page itself. */
import { describeError } from '../api/client.js';
import {
  CATALOG_PAGE_SIZE,
  FLAG_KEYS,
  catalogHref,
  parseCatalogParams,
  parseCatalogPath,
  toApiQuery,
} from '../domain/catalog-query.js';
import { catalogDetail, catalogMissing } from '../ui/catalog-cards.js';
import { applyMeta, catalogMeta } from '../ui/catalog-meta.js';
import {
  catalogHeading,
  catalogList,
  catalogResults,
  hasAdvancedFilters,
} from '../ui/catalog-page.js';
import { errorState, skeletonRows } from '../ui/offer-views.js';

const RELOAD_ID = 'catalogReload';
const SKELETON_ROWS = 4;
const BACK_LINK = '<a class="back-button" href="/offers" data-route>‹ 返回福利目录</a>';

/** @typedef {import('../domain/catalog-query.js').CatalogFilters} CatalogFilters */

/**
 * @param {HTMLFormElement} form
 * @returns {string} Catalog URL for the form's current values, back on page 1.
 */
function hrefFromForm(form) {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) params.append(key, String(value));
  return catalogHref({ ...parseCatalogParams(params), page: 1 });
}

/**
 * Make the controls show `filters` (after back/forward).
 * @param {HTMLFormElement} form
 * @param {Readonly<CatalogFilters>} filters
 */
function syncForm(form, filters) {
  const q = /** @type {HTMLInputElement | null} */ (form.elements.namedItem('q'));
  if (q && q.value.trim() !== (filters.q ?? '')) q.value = filters.q ?? '';
  for (const radio of form.querySelectorAll('input[name="pool"]')) {
    /** @type {HTMLInputElement} */ (radio).checked =
      /** @type {HTMLInputElement} */ (radio).value === (filters.pool ?? '');
  }
  for (const key of ['rarity', ...FLAG_KEYS]) {
    const select = /** @type {HTMLSelectElement | null} */ (form.elements.namedItem(key));
    if (select) select.value = filters[key] ?? '';
  }
  // Show active advanced filters; never fold the panel away on the user.
  const more = form.querySelector('details.catalog-more');
  if (more instanceof HTMLDetailsElement && hasAdvancedFilters(filters)) more.open = true;
}

/**
 * Plain left click on a same-origin `data-route` link.
 * @param {MouseEvent} event
 * @param {Location} location
 * @returns {HTMLAnchorElement | null}
 */
function routedLink(event, location) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest('a[data-route]');
  if (!(link instanceof HTMLAnchorElement) || link.target) return null;
  return link.origin === location.origin ? link : null;
}

/**
 * @param {{ main: HTMLElement, api: ReturnType<typeof import('../api/client.js').createApiClient>,
 *   win: Window, debounceMs: number, pageSize?: number }} options
 */
export function mountCatalogPage({ main, api, win, debounceMs, pageSize = CATALOG_PAGE_SIZE }) {
  const doc = win.document;
  let controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounce;

  const setMeta = (view) => applyMeta(doc, catalogMeta(view), win.location.origin);
  const form = () => /** @type {HTMLFormElement | null} */ (main.querySelector('.catalog-filters'));

  /** Abort the previous request and return a signal for the next one. */
  function nextSignal() {
    controller.abort();
    controller = new AbortController();
    return controller.signal;
  }

  /** @param {Readonly<CatalogFilters>} filters */
  async function renderList(filters) {
    const signal = nextSignal();
    const existing = form();
    if (existing) {
      syncForm(existing, filters);
      const title = main.querySelector('#catalogTitle');
      if (title) title.textContent = catalogHeading(filters);
    } else {
      main.innerHTML = catalogList({ offers: [], total: 0, filters, pageSize });
    }
    const results = /** @type {HTMLElement} */ (main.querySelector('#catalogResults'));
    results.innerHTML = `<p class="result-count" role="status">正在加载…</p>${skeletonRows(SKELETON_ROWS)}`;
    try {
      const page = await api.listOffers(toApiQuery(filters, pageSize), { signal });
      if (signal.aborted) return;
      results.innerHTML = catalogResults({ ...page, filters, pageSize });
      setMeta({ kind: 'list', filters, total: page.total });
    } catch (error) {
      if (signal.aborted) return;
      results.innerHTML = errorState(describeError(error), RELOAD_ID);
    }
  }

  /** @param {string} id */
  async function renderDetail(id) {
    const signal = nextSignal();
    main.innerHTML = `${BACK_LINK}<p class="catalog-loading" role="status">正在载入福利…</p>`;
    try {
      const offer = await api.getOffer(id, { signal });
      if (signal.aborted) return;
      main.innerHTML = catalogDetail(offer);
      setMeta({ kind: 'detail', offer });
    } catch (error) {
      if (signal.aborted) return;
      if (error?.kind === 'http' && error.status === 404) return renderMissing();
      main.innerHTML = `${BACK_LINK}${errorState(describeError(error), RELOAD_ID)}`;
    }
  }

  function renderMissing() {
    nextSignal();
    main.innerHTML = catalogMissing();
    setMeta({ kind: 'missing' });
  }

  /** Render whatever the current URL describes. */
  function render() {
    const url = new URL(win.location.href);
    const route = parseCatalogPath(url.pathname) ?? { kind: 'missing' };
    if (route.kind === 'list') return renderList(parseCatalogParams(url.searchParams));
    if (route.kind === 'detail') return renderDetail(route.id);
    return renderMissing();
  }

  /**
   * @param {string} href
   * @param {{ replace?: boolean, focus?: boolean }} [options]
   */
  async function navigate(href, { replace = false, focus = false } = {}) {
    clearTimeout(debounce);
    if (replace) win.history.replaceState(null, '', href);
    else win.history.pushState(null, '', href);
    if (focus) win.scrollTo({ top: 0 });
    await render();
    if (focus) /** @type {HTMLElement | null} */ (main.querySelector('#catalogTitle'))?.focus();
  }

  /** @param {MouseEvent} event */
  function onClick(event) {
    const link = routedLink(event, win.location);
    if (link) {
      event.preventDefault();
      navigate(link.href, { focus: true });
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`#${RELOAD_ID}`)) render();
  }

  /** @param {Event} event */
  function onFormEvent(event) {
    const target = event.target;
    const owner = target instanceof Element ? target.closest('form.catalog-filters') : null;
    if (!(owner instanceof HTMLFormElement)) return;
    if (event.type === 'submit') {
      event.preventDefault();
      navigate(hrefFromForm(owner));
    } else if (
      event.type === 'input' &&
      target instanceof HTMLInputElement &&
      target.name === 'q'
    ) {
      clearTimeout(debounce);
      debounce = setTimeout(() => navigate(hrefFromForm(owner), { replace: true }), debounceMs);
    } else if (
      event.type === 'change' &&
      !(target instanceof HTMLInputElement && target.name === 'q')
    ) {
      navigate(hrefFromForm(owner));
    }
  }

  const onPopState = () => {
    clearTimeout(debounce);
    render();
  };

  doc.addEventListener('click', onClick);
  for (const type of ['submit', 'input', 'change']) main.addEventListener(type, onFormEvent);
  win.addEventListener('popstate', onPopState);

  // Server-rendered content is already correct for this URL.
  if (!main.querySelector('.catalog-view')) render();

  return {
    dispose() {
      clearTimeout(debounce);
      controller.abort();
      doc.removeEventListener('click', onClick);
      for (const type of ['submit', 'input', 'change']) main.removeEventListener(type, onFormEvent);
      win.removeEventListener('popstate', onPopState);
    },
  };
}
