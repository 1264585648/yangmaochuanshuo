// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TIMINGS } from '../src/config.js';
import { CATALOG, createFakeApi } from './fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function openPack() {
  $('#openPack').click();
  await settle(1200);
}

async function closeDialog() {
  $('#closeDialog').click();
  await settle(250);
}

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  globalThis.fetch = vi.fn(api.fetch);
  vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  api.fail(true);
  await import('../src/main.js');
  await settle();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('when the API is unreachable', () => {
  it('explains the failure and offers a retry', () => {
    expect($('#poolStatus').dataset.tone).toBe('error');
    expect($('#poolStatus').textContent).toContain('网络连接失败');
    expect($('#catalogRetry').hidden).toBe(false);
    expect($('#openPack').disabled).toBe(true);
    expect($('#openLabel').textContent).toBe('暂不可用');
    expect($('#headerRemaining').textContent).toBe('– / 3');
  });

  it('shows the odds dialog without per-pool rates', () => {
    $('#probabilityButton').click();
    expect($('.odds-table')).toBeNull();
    expect($('#dialogContent').textContent).toContain('70%');
    $('#closeDialog').click();
  });

  it('reassures that the collection is safe and offers a retry', async () => {
    await settle(250);
    $('[data-nav="collection"]').click();
    await settle();
    const text = $('#dialogContent').textContent;
    expect(text).toContain('网络连接失败');
    expect(text).toContain('没有丢失');
    expect($('#collectionRetry')).not.toBeNull();
    await closeDialog();
  });

  it('stays in the error state when a retry also fails', async () => {
    const calls = api.calls.length;
    $('#catalogRetry').click();
    await settle();
    expect(api.calls.length).toBe(calls + 1);
    expect($('#poolStatus').dataset.tone).toBe('error');
  });

  it('reloads the catalog and the quota when the browser comes back online', async () => {
    api.fail(false);
    window.dispatchEvent(new Event('online'));
    await settle();
    expect($('#poolStatus').dataset.tone).toBe('ready');
    expect($('#catalogRetry').hidden).toBe(true);
    expect($('#openPack').disabled).toBe(false);
    expect($('#headerRemaining').textContent).toBe('3 / 3');
  });
});

describe('when a draw goes wrong', () => {
  it('spends nothing when the pool emptied on the server', async () => {
    api.setOffers(CATALOG.filter((o) => o.pool !== 'ai'));
    await openPack();
    expect($('#overlay').hidden).toBe(true);
    expect($('#toast').textContent).toContain('暂时没有有效福利');
    expect($('#packScene').classList.contains('is-fizzle')).toBe(true);
    expect($('#headerRemaining').textContent).toBe('3 / 3');
    expect(api.user.used).toBe(0);
    // The empty pool also refreshed the catalog.
    await settle();
    expect($('#openLabel').textContent).toBe('卡池补充中');
    api.setOffers(CATALOG);
  });

  it('removes the fizzle class so later openings still animate', async () => {
    await settle(500);
    expect($('#packScene').classList.contains('is-fizzle')).toBe(false);
    $('#catalogRetry').click();
    await settle();
  });

  it('waits for a draw slower than the animation', async () => {
    $('#prevPack').click();
    const release = api.user.holdDraws();
    $('#openPack').click();
    await settle(1200);
    expect(document.body.classList.contains('is-opening')).toBe(true);
    expect($('#overlay').hidden).toBe(true);
    release();
    // The pack bursts open once the draw is in, then the result appears.
    await settle(TIMINGS.burstMs);
    expect($('#overlay').hidden).toBe(false);
    expect($('#dialogContent').textContent).toContain('VPS 折扣');
    await closeDialog();
  });

  it('reuses the key after a lost reply, so the retry does not spend again', async () => {
    api.user.failDraws('lost');
    await openPack();
    expect($('#overlay').hidden).toBe(true);
    expect($('#toast').textContent).toContain('再次开包不会重复扣次');
    expect(api.user.used).toBe(2);
    api.user.failDraws(null);
    await openPack();
    expect($('#overlay').hidden).toBe(false);
    expect(api.user.used).toBe(2);
    expect(api.user.draws).toHaveLength(2);
    expect($('#headerRemaining').textContent).toBe('1 / 3');
    await closeDialog();
  });

  it('reports a server error without spending a draw', async () => {
    api.user.failDraws('server');
    await openPack();
    expect($('#toast').textContent).toContain('服务暂时不可用');
    expect(api.user.used).toBe(2);
    api.user.failDraws(null);
  });

  it('takes the quota from the server when another tab used the last draw', async () => {
    await api.fetch('/api/draws', {
      method: 'POST',
      headers: { 'idempotency-key': 'other-tab' },
      body: JSON.stringify({ pool: 'cloud' }),
    });
    expect($('#headerRemaining').textContent).toBe('1 / 3');
    await openPack();
    expect($('#overlay').hidden).toBe(true);
    expect($('#toast').textContent).toContain('次数已用完');
    expect($('#headerRemaining').textContent).toBe('0 / 3');
    expect($('#openLabel').textContent).toBe('明日再来');
    expect(api.user.used).toBe(3);
  });
});
