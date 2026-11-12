// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFakeApi } from './fixtures/fake-api.js';

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

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(api.fetch);
  // Random value 0 → tier A, first card: draws are deterministic.
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => buf.fill(0));
  vi.useFakeTimers();
  api.hold();
  await import('../src/main.js');
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('lobby with the live catalog', () => {
  it('shows a loading state until the catalog arrives', async () => {
    expect(document.querySelectorAll('#packScene .pack')).toHaveLength(4);
    expect(selectedPack().classList).toContain('pack--ai');
    expect($('#openPack').disabled).toBe(true);
    expect($('#openLabel').textContent).toBe('载入卡池…');
    expect($('#poolStatus').dataset.tone).toBe('loading');
    api.release();
    await settle();
    expect(api.calls[0]).toBe('/api/offers?limit=100&offset=0');
  });

  it('shows live counts and enables opening', () => {
    expect($('#poolStatus').textContent).toBe('收录 3 张有效福利');
    expect($('#openPack').disabled).toBe(false);
    expect($('#openLabel').textContent).toBe('打开卡包');
    expect(selectedPack().querySelector('.pack-count').textContent).toBe('3 张');
    expect($('.pack--software').classList).toContain('is-empty');
    expect($('.pack--software .pack-count').textContent).toBe('补充中');
  });

  it('disables opening on an empty pool and cycles with arrows and keys', () => {
    click('#nextPack');
    expect(selectedPack().classList).toContain('pack--software');
    expect($('#openPack').disabled).toBe(true);
    expect($('#openLabel').textContent).toBe('卡池补充中');
    expect($('#poolStatus').dataset.tone).toBe('empty');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(selectedPack().classList).toContain('pack--ai');
  });
});

describe('opening a pack', () => {
  it('animates, then spends a draw and reveals a real offer', async () => {
    click('#openPack');
    expect(document.body.classList.contains('is-opening')).toBe(true);
    expect($('#openLabel').textContent).toBe('开启中…');
    // Nothing is spent until a card is actually drawn.
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
    expect(text).toContain('每日 50 次');
    expect($('.official-link').getAttribute('href')).toBe('https://www.example.com/deal');
    expect($('#headerRemaining').textContent).toBe('2 / 3');
    expect(JSON.parse(localStorage.getItem('dealdex-daily-v1')).used).toBe(1);
    expect(JSON.parse(localStorage.getItem('dealdex-collection-v1'))[0].id).toBe('ai-basic');
  });

  it('toggles a favourite from the result dialog', () => {
    click('#favoriteResult');
    expect($('#favoriteResult').textContent).toBe('已收藏 ✓');
    expect($('#favoriteResult').getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('dealdex-favorites-v1'))).toEqual(['ai-basic']);
    expect($('#toast').classList.contains('visible')).toBe(true);
  });

  it('closes with Escape, animating out before hiding', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('#overlay').dataset.state).toBe('closing');
    expect($('.app').inert).toBe(false);
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
    expect(rows.find((r) => r.startsWith('软件工具'))).not.toContain('%');
    expect(rows.find((r) => r.startsWith('AI 福利'))).toContain('5%');
    await closeDialog();
  });

  it('shows the collection and opens a card detail with a way back', async () => {
    click('[data-nav="collection"]');
    expect($('#dialogContent').textContent).toContain('已发现 1 / 5 张有效福利 · 收藏 1 张');
    click('.collection-item');
    expect($('#dialogBack').textContent).toContain('返回图鉴');
    expect($('#dialogContent').textContent).toContain('对话额度');
    click('#dialogBack');
    expect($('.collection-grid')).not.toBeNull();
    await closeDialog();
  });

  it('links 发现优惠 to the standalone catalog page instead of a dialog', () => {
    const link = $('#discoverLink');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/offers');
    expect(document.querySelector('[data-nav="discover"]')).toBeNull();
  });

  it('links the result and detail views to the offer page', async () => {
    click('[data-nav="collection"]');
    click('.collection-item');
    expect($('.offer-page-link').getAttribute('href')).toBe('/offers/ai-basic');
    await closeDialog();
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
    // The close button is the only focusable element here.
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

describe('local state', () => {
  it('drops stale ids from the collection view', async () => {
    const stored = JSON.parse(localStorage.getItem('dealdex-collection-v1'));
    localStorage.setItem(
      'dealdex-collection-v1',
      JSON.stringify([{ id: 'ai-a', ts: 1 }, ...stored]),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'dealdex-collection-v1' }));
    click('[data-nav="collection"]');
    expect($('#dialogContent').textContent).toContain('另有 1 张曾抽到的卡已过期或下架');
    expect(document.querySelectorAll('.collection-item')).toHaveLength(1);
    await closeDialog();
  });

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

  it('resets counts when another tab clears storage', () => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect($('#headerRemaining').textContent).toBe('3 / 3');
  });

  it('picks up a daily count written by another tab', () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    localStorage.setItem('dealdex-daily-v1', JSON.stringify({ day, used: 2 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'dealdex-daily-v1' }));
    expect($('#headerRemaining').textContent).toBe('1 / 3');
  });

  it('scrolls to top from the home nav', () => {
    click('[data-nav="home"]');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
