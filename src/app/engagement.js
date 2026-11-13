/* Feedback form, community group dialog and official-link click tracking,
   shared by the lobby and the catalog page. */
import { describeError } from '../api/client.js';
import {
  communityDialog,
  feedbackDialog,
  feedbackThanks,
  FEEDBACK_LIMITS,
} from '../ui/engagement-views.js';

/** @typedef {import('../api/engagement-client.js').Community} Community */
/** @typedef {ReturnType<typeof import('../api/engagement-client.js').createEngagementClient>} EngagementClient */

/**
 * Read and check the feedback form. Returns a payload or a message to show.
 * @param {FormData} form
 * @param {{ id: string } | null} offer
 * @returns {{ ok: true, payload: import('../api/engagement-client.js').FeedbackPayload }
 *   | { ok: false, message: string }}
 */
export function readFeedbackForm(form, offer) {
  const category = String(form.get('category') ?? '');
  const message = String(form.get('message') ?? '').trim();
  const contact = String(form.get('contact') ?? '').trim();
  if (!category) return { ok: false, message: '请选择一个类型。' };
  if (!offer && message.length < 2) return { ok: false, message: '请写下你的想法。' };
  if (message.length > FEEDBACK_LIMITS.message) {
    return { ok: false, message: `内容最多 ${FEEDBACK_LIMITS.message} 字。` };
  }
  if (contact.length > FEEDBACK_LIMITS.contact) {
    return { ok: false, message: `联系方式最多 ${FEEDBACK_LIMITS.contact} 字。` };
  }
  const payload = offer
    ? { kind: 'offer', offerId: offer.id, category, message, contact }
    : { kind: 'general', category, message, contact };
  return { ok: true, payload: /** @type {any} */ (payload) };
}

/**
 * @param {{ client: EngagementClient,
 *   showView: (html: string) => void,
 *   root: () => ParentNode,
 *   onCommunity?: (community: Community | null) => void }} deps
 */
export function createEngagement({ client, showView, root, onCommunity }) {
  /** @type {Community | null} */
  let community = null;

  /** @param {{ id: string, title: string } | null} offer */
  function openFeedback(offer = null) {
    showView(feedbackDialog({ offer }));
    const scope = root();
    const form = /** @type {HTMLFormElement | null} */ (scope.querySelector('#feedbackForm'));
    const error = /** @type {HTMLElement | null} */ (scope.querySelector('#feedbackError'));
    const submit = /** @type {HTMLButtonElement | null} */ (scope.querySelector('#feedbackSubmit'));
    if (!form || !error || !submit) return;
    const showError = (text) => {
      error.textContent = text;
      error.hidden = false;
    };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const read = readFeedbackForm(new FormData(form), offer);
      if (!read.ok) {
        showError(read.message);
        return;
      }
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = '提交中…';
      try {
        await client.sendFeedback(read.payload);
        // The dialog may have been closed or replaced while sending.
        if (form.isConnected) showView(feedbackThanks());
      } catch (failure) {
        showError(describeError(failure));
        submit.disabled = false;
        submit.textContent = '提交反馈';
      }
    });
  }

  function openCommunity() {
    if (community) showView(communityDialog(community));
  }

  /** Fetch the group once; a failure just leaves the entry hidden. */
  async function loadCommunity() {
    try {
      community = await client.getCommunity();
    } catch {
      community = null;
    }
    onCommunity?.(community);
    return community;
  }

  return { openFeedback, openCommunity, loadCommunity, community: () => community };
}

/**
 * Count clicks on official-page links (`data-official-offer`), including
 * middle clicks. Never blocks or alters navigation.
 * @param {Document | HTMLElement} target
 * @param {(offerId: string) => void} track
 */
export function bindOfficialClicks(target, track) {
  const onClick = (event) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link =
      event.target instanceof Element ? event.target.closest('a[data-official-offer]') : null;
    const id = link instanceof HTMLElement ? link.dataset.officialOffer : undefined;
    if (id) track(id);
  };
  target.addEventListener('click', onClick);
  target.addEventListener('auxclick', onClick);
}

/**
 * Open the feedback form from `[data-report-offer]` buttons rendered in page
 * markup (the catalog's offer page).
 * @param {Document | HTMLElement} target
 * @param {(offer: { id: string, title: string }) => void} open
 */
export function bindReportButtons(target, open) {
  target.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element ? event.target.closest('[data-report-offer]') : null;
    if (!(button instanceof HTMLElement)) return;
    const id = button.dataset.reportOffer;
    if (id) open({ id, title: button.dataset.reportTitle ?? '' });
  });
}
