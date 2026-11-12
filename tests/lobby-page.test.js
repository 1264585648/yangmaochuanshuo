import { describe, it, expect } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { POOLS } from '../src/data/pools.js';
import { packHTML } from '../src/ui/packs.js';
import { initialView } from '../src/app/lobby.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const LOBBY_NAMES = ['云服务器', 'AI 福利', '软件工具', '教育优惠'];
const SERIF_STACK =
  "Georgia, 'Noto Serif SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Songti SC', 'STSong', serif";

/** @param {string} html */
const textOf = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('lobby naming', () => {
  it('uses one name per pool, in pack order', () => {
    expect(POOLS.map((p) => p.label)).toEqual(LOBBY_NAMES);
    expect(POOLS.map((p) => p.title)).toEqual(LOBBY_NAMES.map((n) => `${n}卡池`));
  });

  it('labels each pack with its pool name', () => {
    expect(packHTML(POOLS[1], 1)).toContain('aria-label="选择AI 福利卡池"');
  });

  it('lists the pools in the hero subtitle in pack order', async () => {
    const html = await read('../index.html');
    const subtitle = html.match(/<p class="subtitle">([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(
      textOf(subtitle)
        .split('·')
        .map((s) => s.trim()),
    ).toEqual(LOBBY_NAMES);
    expect(html).not.toContain('AI 工具 <span>');
  });
});

describe('lobby header', () => {
  it('lets the count pill be named by its visible text', async () => {
    const html = await read('../index.html');
    const pill = html.match(/<button[^>]*id="headerCount"[^>]*>/)?.[0] ?? '';
    expect(pill).not.toContain('aria-label');
    expect(html).toMatch(/class="header-count-icon" aria-hidden="true"/);
  });

  it('keeps a short visible label for each nav item', async () => {
    const html = await read('../index.html');
    expect(html).toMatch(/<span class="nav-extra">福利<\/span>图鉴/);
    expect(html).toMatch(/发现<span class="nav-extra">优惠<\/span>/);
  });
});

describe('initialView', () => {
  it.each([
    ['#collection', 'collection'],
    ['#COLLECTION', null],
    ['#home', null],
    ['', null],
  ])('maps %j to %j', (hash, view) => {
    expect(initialView(hash)).toBe(view);
  });
});

describe('social and icon metadata', () => {
  it('declares Open Graph and Twitter tags for the home page', async () => {
    const html = await read('../index.html');
    const expected = {
      'og:title': /property="og:title"\s+content="[^"]+"/,
      'og:description': /property="og:description"\s+content="[^"]+"/,
      'og:type': /property="og:type"\s+content="website"/,
      'og:site_name': /property="og:site_name"\s+content="羊毛传说"/,
      'og:url': /property="og:url"\s+content="https:\/\/free\.vibe-show\.com\/"/,
      'og:image': /property="og:image"\s+content="https:\/\/free\.vibe-show\.com\/og-image\.png"/,
      'twitter:card': /name="twitter:card"\s+content="summary_large_image"/,
    };
    for (const pattern of Object.values(expected)) expect(html).toMatch(pattern);
  });

  it('ships a small 1200×630 PNG share image', async () => {
    const png = await readFile(new URL('../public/og-image.png', import.meta.url));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect((await stat(new URL('../public/og-image.png', import.meta.url))).size).toBeLessThan(
      300 * 1024,
    );
  });

  it('ships a favicon.ico and links it', async () => {
    const ico = await readFile(new URL('../public/favicon.ico', import.meta.url));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(await read('../index.html')).toContain('href="/favicon.ico"');
  });
});

describe('lobby typography', () => {
  it('uses the shared serif stack with Latin and CJK fallbacks', async () => {
    const files = ['../styles.css', '../styles/offers.css', '../styles/motion.css'];
    const css = (await Promise.all(files.map(read))).join('\n').replace(/\s+/g, ' ');
    expect(css).toContain(`--serif: ${SERIF_STACK};`);
    const stacks = [...css.matchAll(/font-family: ([^;]+);/g)].map((m) => m[1]);
    for (const stack of stacks.filter((s) => s.includes('Noto Serif'))) {
      expect(stack).toBe(SERIF_STACK);
    }
  });
});
