import { describe, it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const POOL_IDS = ['ai', 'cloud', 'software', 'education'];
const ASSETS = ['../assets/room.svg', '../assets/grain.svg', '../assets/favicon.svg'];
const DOM_HOOKS = ['packScene', 'openPack', 'probabilityButton', 'overlay'];

describe('static smoke checks', () => {
  it('ships every referenced asset', async () => {
    await Promise.all(ASSETS.map((p) => access(new URL(p, import.meta.url))));
  });

  it('exposes the DOM hooks the script relies on', async () => {
    const html = await read('../index.html');
    for (const id of DOM_HOOKS) expect(html).toContain(`id="${id}"`);
  });

  it('defines all four pools', async () => {
    const app = await read('../app.js');
    for (const id of POOL_IDS) expect(app).toMatch(new RegExp(String.raw`id:\s*'${id}'`));
  });

  it('styles the non-default pools explicitly', async () => {
    const css = await read('../styles.css');
    for (const id of POOL_IDS.filter((id) => id !== 'ai')) expect(css).toContain(`pack--${id}`);
  });

  it('keeps the published odds and daily quota', async () => {
    const app = await read('../app.js');
    expect(app).toMatch(/MAX_DRAWS\s*=\s*3/);
    for (const chance of ['0.7', '0.25', '0.05']) {
      const escaped = chance.replace('.', String.raw`\.`);
      expect(app).toMatch(new RegExp(String.raw`chance:\s*${escaped}`));
    }
  });

  it('honours reduced-motion preferences', async () => {
    const css = await read('../styles.css');
    expect(css).toContain('prefers-reduced-motion');
  });
});
