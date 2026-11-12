// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFakeApi } from './fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.location.hash = '#collection';
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(api.fetch);
  vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  api.hold();
  await import('../src/main.js');
});

afterAll(() => {
  vi.useRealTimers();
});

describe('opening the lobby at /#collection', () => {
  it('opens the collection at once, showing that it is loading', () => {
    expect($('#overlay').hidden).toBe(false);
    expect($('#dialogTitle').textContent).toBe('我的福利图鉴');
    expect($('#dialogContent').textContent).toContain('正在载入你的图鉴');
  });

  it('fills in the collection from the server', async () => {
    api.release();
    await settle();
    expect($('#dialogContent').textContent).toContain('图鉴里还没有卡牌');
    expect($('#dialogContent').textContent).toContain('已发现 0 / 5 张有效福利');
  });

  it('does not reopen it on later catalog updates', async () => {
    $('#closeDialog').click();
    await settle(300);
    $('#catalogRetry').click();
    await settle();
    expect($('#overlay').hidden).toBe(true);
  });
});
