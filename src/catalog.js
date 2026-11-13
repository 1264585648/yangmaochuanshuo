/* Entry for the catalog page (`offers.html`, served at /offers and /offers/<id>). */
import { API, TIMINGS } from './config.js';
import { createApiClient } from './api/client.js';
import { createEngagementClient } from './api/engagement-client.js';
import { mountCatalogPage } from './app/catalog-page.js';
import { bindOfficialClicks, bindReportButtons, createEngagement } from './app/engagement.js';
import { createDialog } from './ui/dialog.js';

// Reveals controls that need this script (`.js-only`), e.g. the report button.
document.documentElement.classList.add('has-js');

const api = createApiClient({ baseUrl: API.baseUrl, timeoutMs: API.timeoutMs });
const main = document.querySelector('#catalogMain');
if (main instanceof HTMLElement) {
  mountCatalogPage({ main, api, win: window, debounceMs: API.searchDebounceMs });
}

const $ = (selector) => /** @type {HTMLElement | null} */ (document.querySelector(selector));
const engagementClient = createEngagementClient({ request: api.request, baseUrl: API.baseUrl });
bindOfficialClicks(document, engagementClient.trackOfficialClick);

const overlay = $('#overlay');
const content = $('#dialogContent');
const closeButton = $('#closeDialog');
if (overlay && content && closeButton) {
  const dialog = createDialog({
    overlay,
    content,
    closeButton,
    background: document.querySelector('.app'),
    exitMs: TIMINGS.dialogExitMs,
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.isOpen()) dialog.close();
  });
  const engagement = createEngagement({
    client: engagementClient,
    showView: (html) => dialog.show(html),
    root: () => content,
    onCommunity: (community) => {
      const button = $('#communityButton');
      if (button) button.hidden = community === null;
    },
  });
  $('#feedbackButton')?.addEventListener('click', () => engagement.openFeedback(null));
  $('#communityButton')?.addEventListener('click', engagement.openCommunity);
  bindReportButtons(document, engagement.openFeedback);
  engagement.loadCommunity();
}
