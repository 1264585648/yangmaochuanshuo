import { describe, it, expect } from 'vitest';
import {
  CATALOG_PAGE_SIZE,
  catalogHref,
  catalogSearch,
  isIndexable,
  MAX_PAGE,
  offerHref,
  parseCatalogParams,
  parseCatalogPath,
  toApiQuery,
} from '../../src/domain/catalog-query.js';

const params = (text) => new URLSearchParams(text);

describe('parseCatalogParams', () => {
  it('reads every supported filter', () => {
    const filters = parseCatalogParams(
      params(
        'pool=ai&rarity=SSR&newUsersOnly=false&studentOnly=true&requiresPaymentMethod=false&autoRenews=false&q=%20gpu%20&page=3',
      ),
    );
    expect(filters).toEqual({
      pool: 'ai',
      rarity: 'SSR',
      newUsersOnly: 'false',
      studentOnly: 'true',
      requiresPaymentMethod: 'false',
      autoRenews: 'false',
      q: 'gpu',
      page: 3,
    });
    expect(Object.isFrozen(filters)).toBe(true);
  });

  it('drops unknown, invalid and empty values instead of failing', () => {
    expect(
      parseCatalogParams(
        params('pool=moon&rarity=ss&studentOnly=yes&q=%20%20&page=0&utm_source=x&limit=5'),
      ),
    ).toEqual({ page: 1 });
  });

  it('clamps and sanitises the page number', () => {
    expect(parseCatalogParams(params('page=abc')).page).toBe(1);
    expect(parseCatalogParams(params('page=2.5')).page).toBe(1);
    expect(parseCatalogParams(params(`page=${MAX_PAGE + 10}`)).page).toBe(MAX_PAGE);
  });

  it('truncates very long searches to the API limit', () => {
    expect(parseCatalogParams(params(`q=${'x'.repeat(150)}`)).q).toHaveLength(100);
  });
});

describe('catalogSearch / catalogHref', () => {
  it('serialises filters in a stable order and omits page 1', () => {
    const filters = parseCatalogParams(params('q=gpu&page=1&pool=ai&autoRenews=false'));
    expect(catalogSearch(filters)).toBe('?pool=ai&autoRenews=false&q=gpu');
    expect(catalogHref(filters)).toBe('/offers?pool=ai&autoRenews=false&q=gpu');
  });

  it('keeps later pages and gives the bare path without filters', () => {
    expect(catalogHref({ page: 2 })).toBe('/offers?page=2');
    expect(catalogHref({ page: 1 })).toBe('/offers');
  });

  it('round-trips through parse', () => {
    const text = 'pool=cloud&rarity=S&studentOnly=true&q=%E5%AD%A6%E7%94%9F&page=4';
    const filters = parseCatalogParams(params(text));
    expect(parseCatalogParams(params(catalogSearch(filters).slice(1)))).toEqual(filters);
  });
});

describe('offerHref', () => {
  it('encodes the id into the path', () => {
    expect(offerHref('gpu-credit')).toBe('/offers/gpu-credit');
    expect(offerHref('a/b?c')).toBe('/offers/a%2Fb%3Fc');
  });
});

describe('toApiQuery', () => {
  it('maps a page number to limit and offset', () => {
    const filters = parseCatalogParams(params('pool=ai&studentOnly=true&q=x&page=3'));
    expect(toApiQuery(filters)).toEqual({
      pool: 'ai',
      studentOnly: 'true',
      q: 'x',
      limit: CATALOG_PAGE_SIZE,
      offset: 2 * CATALOG_PAGE_SIZE,
    });
    expect(toApiQuery({ page: 1 }, 5)).toEqual({ limit: 5, offset: 0 });
  });
});

describe('parseCatalogPath', () => {
  it.each([
    ['/offers', { kind: 'list' }],
    ['/offers/', { kind: 'list' }],
    ['/offers/gpu-credit', { kind: 'detail', id: 'gpu-credit' }],
    ['/offers/gpu-credit/', { kind: 'detail', id: 'gpu-credit' }],
    ['/offers/Bad_ID', { kind: 'missing' }],
    ['/offers/a/b', { kind: 'missing' }],
    ['/offers/%E0%A4%A', { kind: 'missing' }],
    ['/offers/ab', { kind: 'missing' }],
    ['/', null],
    ['/offersx', null],
  ])('%s', (path, expected) => {
    expect(parseCatalogPath(path)).toEqual(expected);
  });
});

describe('isIndexable', () => {
  it('indexes the full catalog and plain pool pages only', () => {
    expect(isIndexable({ page: 1 })).toBe(true);
    expect(isIndexable({ pool: 'ai', page: 2 })).toBe(true);
    expect(isIndexable({ q: 'gpu', page: 1 })).toBe(false);
    expect(isIndexable({ rarity: 'S', page: 1 })).toBe(false);
    expect(isIndexable({ studentOnly: 'true', page: 1 })).toBe(false);
  });
});
