import { describe, it, expect } from 'vitest';
import {
  basicDialog,
  probabilityDialog,
  dailyDialog,
  resultDialog,
  favoriteLabel,
  collectionDialog,
  offerRows,
} from '../../src/ui/views.js';
import { packHTML, positionFor } from '../../src/ui/packs.js';
import { RARITIES } from '../../src/domain/draw.js';

const EVIL = '<img src=x onerror="alert(1)">';
const hostile = {
  id: 'evil',
  pool: 'ai',
  rarity: 'SSR',
  title: EVIL,
  description: EVIL,
  icon: EVIL,
  requirement: EVIL,
};

describe('basicDialog', () => {
  it('escapes kicker, title and lead but keeps trusted body markup', () => {
    const html = basicDialog({ kicker: EVIL, title: EVIL, lead: EVIL, body: '<p>ok</p>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('<p>ok</p>');
    expect(html).toContain('id="dialogTitle"');
  });
});

describe('probabilityDialog', () => {
  it('shows each published rate as a whole percentage', () => {
    const html = probabilityDialog(RARITIES);
    expect(html).toContain('<strong>70%</strong>');
    expect(html).toContain('<strong>25%</strong>');
    expect(html).toContain('<strong>5%</strong>');
    expect(html).toContain('rarity-chip ssr');
  });
});

describe('dailyDialog', () => {
  it('shows remaining and the configured quota', () => {
    const html = dailyDialog({ remaining: 2, max: 3 });
    expect(html).toContain('今天还可以打开 2 个卡包');
    expect(html).toContain('<strong>3 次</strong>');
  });
});

describe('resultDialog', () => {
  it('escapes every data field', () => {
    const html = resultDialog({
      offer: hostile,
      poolLabel: EVIL,
      isFavorite: false,
      canDrawAgain: true,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('celebrates SSR and reflects favourite and quota state', () => {
    const offer = { ...hostile, title: 't', description: 'd', icon: 'i' };
    const html = resultDialog({
      offer,
      poolLabel: 'AI 福利',
      isFavorite: true,
      canDrawAgain: false,
    });
    expect(html).toContain('发现了一张珍稀福利卡！');
    expect(html).toContain('rarity-ssr');
    expect(html).toContain('已收藏 ✓');
    expect(html).toContain('返回大厅');
  });

  it('uses the plain heading for non-SSR and offers another draw', () => {
    const offer = { ...hostile, rarity: 'A', title: 't' };
    const html = resultDialog({ offer, poolLabel: 'x', isFavorite: false, canDrawAgain: true });
    expect(html).toContain('发现一张新的福利卡');
    expect(html).toContain('☆ 收藏到图鉴');
    expect(html).toContain('继续抽卡');
  });
});

describe('favoriteLabel', () => {
  it('toggles text', () => {
    expect(favoriteLabel(true)).toBe('已收藏 ✓');
    expect(favoriteLabel(false)).toBe('☆ 收藏到图鉴');
  });
});

describe('collectionDialog', () => {
  it('shows the empty state', () => {
    const html = collectionDialog({ seen: [], total: 12, favorites: [] });
    expect(html).toContain('图鉴里还没有卡牌');
    expect(html).toContain('已发现 0 / 12 张演示卡牌 · 收藏 0 张');
  });

  it('lists escaped cards with favourite markers', () => {
    const html = collectionDialog({ seen: [hostile], total: 12, favorites: ['evil'] });
    expect(html).not.toContain('<img');
    expect(html).toContain('★ 已收藏');
    expect(html).toContain('已发现 1 / 12');
  });
});

describe('offerRows', () => {
  it('escapes rows and shows an empty state', () => {
    expect(offerRows([hostile])).not.toContain('<img');
    expect(offerRows([])).toContain('没有找到匹配的演示卡牌');
  });
});

describe('attribute-context escaping', () => {
  const BREAKOUT = 'x" onmouseover="alert(1)';
  const RAW_ATTR = '" onmouseover=';
  const attrOffer = { ...hostile, rarity: BREAKOUT, pool: BREAKOUT };

  it('escapes rarity used in class attributes', () => {
    const result = resultDialog({
      offer: attrOffer,
      poolLabel: 'p',
      isFavorite: false,
      canDrawAgain: true,
    });
    expect(result).not.toContain(RAW_ATTR);
    expect(offerRows([attrOffer])).not.toContain(RAW_ATTR);
    expect(collectionDialog({ seen: [attrOffer], total: 1, favorites: [] })).not.toContain(
      RAW_ATTR,
    );
    expect(probabilityDialog([{ id: BREAKOUT, chance: 1 }])).not.toContain(RAW_ATTR);
  });

  it('escapes the pool id used in the pack class', () => {
    expect(packHTML({ id: BREAKOUT, title: 't', label: 'l' }, 0)).not.toContain(RAW_ATTR);
  });
});

describe('packHTML', () => {
  it('escapes pool text and keeps the trusted icon svg', () => {
    const html = packHTML({ id: 'cloud', title: EVIL, label: EVIL }, 0);
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg viewBox="0 0 64 64"');
    expect(html).toContain('pack--cloud');
    expect(html).toContain('data-index="0"');
  });

  it('marks the ai icon as filled', () => {
    expect(packHTML({ id: 'ai', title: 't', label: 'l' }, 1)).toContain('class="fill-icon"');
  });
});

describe('positionFor', () => {
  it('places the active pack in front and wraps around', () => {
    expect(positionFor(1, 1, 4)).toBe(0);
    expect(positionFor(2, 1, 4)).toBe(1);
    expect(positionFor(3, 1, 4)).toBe(2);
    expect(positionFor(0, 1, 4)).toBe(-1);
    expect(positionFor(0, 3, 4)).toBe(1);
  });
});
