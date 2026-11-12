import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { POOLS } from '../src/data/pools.js';
import { DEFAULT_DAILY_DRAWS } from '../src/config.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const POOL_IDS = ['ai', 'cloud', 'software', 'education'];
const ASSETS = ['../assets/room.svg', '../assets/grain.svg', '../assets/favicon.svg'];
const DOM_HOOKS = [
  'packScene',
  'openPack',
  'prevPack',
  'nextPack',
  'probabilityButton',
  'headerCount',
  'headerRemaining',
  'metaRemaining',
  'selectedDescription',
  'overlay',
  'dialogContent',
  'closeDialog',
  'toast',
  'openLabel',
  'poolStatus',
  'catalogRetry',
  'discoverLink',
];

describe('static smoke checks', () => {
  it('ships every referenced asset', async () => {
    await Promise.all(ASSETS.map((p) => access(new URL(p, import.meta.url))));
  });

  it('exposes the DOM hooks the script relies on', async () => {
    const html = await read('../index.html');
    for (const id of DOM_HOOKS) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('src="./src/main.js"');
  });

  it('defines all four pools', () => {
    expect(POOLS.map((p) => p.id).sort()).toEqual([...POOL_IDS].sort());
  });

  it('ships no hardcoded offer data in the bundle', async () => {
    await expect(access(new URL('../src/data/offers.js', import.meta.url))).rejects.toThrow();
    const main = await read('../src/main.js');
    expect(main).not.toMatch(/DEMO_OFFERS|data\/offers/);
  });

  it('keeps the published daily quota', () => {
    expect(DEFAULT_DAILY_DRAWS).toBe(3);
  });

  it('styles the non-default pools explicitly', async () => {
    const css = await read('../styles.css');
    for (const id of POOL_IDS.filter((id) => id !== 'ai')) expect(css).toContain(`pack--${id}`);
  });

  it('ships the catalog page template with its render regions and entry', async () => {
    const html = await read('../offers.html');
    for (const marker of ['catalog-head', 'catalog-main']) {
      expect(html).toContain(`<!--${marker}-->`);
      expect(html).toContain(`<!--/${marker}-->`);
    }
    expect(html).toContain('id="catalogMain"');
    expect(html).toContain('src="/src/catalog.js"');
    expect(html).toContain('href="/styles/catalog.css"');
    await access(new URL('../styles/catalog.css', import.meta.url));
  });

  it('links the component stylesheets', async () => {
    const html = await read('../index.html');
    for (const sheet of ['styles/offers.css', 'styles/motion.css']) {
      expect(html).toContain(`href="./${sheet}"`);
      await access(new URL(`../${sheet}`, import.meta.url));
    }
  });

  it('honours reduced-motion preferences', async () => {
    const css = await read('../styles.css');
    expect(css).toContain('prefers-reduced-motion');
  });
});
