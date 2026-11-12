/* Renders lobby state (counts, selected pool, catalog status) into the page. */
import { describeError } from '../api/client.js';

/**
 * `remaining` is null until the server has reported the quota.
 * @typedef {{ remaining: number | null, max: number, opening: boolean,
 *   catalog: import('./catalog-store.js').CatalogState, poolCount: number | null,
 *   description: string }} LobbyView
 */

/**
 * @param {LobbyView} view
 * @returns {{ label: string, disabled: boolean }}
 */
export function openButtonState({ remaining, opening, catalog, poolCount }) {
  if (opening) return { label: '开启中…', disabled: true };
  if (remaining !== null && remaining <= 0) return { label: '明日再来', disabled: true };
  if (catalog.status === 'loading' || catalog.status === 'idle') {
    return { label: '载入卡池…', disabled: true };
  }
  if (catalog.status === 'error') return { label: '暂不可用', disabled: true };
  if (!poolCount) return { label: '卡池补充中', disabled: true };
  return { label: '打开卡包', disabled: false };
}

/**
 * @param {LobbyView} view
 * @returns {{ text: string, tone: 'idle' | 'loading' | 'error' | 'empty' | 'ready' }}
 */
export function poolStatus({ catalog, poolCount }) {
  if (catalog.status === 'error') return { text: describeError(catalog.error), tone: 'error' };
  if (catalog.status !== 'ready') return { text: '正在载入福利目录…', tone: 'loading' };
  if (!poolCount) return { text: '该卡池暂无已发布的福利，正在补充', tone: 'empty' };
  return { text: `收录 ${poolCount} 张有效福利`, tone: 'ready' };
}

/**
 * @param {(selector: string) => HTMLElement} $
 * @param {LobbyView} view
 */
export function renderLobby($, view) {
  const counts = `${view.remaining ?? '–'} / ${view.max}`;
  for (const id of ['#headerRemaining', '#metaRemaining']) {
    const el = $(id);
    if (el.textContent !== counts) el.textContent = counts;
  }
  const button = /** @type {HTMLButtonElement} */ ($('#openPack'));
  const { label, disabled } = openButtonState(view);
  button.disabled = disabled;
  $('#openLabel').textContent = label;
  button.setAttribute('aria-busy', String(view.opening || view.catalog.status === 'loading'));

  $('#selectedDescription').textContent = view.description;
  const status = poolStatus(view);
  const statusEl = $('#poolStatus');
  statusEl.textContent = status.text;
  statusEl.dataset.tone = status.tone;
  $('#catalogRetry').hidden = view.catalog.status !== 'error';
}

/** URL hashes that open a dialog when the lobby loads (e.g. `/#collection`). */
const HASH_VIEWS = Object.freeze({ '#collection': 'collection' });

/**
 * @param {string} hash `location.hash`
 * @returns {'collection' | null}
 */
export function initialView(hash) {
  return Object.hasOwn(HASH_VIEWS, hash) ? HASH_VIEWS[hash] : null;
}
