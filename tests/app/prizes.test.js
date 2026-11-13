import { describe, it, expect, vi } from 'vitest';
import { createPrizeBoard } from '../../src/app/prizes.js';

const rule = (remaining) => ({
  id: 'g',
  title: '会员',
  description: '',
  valueNote: '',
  chance: 0.05,
  total: 2,
  remaining,
  startsAt: null,
  endsAt: null,
});

function fakeButton() {
  const classes = new Set();
  return {
    hidden: true,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    classes,
  };
}

describe('prize board', () => {
  it('shows the entry while prizes exist and marks sold-out', async () => {
    const button = fakeButton();
    const listPrizes = vi
      .fn()
      .mockResolvedValueOnce([rule(1)])
      .mockResolvedValueOnce([rule(0)]);
    const board = createPrizeBoard({
      listPrizes,
      showView: vi.fn(),
      button: () => button,
      toast: vi.fn(),
    });
    await board.load();
    expect(button.hidden).toBe(false);
    expect(button.classes.has('is-soldout')).toBe(false);
    await board.load();
    expect(button.classes.has('is-soldout')).toBe(true);
  });

  it('hides the entry when the rules cannot load', async () => {
    const button = fakeButton();
    const board = createPrizeBoard({
      listPrizes: vi.fn().mockRejectedValue(new Error('down')),
      showView: vi.fn(),
      button: () => button,
      toast: vi.fn(),
    });
    await board.load();
    expect(button.hidden).toBe(true);
    expect(board.get()).toEqual([]);
  });

  it('opens with the last known rules when a refresh fails, else toasts', async () => {
    const showView = vi.fn();
    const toast = vi.fn();
    const listPrizes = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([rule(1)])
      .mockRejectedValueOnce(new Error('down'));
    const board = createPrizeBoard({ listPrizes, showView, button: fakeButton, toast });
    await board.open();
    expect(toast).toHaveBeenCalled();
    expect(showView).not.toHaveBeenCalled();
    await board.open();
    await board.open();
    expect(showView).toHaveBeenCalledTimes(2);
    expect(showView.mock.calls[1][0]).toContain('会员');
  });
});
