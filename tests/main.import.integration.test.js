// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TIMINGS } from '../src/config.js';
import { createFakeApi } from './fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

let releaseImport = () => {};

const LEGACY = {
  'dealdex-collection-v1': [
    { id: 'cloud-vps', ts: Date.parse('2026-11-01T00:00:00Z') },
    { id: 'gone-card', ts: Date.parse('2026-10-01T00:00:00Z') },
  ],
  'dealdex-favorites-v1': ['cloud-vps', 'gone-card'],
  'dealdex-daily-v1': { day: '2026-11-12', used: 3 },
};

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  for (const [key, value] of Object.entries(LEGACY)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(api.fetch);
  vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  releaseImport = api.user.holdImports();
  await import('../src/main.js');
  await settle();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('one-time import of pre-account browser data', () => {
  it('holds a draw until the import has settled, so both use one guest', async () => {
    expect(api.user.calls).toContain('POST /api/me/import');
    $('#openPack').click();
    await settle(1200);
    expect(api.user.calls).not.toContain('POST /api/draws');
    releaseImport();
    // The pack bursts open once the draw is in, then the result appears.
    await settle(TIMINGS.burstMs);
    expect(api.user.calls.indexOf('POST /api/draws')).toBeGreaterThan(
      api.user.calls.indexOf('POST /api/me/import'),
    );
    expect($('#overlay').hidden).toBe(false);
    $('#closeDialog').click();
    await settle(250);
  });

  it('sends the legacy collection and favorites, but not the old draw count', () => {
    expect(api.user.calls).toContain('POST /api/me/import');
    // The old local counter said 3 used; the server quota is what counts.
    expect($('#headerRemaining').textContent).toBe('2 / 3');
  });

  it('tells the visitor what moved and removes the legacy keys', () => {
    expect($('#toast').textContent).toBe('已把本机记录的 1 张卡迁入你的图鉴。');
    for (const key of Object.keys(LEGACY)) expect(localStorage.getItem(key)).toBeNull();
  });

  it('shows the imported card, still a favorite, in the collection', async () => {
    $('[data-nav="collection"]').click();
    await settle();
    expect($('#dialogContent').textContent).toContain('VPS 折扣');
    expect($('.collection-item .small-fav')).not.toBeNull();
  });
});
