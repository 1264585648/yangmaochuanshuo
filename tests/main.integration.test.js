// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CATALOG, createFakeApi } from './fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const click = (selector) => $(selector).click();
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const selectedPack = () => document.querySelector('.pack[aria-pressed="true"]');

async function openAndReveal() {
  click('#openPack');
  await settle(1200);
}

async function closeDialog() {
  click('#closeDialog');
  await settle(250);
}

async function openCollection() {
  click('[data-nav="collection"]');
  await settle();
}

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(api.fetch);
  // 10:00 UTC is 18:00 in Beijing; the quota day ends at 16:00 UTC.
  vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  api.hold();
  await import('../src/main.js');
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('lobby with the live catalog and server quota', () => {
  it('shows a loading state until the catalog and quota arrive', async () => {
    expect(document.querySelectorAll('#packScene .pack')).toHaveLength(4);
    expect(selectedPack().classList).toContain('pack--ai');
    expect($('#openPack').disabled).toBe(true);
    expect($('#openLabel').textContent).toBe('载入卡池…');
    expect($('#headerRemaining').textContent).toBe('– / 3');
    api.release();
    await settle();
    expect(api.calls[0]).toBe('/api/offers?limit=100&offset=0');
    expect(api.user.calls).toContain('GET /api/me');
    expect($('#headerRemaining').textContent).toBe('3 / 3');
  });

  it('shows live counts and enables opening', () => {
    expect($('#poolStatus').textContent).toBe('收录 3 张有效福利');
    expect($('#openPack').disabled).toBe(false);
    expect($('#openLabel').textContent).toBe('打开卡包');
    expect(selectedPack().querySelector('.pack-count').textContent).toBe('3 张');
    expect($('.pack--software').classList).toContain('is-empty');
  });

  it('disables opening on an empty pool and cycles with arrows and keys', () => {
    click('#nextPack');
    expect(selectedPack().classList).toContain('pack--software');
    expect($('#openPack').disabled).toBe(true);
    expect($('#openLabel').textContent).toBe('卡池补充中');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(selectedPack().classList).toContain('pack--ai');
  });

  it('does not import anything when there is no legacy browser data', () => {
    expect(api.user.calls.some((c) => c.includes('/api/me/import'))).toBe(false);
  });
});

describe('opening a pack', () => {
  it('draws on the server during the animation and reveals the card', async () => {
    click('#openPack');
    expect(document.body.classList.contains('is-opening')).toBe(true);
    expect($('#openLabel').textContent).toBe('开启中…');
    expect($('#headerRemaining').textContent).toBe('3 / 3');
    // Other dialogs cannot open over the pending result.
    click('#probabilityButton');
    click('[data-nav="collection"]');
    expect($('#overlay').hidden).toBe(true);
    await settle(1200);
    expect(document.body.classList.contains('is-opening')).toBe(false);
    expect($('#overlay').hidden).toBe(false);
    const text = $('#dialogContent').textContent;
    expect(text).toContain('PACK OPENED · AI 福利');
    expect(text).toContain('对话额度');
    expect($('.official-link').getAttribute('href')).toBe('https://www.example.com/deal');
    expect($('#headerRemaining').textContent).toBe('2 / 3');
    expect(api.user.used).toBe(1);
    // Nothing about draws is kept in the browser any more.
    expect(localStorage.length).toBe(0);
  });

  it('saves a favourite on the server from the result dialog', async () => {
    click('#favoriteResult');
    expect($('#favoriteResult').textContent).toBe('已收藏 ✓');
    expect($('#favoriteResult').getAttribute('aria-pressed')).toBe('true');
    await settle();
    expect(api.user.favorites.has('ai-basic')).toBe(true);
    expect($('#toast').textContent).toBe('已加入收藏');
  });

  it('closes with Escape, animating out before hiding', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('#overlay').dataset.state).toBe('closing');
    // The open button was disabled mid-animation; focus still returns to it.
    expect(document.activeElement).toBe($('#openPack'));
    await settle(250);
    expect($('#overlay').hidden).toBe(true);
  });
});

describe('dialogs', () => {
  it('shows odds computed from the live pools', async () => {
    click('#probabilityButton');
    const rows = [...document.querySelectorAll('.odds-table tbody tr')].map((r) => r.textContent);
    expect(rows.find((r) => r.startsWith('云服务器'))).toContain('100%');
    expect(rows.find((r) => r.startsWith('AI 福利'))).toContain('5%');
    expect($('#dialogContent').textContent).toContain('抽卡在服务器完成');
    await closeDialog();
  });

  it('explains the daily reset in Beijing time', async () => {
    click('#headerCount');
    expect($('#dialogContent').textContent).toContain('北京时间 0 点');
    expect($('#dialogContent').textContent).toContain('今天还可以打开 2 个卡包');
    await closeDialog();
  });

  it('loads the collection from the server, with progress and history', async () => {
    click('[data-nav="collection"]');
    expect($('#dialogContent').textContent).toContain('正在载入你的图鉴');
    await settle();
    const text = $('#dialogContent').textContent;
    expect(text).toContain('已发现 1 / 5 张有效福利 · 收藏 1 张');
    expect(text).toContain('最近抽卡');
    expect(document.querySelectorAll('.history-row')).toHaveLength(1);
    const aiBar = [...document.querySelectorAll('.progress-row')].find((r) =>
      r.textContent.startsWith('AI 福利'),
    );
    expect(aiBar.textContent).toContain('1 / 3');
    expect(aiBar.querySelector('.progress-fill').style.width).toBe('33%');
    await closeDialog();
  });

  it('opens a card detail with a way back', async () => {
    await openCollection();
    click('.collection-item');
    expect($('#dialogBack').textContent).toContain('返回图鉴');
    expect($('#dialogContent').textContent).toContain('对话额度');
    expect($('.offer-page-link').getAttribute('href')).toBe('/offers/ai-basic');
    expect($('#favoriteResult').getAttribute('aria-pressed')).toBe('true');
    click('#dialogBack');
    await settle();
    expect($('.collection-grid')).not.toBeNull();
    await closeDialog();
  });

  it('ignores a collection reply that arrives after the dialog was closed', async () => {
    api.hold();
    click('[data-nav="collection"]');
    await closeDialog();
    api.release();
    await settle();
    expect($('#overlay').hidden).toBe(true);
  });

  it('links 发现优惠 to the standalone catalog page instead of a dialog', () => {
    const link = $('#discoverLink');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/offers');
  });

  it('closes on backdrop click and returns focus to the opener', async () => {
    const opener = $('#probabilityButton');
    opener.focus();
    opener.click();
    expect(document.activeElement).toBe($('#closeDialog'));
    expect($('.app').inert).toBe(true);
    click('[data-close]');
    expect(document.activeElement).toBe(opener);
    await settle(250);
    expect($('#overlay').hidden).toBe(true);
  });

  it('traps Tab focus inside the dialog', async () => {
    click('#probabilityButton');
    const close = $('#closeDialog');
    close.focus();
    const tab = (shiftKey) =>
      $('#overlay').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
      );
    expect(tab(false)).toBe(false);
    expect(tab(true)).toBe(false);
    expect(document.activeElement).toBe(close);
    await closeDialog();
  });

  it('ignores arrow keys while a dialog is open', async () => {
    click('#probabilityButton');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await closeDialog();
    expect(selectedPack().classList).toContain('pack--ai');
  });
});

describe('retired cards', () => {
  it('keeps a retired card in the collection, showing only its name', async () => {
    api.setOffers(CATALOG.filter((o) => o.id !== 'ai-basic'));
    await openCollection();
    expect($('.collection-item').classList).toContain('is-retired');
    expect($('#dialogContent').textContent).toContain('其中 1 张已下架或过期');
    click('.collection-item');
    const text = $('#dialogContent').textContent;
    expect(text).toContain('已下架');
    expect(text).toContain('对话额度');
    expect($('.official-link')).toBeNull();
    click('#dialogBack');
    await settle();
    await closeDialog();
    api.setOffers(CATALOG);
  });
});

describe('daily quota', () => {
  it('stops at the daily limit', async () => {
    for (let i = 0; i < 2; i++) {
      await openAndReveal();
      await closeDialog();
    }
    expect($('#headerRemaining').textContent).toBe('0 / 3');
    expect($('#openPack').disabled).toBe(true);
    // The disabled open button cannot take focus back; a fallback does.
    expect(document.activeElement).toBe($('#probabilityButton'));
    expect($('#openLabel').textContent).toBe('明日再来');
  });

  it('refreshes by itself at Beijing midnight', async () => {
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 2000);
    expect($('#headerRemaining').textContent).toBe('3 / 3');
    expect($('#openPack').disabled).toBe(false);
  });

  it('re-reads the quota when the page becomes visible again', async () => {
    const before = api.user.calls.filter((c) => c === 'GET /api/me').length;
    vi.setSystemTime(new Date('2026-11-13T16:00:01Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(api.user.calls.filter((c) => c === 'GET /api/me').length).toBe(before + 1);
  });

  it('scrolls to top from the home nav', () => {
    click('[data-nav="home"]');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
