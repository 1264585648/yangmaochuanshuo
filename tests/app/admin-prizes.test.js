// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  buildPrizeBody,
  chanceFromPercent,
  handlePrizeClick,
  handlePrizeSubmit,
  parseCodes,
  renderPrizeTab,
} from '../../src/app/admin-prizes.js';

const prize = {
  id: 'gift-1',
  title: '<img src=x onerror=alert(1)>',
  description: 'd',
  valueNote: '',
  redeemUrl: null,
  chance: 0.05,
  status: 'draft',
  startsAt: null,
  endsAt: null,
  total: 3,
  claimed: 1,
};

function ctx(overrides = {}) {
  return {
    state: { prizes: [prize], prizeWinners: {}, prizeEditing: null },
    client: {
      createPrize: vi.fn(async () => ({})),
      editPrize: vi.fn(async () => ({})),
      addPrizeCodes: vi.fn(async () => ({ added: 2, total: 5, claimed: 1 })),
      transitionPrize: vi.fn(async () => ({})),
      listPrizeWinners: vi.fn(async () => [
        { code: '****WXYZ', claimedAt: '2026-11-12T10:00:00Z', day: '2026-11-12', user: 'u_1' },
      ]),
    },
    refresh: vi.fn(async () => {}),
    showToast: vi.fn(),
    handleError: vi.fn(),
    render: vi.fn(),
    ...overrides,
  };
}

const formFrom = (html) => {
  document.body.innerHTML = html;
  return /** @type {HTMLFormElement} */ (document.querySelector('form'));
};

describe('admin prize helpers', () => {
  it('parses pasted codes and percents', () => {
    expect(parseCodes(' A \n\nB\r\nA\n')).toEqual(['A', 'B']);
    expect(chanceFromPercent('5')).toBe(0.05);
    expect(chanceFromPercent('0.25')).toBe(0.0025);
    expect(chanceFromPercent('0')).toBeNaN();
    expect(chanceFromPercent('abc')).toBeNaN();
  });

  it('builds the request body from the form', () => {
    const data = new FormData();
    data.set('id', ' gift-2 ');
    data.set('title', ' T ');
    data.set('chancePercent', '2');
    data.set('redeemUrl', '');
    expect(buildPrizeBody(data, { withId: true })).toMatchObject({
      id: 'gift-2',
      title: 'T',
      chance: 0.02,
      redeemUrl: null,
      startsAt: null,
    });
    expect(buildPrizeBody(data, { withId: false })).not.toHaveProperty('id');
  });

  it('renders escaped prizes with stock and status actions', () => {
    document.body.innerHTML = renderPrizeTab({ prizes: [prize], prizeWinners: {} });
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('库存 2 / 3');
    expect(document.querySelector('[data-prize-action="activate"]')).not.toBeNull();
    expect(document.querySelector('[data-prize-form="codes"]')).not.toBeNull();
  });
});

describe('admin prize handlers', () => {
  it('uploads parsed codes and refreshes', async () => {
    const c = ctx();
    const form = formFrom(
      '<form data-prize-form="codes" data-prize-id="gift-1"><textarea name="codes">A\nB\nA</textarea></form>',
    );
    expect(await handlePrizeSubmit(form, c)).toBe(true);
    expect(c.client.addPrizeCodes).toHaveBeenCalledWith('gift-1', ['A', 'B']);
    expect(c.refresh).toHaveBeenCalled();
  });

  it('does not send an empty code list', async () => {
    const c = ctx();
    const form = formFrom(
      '<form data-prize-form="codes" data-prize-id="gift-1"><textarea name="codes"> </textarea></form>',
    );
    await handlePrizeSubmit(form, c);
    expect(c.client.addPrizeCodes).not.toHaveBeenCalled();
  });

  it('asks before ending and loads winners', async () => {
    const c = ctx();
    const button = (attrs) => {
      document.body.innerHTML = `<button ${attrs}></button>`;
      return /** @type {HTMLButtonElement} */ (document.querySelector('button'));
    };
    globalThis.confirm = vi.fn(() => false);
    await handlePrizeClick(button('data-prize-action="end" data-prize-id="gift-1"'), c);
    expect(c.client.transitionPrize).not.toHaveBeenCalled();
    globalThis.confirm = vi.fn(() => true);
    await handlePrizeClick(button('data-prize-action="end" data-prize-id="gift-1"'), c);
    expect(c.client.transitionPrize).toHaveBeenCalledWith('gift-1', 'end');
    await handlePrizeClick(button('data-prize-winners="gift-1"'), c);
    expect(c.state.prizeWinners['gift-1'][0].code).toBe('****WXYZ');
  });

  it('reports errors without losing the form', async () => {
    const c = ctx();
    c.client.createPrize = vi.fn(async () => {
      throw Object.assign(new Error('chance cap'), { status: 422 });
    });
    const form = formFrom('<form data-prize-form="create"><input name="id" value="g-1" /></form>');
    await handlePrizeSubmit(form, c);
    expect(c.handleError).toHaveBeenCalled();
    expect(c.render).not.toHaveBeenCalled();
    expect(c.showToast).toHaveBeenCalledWith('保存失败：chance cap');
  });
});

describe('admin prize editing', () => {
  it('toggles the edit form and saves changes', async () => {
    const c = ctx();
    document.body.innerHTML = '<button data-prize-edit="gift-1"></button>';
    const toggle = /** @type {HTMLButtonElement} */ (document.querySelector('button'));
    await handlePrizeClick(toggle, c);
    expect(c.state.prizeEditing).toBe('gift-1');
    document.body.innerHTML = renderPrizeTab(c.state);
    expect(document.querySelector('[data-prize-form="edit"]')).not.toBeNull();
    await handlePrizeClick(toggle, c);
    expect(c.state.prizeEditing).toBeNull();

    c.state.prizeEditing = 'gift-1';
    const form = formFrom(
      '<form data-prize-form="edit" data-prize-id="gift-1"><input name="title" value="新名字" /><input name="chancePercent" value="3" /></form>',
    );
    await handlePrizeSubmit(form, c);
    expect(c.client.editPrize).toHaveBeenCalledWith(
      'gift-1',
      expect.objectContaining({ title: '新名字', chance: 0.03 }),
    );
    expect(c.state.prizeEditing).toBeNull();
  });

  it('creates a prize and renders winners and ended prizes', async () => {
    const c = ctx();
    await handlePrizeSubmit(
      formFrom('<form data-prize-form="create"><input name="id" value="g-2" /></form>'),
      c,
    );
    expect(c.client.createPrize).toHaveBeenCalledWith(expect.objectContaining({ id: 'g-2' }));
    const html = renderPrizeTab({
      prizes: [
        { ...prize, status: 'ended' },
        { ...prize, id: 'g-3', status: 'active' },
      ],
      prizeWinners: {
        'gift-1': [],
        'g-3': [{ code: '****1', claimedAt: null, day: 'd', user: 'u' }],
      },
    });
    document.body.innerHTML = html;
    expect(document.body.textContent).toContain('还没有人中奖');
    expect(document.body.textContent).toContain('****1');
    expect(document.querySelectorAll('[data-prize-form="codes"]')).toHaveLength(1);
    expect(renderPrizeTab({ prizes: [], prizeWinners: {} })).toContain('还没有限定福利');
  });

  it('shows the login again on 401 and ignores unrelated targets', async () => {
    const c = ctx();
    c.client.listPrizeWinners = vi.fn(async () => {
      throw Object.assign(new Error('no'), { status: 401 });
    });
    document.body.innerHTML =
      '<button data-prize-winners="gift-1"></button><button id="x"></button>';
    const [winners, other] = document.querySelectorAll('button');
    await handlePrizeClick(/** @type {HTMLButtonElement} */ (winners), c);
    expect(c.handleError).toHaveBeenCalled();
    expect(await handlePrizeClick(/** @type {HTMLButtonElement} */ (other), c)).toBe(false);
    c.client.addPrizeCodes = vi.fn(async () => {
      throw Object.assign(new Error('no'), { status: 401 });
    });
    const form = formFrom(
      '<form data-prize-form="codes" data-prize-id="gift-1"><textarea name="codes">A</textarea></form>',
    );
    await handlePrizeSubmit(form, c);
    expect(c.render).toHaveBeenCalled();
    document.body.innerHTML = '<form></form>';
    expect(
      await handlePrizeSubmit(/** @type {HTMLFormElement} */ (document.querySelector('form')), c),
    ).toBe(false);
  });
});
