// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CATALOG, createFakeApi } from './fixtures/fake-api.js';
import { API } from '../src/config.js';

const $ = (selector) => document.querySelector(selector);
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  // A draw from an earlier visit, which must not look expired while loading fails.
  localStorage.setItem('dealdex-collection-v1', JSON.stringify([{ id: 'cloud-vps', ts: 1 }]));
  window.matchMedia = vi.fn(() => ({ matches: false }));
  globalThis.fetch = vi.fn(api.fetch);
  vi.useFakeTimers();
  api.fail(true);
  await import('../src/main.js');
  await settle();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('when the catalog API is unreachable', () => {
  it('explains the failure and offers a retry', () => {
    expect($('#poolStatus').dataset.tone).toBe('error');
    expect($('#poolStatus').textContent).toContain('网络连接失败');
    expect($('#catalogRetry').hidden).toBe(false);
    expect($('#openPack').disabled).toBe(true);
    expect($('#openLabel').textContent).toBe('暂不可用');
  });

  it('shows the odds dialog without per-pool rates', () => {
    $('#probabilityButton').click();
    expect($('.odds-table')).toBeNull();
    expect($('#dialogContent').textContent).toContain('70%');
    $('#closeDialog').click();
  });

  it('does not mark stored draws as expired while the catalog is unavailable', () => {
    $('[data-nav="collection"]').click();
    const text = $('#dialogContent').textContent;
    expect(text).toContain('网络连接失败');
    expect(text).not.toContain('已过期或下架');
    expect(text).not.toContain('0 / 0');
    $('#closeDialog').click();
  });

  it('stays in the error state when a retry also fails', async () => {
    const calls = api.calls.length;
    $('#catalogRetry').click();
    await settle();
    expect(api.calls.length).toBe(calls + 1);
    expect($('#poolStatus').dataset.tone).toBe('error');
  });

  it('reloads automatically when the browser comes back online', async () => {
    api.fail(false);
    window.dispatchEvent(new Event('online'));
    await settle();
    expect($('#poolStatus').dataset.tone).toBe('ready');
    expect($('#catalogRetry').hidden).toBe(true);
    expect($('#openPack').disabled).toBe(false);
  });
});

describe('when the pool empties between load and draw', () => {
  it('refreshes a stale catalog before drawing and spends nothing', async () => {
    await settle(API.catalogTtlMs);
    api.setOffers(CATALOG.filter((o) => o.pool !== 'ai'));
    const before = api.calls.length;
    $('#openPack').click();
    await settle(1200);
    expect(api.calls.length).toBeGreaterThan(before);
    expect($('#overlay').hidden).toBe(true);
    expect($('#toast').textContent).toContain('暂时没有有效福利');
    expect($('#headerRemaining').textContent).toBe('3 / 3');
    expect(JSON.parse(localStorage.getItem('dealdex-daily-v1')).used).toBe(0);
    expect(JSON.parse(localStorage.getItem('dealdex-collection-v1'))).toHaveLength(1);
    expect($('#openLabel').textContent).toBe('卡池补充中');
  });

  it('removes the fizzle class so later openings still animate', async () => {
    expect($('#packScene').classList.contains('is-fizzle')).toBe(true);
    await settle(500);
    expect($('#packScene').classList.contains('is-fizzle')).toBe(false);
  });

  it('does not wait for a refresh slower than the animation', async () => {
    $('#prevPack').click();
    await settle(API.catalogTtlMs);
    api.hold();
    $('#openPack').click();
    await settle(1200);
    expect($('#overlay').hidden).toBe(false);
    expect($('#dialogContent').textContent).toContain('VPS 折扣');
    api.release();
    await settle();
    $('#closeDialog').click();
    await settle(250);
  });

  it('keeps drawing from cached offers when a refresh fails', async () => {
    expect(document.querySelector('.pack[aria-pressed="true"]').classList).toContain('pack--cloud');
    await settle(API.catalogTtlMs);
    api.fail(true);
    $('#openPack').click();
    await settle(1200);
    expect($('#overlay').hidden).toBe(false);
    expect($('#dialogContent').textContent).toContain('VPS 折扣');
    expect($('#headerRemaining').textContent).toBe('1 / 3');
  });
});
