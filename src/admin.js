/* Entry for the web admin console (`admin.html`, served at /admin). */
import { API } from './config.js';
import { mountAdminPage } from './app/admin-page.js';

const main = document.querySelector('#adminMain');
const toastEl = document.querySelector('#adminToast');
if (main instanceof HTMLElement) {
  mountAdminPage({
    main,
    toastEl: toastEl instanceof HTMLElement ? toastEl : null,
    win: window,
    baseUrl: API.baseUrl,
  });
}
