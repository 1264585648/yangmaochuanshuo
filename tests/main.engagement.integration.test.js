// @vitest-environment jsdom
/* Lobby: official-link click counting, reporting a card, general feedback and
   the community group entry, against the in-memory API. */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFakeApi } from './fixtures/fake-api.js';
import { jsonResponse } from './fixtures/offers.js';

const $ = (selector) => document.querySelector(selector);
const api = createFakeApi();
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/** Requests to the beta endpoints, as `METHOD path` plus parsed JSON bodies. */
const beta = [];
const COMMUNITY = {
  title: '羊毛传说内测群',
  description: '扫码进群',
  link: null,
  linkLabel: '',
  qr: { src: '/api/community/qr?v=abc', expiresAt: '2026-11-18T00:00:00Z' },
};

async function fetchImpl(url, init = {}) {
  const { pathname } = new URL(String(url), 'https://dealdex.test');
  const method = init.method ?? 'GET';
  if (
    pathname === '/api/community' ||
    pathname === '/api/feedback' ||
    pathname.endsWith('/click')
  ) {
    beta.push({ call: `${method} ${pathname}`, body: init.body ? JSON.parse(init.body) : null });
    if (pathname === '/api/community') {
      return jsonResponse({ success: true, data: COMMUNITY, error: null });
    }
    if (pathname === '/api/feedback') {
      return jsonResponse({ success: true, data: { id: 1 }, error: null }, 201);
    }
    return jsonResponse({ success: true, data: { recorded: true }, error: null });
  }
  return api.fetch(url, init);
}

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(fetchImpl);
  vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  await import('../src/main.js');
  await settle();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('lobby beta entries', () => {
  it('shows the community entry once the group has loaded, with its QR code', async () => {
    expect($('#communityButton').hidden).toBe(false);
    $('#communityButton').click();
    expect($('#dialogContent img').getAttribute('src')).toBe('/api/community/qr?v=abc');
    expect($('#dialogContent').textContent).toContain('2026-11-18 前有效');
    $('#closeDialog').click();
    await settle(250);
  });

  it('counts a click on the official link in the result dialog', async () => {
    $('#openPack').click();
    await settle(1200);
    const link = $('#dialogContent a[data-official-offer]');
    expect(link).not.toBeNull();
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.click();
    await settle();
    const id = link.dataset.officialOffer;
    expect(beta.map((b) => b.call)).toContain(`POST /api/offers/${id}/click`);
  });

  it('reports a problem with the drawn card', async () => {
    const id = $('#dialogContent a[data-official-offer]').dataset.officialOffer;
    $('#reportOffer').click();
    expect($('#dialogTitle').textContent).toBe('反馈这张福利的问题');
    $('input[name="category"][value="link_broken"]').click();
    $('#feedbackForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const sent = beta.find((b) => b.call === 'POST /api/feedback');
    expect(sent.body).toEqual({
      kind: 'offer',
      offerId: id,
      category: 'link_broken',
      message: '',
      contact: '',
    });
    expect($('#dialogTitle').textContent).toBe('收到，谢谢你');
    $('#closeDialog').click();
    await settle(250);
  });

  it('collects general feedback from the footer', async () => {
    $('#feedbackButton').click();
    expect($('#dialogTitle').textContent).toBe('意见反馈');
    $('#feedbackForm textarea').value = '希望增加设计工具类福利';
    $('#feedbackForm input[name="contact"]').value = 'wx-123';
    $('#feedbackForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const sent = beta.filter((b) => b.call === 'POST /api/feedback').at(-1);
    expect(sent.body).toEqual({
      kind: 'general',
      category: 'suggestion',
      message: '希望增加设计工具类福利',
      contact: 'wx-123',
    });
  });
});
