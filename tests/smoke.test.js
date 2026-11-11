import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { POOLS } from '../src/data/pools.js';
import { DEMO_OFFERS } from '../src/data/offers.js';
import { RARITIES } from '../src/domain/draw.js';
import { MAX_DRAWS } from '../src/config.js';

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

  it('has a demo card for every pool and rarity, with unique ids', () => {
    for (const pool of POOL_IDS) {
      for (const { id: rarity } of RARITIES) {
        expect(DEMO_OFFERS.some((o) => o.pool === pool && o.rarity === rarity)).toBe(true);
      }
    }
    expect(new Set(DEMO_OFFERS.map((o) => o.id)).size).toBe(DEMO_OFFERS.length);
  });

  it('keeps the published daily quota', () => {
    expect(MAX_DRAWS).toBe(3);
  });

  it('styles the non-default pools explicitly', async () => {
    const css = await read('../styles.css');
    for (const id of POOL_IDS.filter((id) => id !== 'ai')) expect(css).toContain(`pack--${id}`);
  });

  it('honours reduced-motion preferences', async () => {
    const css = await read('../styles.css');
    expect(css).toContain('prefers-reduced-motion');
  });
});
