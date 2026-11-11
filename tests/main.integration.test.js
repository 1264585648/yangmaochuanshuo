// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const $ = (selector) => document.querySelector(selector);
const click = (selector) => $(selector).click();

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  vi.useFakeTimers();
  await import('../src/main.js');
});

afterAll(() => {
  vi.useRealTimers();
});

describe('page wiring', () => {
  it('renders four packs with the AI pool selected', () => {
    const packs = document.querySelectorAll('#packScene .pack');
    expect(packs).toHaveLength(4);
    const selected = document.querySelector('.pack[aria-pressed="true"]');
    expect(selected.classList.contains('pack--ai')).toBe(true);
    expect(selected.dataset.position).toBe('0');
    expect($('#selectedDescription').textContent).toBe('精选 AI 工具、模型体验和 API 额度');
    expect($('#headerRemaining').textContent).toBe('3 / 3');
  });

  it('cycles pools with the arrows and keyboard', () => {
    click('#nextPack');
    expect(document.querySelector('.pack[aria-pressed="true"]').classList).toContain(
      'pack--software',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(document.querySelector('.pack[aria-pressed="true"]').classList).toContain('pack--ai');
  });

  it('opens a pack, spends a draw and shows the result', async () => {
    click('#openPack');
    expect(document.body.classList.contains('is-opening')).toBe(true);
    expect($('#headerRemaining').textContent).toBe('2 / 3');
    expect($('#openPack').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.body.classList.contains('is-opening')).toBe(false);
    expect($('#overlay').hidden).toBe(false);
    expect($('#dialogContent').textContent).toContain('PACK OPENED · AI 福利');
    expect(JSON.parse(localStorage.getItem('dealdex-daily-v1')).used).toBe(1);
    expect(JSON.parse(localStorage.getItem('dealdex-collection-v1'))).toHaveLength(1);
  });

  it('toggles a favourite from the result dialog', () => {
    click('#favoriteResult');
    expect($('#favoriteResult').textContent).toBe('已收藏 ✓');
    expect(JSON.parse(localStorage.getItem('dealdex-favorites-v1'))).toHaveLength(1);
    expect($('#toast').classList.contains('visible')).toBe(true);
  });

  it('closes the dialog with Escape', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('#overlay').hidden).toBe(true);
  });

  it('shows the odds', () => {
    click('#probabilityButton');
    const text = $('#dialogContent').textContent;
    expect(text).toContain('70%');
    expect(text).toContain('25%');
    expect(text).toContain('5%');
    click('#closeDialog');
  });

  it('shows the collection with the drawn card', () => {
    click('[data-nav="collection"]');
    expect($('#dialogContent').textContent).toContain('已发现 1 / 12 张演示卡牌 · 收藏 1 张');
    expect(document.querySelectorAll('.collection-item')).toHaveLength(1);
    click('#closeDialog');
  });

  it('filters the discover list as you type', () => {
    click('[data-nav="discover"]');
    expect(document.querySelectorAll('#offerResults .offer-row')).toHaveLength(12);
    const input = $('#offerSearch');
    input.value = '教育';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('#offerResults .offer-row')).toHaveLength(3);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect($('#offerResults').textContent).toContain('没有找到匹配的演示卡牌');
    click('#closeDialog');
  });

  it('stops at the daily limit', async () => {
    for (let i = 0; i < 2; i++) {
      click('#openPack');
      await vi.advanceTimersByTimeAsync(1100);
      click('#closeDialog');
    }
    expect($('#headerRemaining').textContent).toBe('0 / 3');
    expect($('#openPack').disabled).toBe(true);
    expect($('#openPack').textContent).toContain('明日再来');
  });

  it('recovers from corrupted data written by another tab', () => {
    localStorage.setItem('dealdex-collection-v1', '{"broken":true}');
    window.dispatchEvent(new StorageEvent('storage', { key: 'dealdex-collection-v1' }));
    click('[data-nav="collection"]');
    expect($('#dialogContent').textContent).toContain('已发现 0 / 12');
    click('#closeDialog');
  });

  it('closes on backdrop click and returns focus to the opener', () => {
    const opener = $('#probabilityButton');
    opener.focus();
    opener.click();
    expect(document.activeElement).toBe($('#closeDialog'));
    click('[data-close]');
    expect($('#overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('ignores arrow keys while a dialog is open', () => {
    click('#probabilityButton');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    click('#closeDialog');
    expect(document.querySelector('.pack[aria-pressed="true"]').classList).toContain('pack--ai');
  });

  it('scrolls to top from the home nav', () => {
    click('[data-nav="home"]');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('resets counts when another tab clears storage', () => {
    expect($('#headerRemaining').textContent).toBe('0 / 3');
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect($('#headerRemaining').textContent).toBe('3 / 3');
  });

  it('picks up a daily count written by another tab', () => {
    const today = JSON.parse(localStorage.getItem('dealdex-daily-v1')).day;
    localStorage.setItem('dealdex-daily-v1', JSON.stringify({ day: today, used: 2 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'dealdex-daily-v1' }));
    expect($('#headerRemaining').textContent).toBe('1 / 3');
  });
});
