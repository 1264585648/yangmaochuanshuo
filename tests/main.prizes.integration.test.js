// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFakeApi } from './fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const click = (selector) => $(selector).click();
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

const RULE = {
  id: 'gift-1',
  title: '某 AI 会员一个月',
  description: '打开兑换页输入兑换码',
  valueNote: '价值约 20 元',
  chance: 0.05,
  total: 3,
  remaining: 3,
  startsAt: null,
  endsAt: '2026-12-01T00:00:00Z',
};

const WON = {
  id: 'gift-1',
  title: '某 AI 会员一个月',
  description: '打开兑换页输入兑换码',
  redeemUrl: 'https://example.com/redeem',
  code: 'ABCD-<b>-1234',
  claimedAt: '2026-11-12T10:00:01Z',
};

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(api.fetch);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
  vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  api.setPrizes([RULE]);
  await import('../src/main.js');
  await settle();
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('limited prizes in the lobby', () => {
  it('shows the entry and the public rules', async () => {
    expect($('#prizeButton').hidden).toBe(false);
    click('#prizeButton');
    await settle();
    const text = $('#dialogContent').textContent;
    expect(text).toContain('某 AI 会员一个月');
    expect(text).toContain('5%');
    expect(text).toContain('剩余 3 / 3 份');
    expect(text).toContain('最多中奖 1 次');
    click('#closeDialog');
    await settle(250);
  });

  it('reveals a won code with the card, escaped, and copies it', async () => {
    api.user.winNext(WON);
    api.setPrizes([{ ...RULE, remaining: 2 }]);
    click('#openPack');
    await settle(1200);
    const content = $('#dialogContent');
    expect(content.textContent).toContain('额外抽中了一份限定福利');
    expect($('.prize-code').textContent).toBe('ABCD-<b>-1234');
    expect(content.querySelector('.prize-code b')).toBeNull();
    expect(content.querySelector('a[href="https://example.com/redeem"]')).not.toBeNull();
    click('.prize-copy');
    await settle();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD-<b>-1234');
    click('#closeDialog');
    await settle(250);
  });

  it('keeps the code in the collection', async () => {
    click('[data-nav="collection"]');
    await settle();
    expect($('#dialogContent').textContent).toContain('我的限定福利');
    expect($('.prize-code').textContent).toBe('ABCD-<b>-1234');
    click('#closeDialog');
    await settle(250);
  });

  it('shows no prize block on an ordinary draw', async () => {
    click('#openPack');
    await settle(1200);
    expect($('.prize-won')).toBeNull();
    expect($('#dialogContent').textContent).toContain('本站不发放兑换码或资格');
  });
});
