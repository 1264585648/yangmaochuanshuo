/* Entry for the catalog page (`offers.html`, served at /offers and /offers/<id>). */
import { API } from './config.js';
import { createApiClient } from './api/client.js';
import { mountCatalogPage } from './app/catalog-page.js';

const main = document.querySelector('#catalogMain');
if (main instanceof HTMLElement) {
  mountCatalogPage({
    main,
    api: createApiClient({ baseUrl: API.baseUrl, timeoutMs: API.timeoutMs }),
    win: window,
    debounceMs: API.searchDebounceMs,
  });
}
