// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { catalogList } from '../src/ui/catalog-page.js';
import { normalizeOffer } from '../src/domain/offer.js';
import { CATALOG, createFakeApi } from './fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const api = createFakeApi();

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'offers.html'), 'utf8');
  window.history.replaceState(null, '', '/offers');
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  // As the Worker sends it: main already holds the rendered list.
  const offers = CATALOG.map(normalizeOffer);
  $('#catalogMain').innerHTML = catalogList({ offers, total: offers.length, filters: { page: 1 } });
  globalThis.fetch = vi.fn(api.fetch);
  window.scrollTo = vi.fn();
  await import('../src/catalog.js');
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('catalog page header', () => {
  it('matches the lobby navigation: 抽卡, 福利图鉴, 发现优惠 in that order', () => {
    const links = [...document.querySelectorAll('.main-nav .nav-link')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/#collection', '/offers']);
    expect(links.map((a) => a.querySelector('.nav-full')?.textContent)).toEqual([
      '抽卡',
      '福利图鉴',
      '发现优惠',
    ]);
    expect(links.map((a) => a.querySelector('.nav-short')?.textContent)).toEqual([
      '抽卡',
      '图鉴',
      '发现',
    ]);
    for (const a of links) {
      expect(a.querySelector('svg')).not.toBeNull();
      expect(a.querySelector('.nav-short').getAttribute('aria-hidden')).toBe('true');
    }
    expect(links[2].getAttribute('aria-current')).toBe('page');
  });
});

describe('catalog page entry', () => {
  it('keeps the server-rendered list without refetching', () => {
    expect(api.calls).toHaveLength(0);
    expect(document.querySelectorAll('.catalog-card')).toHaveLength(CATALOG.length);
  });

  it('takes over filter changes through the live API', async () => {
    const cloud = $('input[name="pool"][value="cloud"]');
    cloud.checked = true;
    cloud.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelectorAll('.catalog-card')).toHaveLength(1));
    expect(api.calls[0]).toBe('/api/offers?pool=cloud&limit=20&offset=0');
    expect(window.location.search).toBe('?pool=cloud');
  });
});
