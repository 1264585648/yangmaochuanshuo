// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mountCatalogPage } from '../../src/app/catalog-page.js';
import { createApiClient } from '../../src/api/client.js';
import { catalogList } from '../../src/ui/catalog-page.js';
import { normalizeOffer } from '../../src/domain/offer.js';
import { CATALOG, createFakeApi } from '../fixtures/fake-api.js';

const $ = (selector) => document.querySelector(selector);
const rows = () =>
  [...document.querySelectorAll('.catalog-card-title a')].map((a) => a.textContent);
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

let template;
let fake;
let view;

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'offers.html'), 'utf8');
  template = html.replace(/<script[\s\S]*?<\/script>/g, '');
});

/** Load the bare template at `path`, optionally with server-rendered main content. */
function mount(path, { ssr = null, debounceMs = 100, failing = false } = {}) {
  window.history.replaceState(null, '', path);
  document.documentElement.innerHTML = template;
  if (ssr !== null) $('#catalogMain').innerHTML = ssr;
  fake = createFakeApi();
  fake.fail(failing);
  const api = createApiClient({ timeoutMs: 1000, fetchImpl: vi.fn(fake.fetch) });
  view = mountCatalogPage({ main: $('#catalogMain'), api, win: window, debounceMs });
  return view;
}

const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  view?.dispose();
  vi.useRealTimers();
});

describe('client rendering without server content', () => {
  it('renders the list from the URL filters', async () => {
    mount('/offers?pool=ai');
    expect(document.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    await settle();
    expect(fake.calls[0]).toBe('/api/offers?pool=ai&limit=20&offset=0');
    expect(rows()).toEqual(['对话额度', 'API 试用金', '编程助手']);
    expect($('#catalogTitle').textContent).toBe('AI 福利目录');
    expect($('input[name="pool"][value="ai"]').checked).toBe(true);
    expect(document.title).toBe('AI 福利目录 | DealDex');
    expect($('link[rel="canonical"]').getAttribute('href')).toBe(
      `${window.location.origin}/offers?pool=ai`,
    );
  });

  it('shows source links and absolute verification dates on each card', async () => {
    mount('/offers');
    await settle();
    expect(document.querySelectorAll('.catalog-card')).toHaveLength(CATALOG.length);
    expect(document.querySelectorAll('.catalog-card .source-link')).toHaveLength(CATALOG.length);
    expect($('.catalog-card time').getAttribute('datetime')).toBe('2026-11-10');
  });

  it('renders a detail page from a deep link', async () => {
    mount('/offers/ai-pro');
    await settle();
    expect(fake.calls[0]).toBe('/api/offers/ai-pro');
    expect($('[data-view="detail"] h1').textContent).toBe('编程助手');
    expect(document.title).toBe('编程助手 · 示例提供方 | DealDex');
  });

  it('shows the withdrawn page for an unknown or malformed id', async () => {
    mount('/offers/gone-offer');
    await settle();
    expect($('[data-view="missing"]')).not.toBeNull();
    expect($('meta[name="robots"]').getAttribute('content')).toBe('noindex, follow');
    expect($('link[rel="canonical"]')).toBeNull();
    view.dispose();
    mount('/offers/Bad_Id');
    expect(fake.calls).toHaveLength(0);
    expect($('[data-view="missing"]')).not.toBeNull();
  });
});

describe('filters', () => {
  it('pushes a linkable URL when a pool or condition changes', async () => {
    mount('/offers');
    await settle();
    const ai = $('input[name="pool"][value="ai"]');
    ai.checked = true;
    change(ai);
    await settle();
    expect(window.location.pathname + window.location.search).toBe('/offers?pool=ai');
    expect(rows()).toHaveLength(3);

    const student = $('select[name="studentOnly"]');
    student.value = 'true';
    change(student);
    await settle();
    expect(window.location.search).toBe('?pool=ai&studentOnly=true');
    expect(fake.calls.at(-1)).toContain('pool=ai&studentOnly=true');
    expect($('#catalogStatus').textContent).toBe('共 0 张');
    expect(window.history.length).toBeGreaterThanOrEqual(3);
  });

  it('debounces typing and replaces the history entry', async () => {
    mount('/offers');
    await settle();
    const length = window.history.length;
    const input = $('#catalogSearch');
    input.value = '学生';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '学生礼';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(150);
    expect(fake.calls).toHaveLength(2);
    expect(decodeURIComponent(window.location.search)).toBe('?q=学生礼');
    expect(window.history.length).toBe(length);
    expect(rows()).toEqual(['学生礼包']);
    // Focus stays in the search box: the form is not re-rendered.
    expect($('#catalogSearch')).toBe(input);
  });

  it('submits the form without a page reload', async () => {
    mount('/offers');
    await settle();
    $('select[name="rarity"]').value = 'S';
    const event = new Event('submit', { bubbles: true, cancelable: true });
    $('.catalog-filters').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(window.location.search).toBe('?rarity=S');
    expect(rows()).toEqual(['API 试用金', '学生礼包']);
  });
});

describe('navigation', () => {
  it('opens a card in place, then goes back with popstate', async () => {
    mount('/offers');
    await settle();
    $('.catalog-card-title a').click();
    await settle();
    expect(window.location.pathname).toBe(`/offers/${CATALOG[0].id}`);
    expect($('[data-view="detail"]')).not.toBeNull();
    expect(document.activeElement).toBe($('#catalogTitle'));

    window.history.back();
    await settle();
    // jsdom fires popstate asynchronously after history.back().
    await vi.waitFor(() => expect($('[data-view="list"]')).not.toBeNull());
    await settle();
    expect(rows()).toHaveLength(CATALOG.length);
  });

  it('re-syncs form controls on popstate', async () => {
    mount('/offers');
    await settle();
    const ai = $('input[name="pool"][value="ai"]');
    ai.checked = true;
    change(ai);
    await settle();
    window.history.replaceState(null, '', '/offers?pool=cloud&autoRenews=false');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect($('input[name="pool"][value="cloud"]').checked).toBe(true);
    expect($('select[name="autoRenews"]').value).toBe('false');
    expect(rows()).toEqual(['VPS 折扣']);
    // An advanced filter is active, so 更多筛选 opens to show it.
    expect($('details.catalog-more').open).toBe(true);
  });

  it('never folds 更多筛选 away on its own', async () => {
    mount('/offers');
    await settle();
    const more = $('details.catalog-more');
    expect(more.open).toBe(false);
    more.open = true;
    window.history.replaceState(null, '', '/offers?pool=ai');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect($('details.catalog-more').open).toBe(true);
  });

  it('leaves modified clicks and external links to the browser', async () => {
    mount('/offers');
    await settle();
    const link = $('.catalog-card-title a');
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    const external = $('.catalog-card .source-link');
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    external.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/offers');
  });

  it('follows pagination links', async () => {
    window.history.replaceState(null, '', '/offers');
    document.documentElement.innerHTML = template;
    fake = createFakeApi();
    const api = createApiClient({ timeoutMs: 1000, fetchImpl: vi.fn(fake.fetch) });
    view = mountCatalogPage({
      main: $('#catalogMain'),
      api,
      win: window,
      debounceMs: 100,
      pageSize: 2,
    });
    await settle();
    expect($('.page-status').textContent).toBe('第 1 / 3 页');
    $('a[rel="next"]').click();
    await settle();
    expect(window.location.search).toBe('?page=2');
    expect(fake.calls.at(-1)).toContain('limit=2&offset=2');
    expect(window.scrollTo).toHaveBeenCalled();
  });
});

describe('server-rendered content', () => {
  it('keeps the server markup and does not refetch on load', async () => {
    const offers = CATALOG.map(normalizeOffer);
    mount('/offers', { ssr: catalogList({ offers, total: offers.length, filters: { page: 1 } }) });
    await settle();
    expect(fake.calls).toHaveLength(0);
    expect(rows()).toHaveLength(CATALOG.length);
    const ai = $('input[name="pool"][value="ai"]');
    ai.checked = true;
    change(ai);
    await settle();
    expect(fake.calls).toHaveLength(1);
    expect(rows()).toHaveLength(3);
  });
});

describe('failures', () => {
  it('shows a retryable error for the list', async () => {
    mount('/offers', { ssr: '', failing: true });
    await settle();
    expect($('#catalogResults [role="alert"]').textContent).toContain('网络连接失败');
    fake.fail(false);
    $('#catalogReload').click();
    await settle();
    expect(rows()).toHaveLength(CATALOG.length);
  });

  it('shows a retryable error for a detail page', async () => {
    mount('/offers/ai-pro', { failing: true });
    await settle();
    expect($('[role="alert"]').textContent).toContain('网络连接失败');
    fake.fail(false);
    $('#catalogReload').click();
    await settle();
    expect($('[data-view="detail"]')).not.toBeNull();
  });

  it('ignores a stale response that arrives after a newer navigation', async () => {
    mount('/offers', { ssr: '' });
    fake.hold();
    const ai = document.querySelector('input[name="pool"][value="ai"]');
    // The skeleton list view renders the form immediately.
    ai.checked = true;
    change(ai);
    fake.release();
    await settle();
    expect(rows()).toHaveLength(3);
  });

  it('stops listening after dispose', async () => {
    mount('/offers');
    await settle();
    view.dispose();
    const calls = fake.calls.length;
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle();
    expect(fake.calls).toHaveLength(calls);
  });
});
