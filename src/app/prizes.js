/* Lobby controller for limited prizes: loads the public rules, shows the
   「限定福利」 entry while any prize is live, and opens the rules dialog. */
import { describeError } from '../api/client.js';
import { prizesInStock } from '../domain/prize.js';
import { prizeRulesDialog } from '../ui/prize-views.js';

/**
 * @param {{
 *   listPrizes: () => Promise<import('../domain/prize.js').PublicPrize[]>,
 *   showView: (html: string) => void,
 *   button: () => HTMLElement,
 *   toast: (message: string) => void,
 * }} deps
 */
export function createPrizeBoard({ listPrizes, showView, button, toast }) {
  /** @type {import('../domain/prize.js').PublicPrize[]} */
  let prizes = [];

  function render() {
    const entry = button();
    const live = prizesInStock(prizes);
    entry.hidden = prizes.length === 0;
    entry.classList.toggle('is-soldout', live.length === 0);
  }

  /** Never rejects: without the rules the lobby simply shows no entry. */
  async function load() {
    try {
      prizes = await listPrizes();
    } catch {
      prizes = [];
    }
    render();
  }

  async function open() {
    try {
      prizes = await listPrizes();
      render();
    } catch (error) {
      if (prizes.length === 0) {
        toast(describeError(error));
        return;
      }
    }
    showView(prizeRulesDialog({ prizes }));
  }

  return { load, open, get: () => prizes };
}
