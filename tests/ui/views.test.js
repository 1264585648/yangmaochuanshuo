import { describe, it, expect } from 'vitest';
import {
  basicDialog,
  probabilityDialog,
  dailyDialog,
  resultDialog,
  detailDialog,
  favoriteLabel,
} from '../../src/ui/views.js';
import { chipsHTML, errorState, externalLink, skeletonRows } from '../../src/ui/offer-views.js';
import { packHTML, positionFor } from '../../src/ui/packs.js';
import { poolIconSVG } from '../../src/ui/icons.js';
import { RARITIES } from '../../src/domain/draw.js';
import { normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';

const NOW = new Date('2026-11-11T00:00:00Z');
const EVIL = '<img src=x onerror="alert(1)">';
const BREAKOUT = 'x" onmouseover="alert(1)';
const RAW_ATTR = '" onmouseover=';

const offer = (patch = {}) => normalizeOffer(apiOffer({ id: 'deal-1', ...patch }));
const hostile = {
  ...offer(),
  id: BREAKOUT,
  pool: BREAKOUT,
  rarity: BREAKOUT,
  title: EVIL,
  summary: EVIL,
  benefit: EVIL,
  provider: { id: 'p', name: EVIL },
  conditions: { ...offer().conditions, note: EVIL, regions: [] },
  officialUrl: 'javascript:alert(1)',
  sourceUrl: 'http://insecure.example.com',
  validUntil: EVIL,
  lastVerifiedAt: EVIL,
};

const assertSafe = (html) => {
  expect(html).not.toContain('<img');
  expect(html).not.toContain(RAW_ATTR);
  expect(html).not.toContain('javascript:');
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
  it('shows the base table and per-pool odds with card counts', () => {
    const html = probabilityDialog({
      base: RARITIES,
      pools: [
        {
          label: '云服务器',
          odds: [
            { id: 'A', chance: 0.7 / 0.95, count: 2 },
            { id: 'S', chance: 0.25 / 0.95, count: 1 },
          ],
        },
      ],
    });
    expect(html).toContain('<strong>70%</strong>');
    expect(html).toContain('<strong>5%</strong>');
    expect(html).toContain('73.7%<small>2 张</small>');
    expect(html).toContain('26.3%<small>1 张</small>');
    expect(html).toContain('<td class="muted">—</td>');
  });

  it('omits the pool table while the catalog is not loaded', () => {
    expect(probabilityDialog({ base: RARITIES, pools: null })).not.toContain('odds-table');
  });

  it('escapes rarity ids and pool labels', () => {
    assertSafe(
      probabilityDialog({
        base: [{ id: BREAKOUT, chance: 1 }],
        pools: [{ label: EVIL, odds: [] }],
      }),
    );
  });
});

describe('dailyDialog', () => {
  it('shows remaining and the configured quota', () => {
    const html = dailyDialog({ remaining: 2, max: 3 });
    expect(html).toContain('今天还可以打开 2 个卡包');
    expect(html).toContain('<strong>3 次</strong>');
    expect(html).toContain('北京时间 0 点');
    expect(dailyDialog({ remaining: null, max: 3 })).toContain('正在读取今天的剩余次数');
  });
});

describe('resultDialog', () => {
  const props = (patch) => ({
    offer: offer(),
    poolLabel: 'AI 福利',
    isFavorite: false,
    canDrawAgain: true,
    isNew: true,
    now: NOW,
    ...patch,
  });

  it('says when the card is a repeat', () => {
    expect(resultDialog(props())).toContain('发现一张新的福利卡');
    expect(resultDialog(props({ isNew: false }))).toContain('再次抽到这张福利卡');
  });

  it('shows the real offer fields and a safe official link', () => {
    const html = resultDialog(props());
    expect(html).toContain('Offer deal-1');
    expect(html).toContain('示例提供方');
    expect(html).toContain('benefit');
    expect(html).toContain('href="https://www.example.com/deal"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('来源：docs.example.com');
    expect(html).toContain('1 天前核验');
    expect(html).toContain('无特殊门槛');
  });

  it('escapes every data field and drops unsafe links', () => {
    const html = resultDialog(props({ offer: hostile, poolLabel: EVIL }));
    assertSafe(html);
    expect(html).not.toContain('前往官方页面');
    expect(html).not.toContain('insecure.example.com');
  });

  it('celebrates SSR and reflects favourite and quota state', () => {
    const html = resultDialog(
      props({ offer: offer({ rarity: 'SSR' }), isFavorite: true, canDrawAgain: false }),
    );
    expect(html).toContain('发现了一张珍稀福利卡！');
    expect(html).toContain('rarity-ssr');
    expect(html).toContain('已收藏 ✓');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('返回大厅');
  });

  it('uses the plain heading for non-SSR and offers another draw', () => {
    const html = resultDialog(props());
    expect(html).toContain('发现一张新的福利卡');
    expect(html).toContain('☆ 收藏到图鉴');
    expect(html).toContain('继续抽卡');
  });
});

describe('detailDialog', () => {
  it('renders a back button only when asked', () => {
    const base = { offer: offer(), poolLabel: 'AI', isFavorite: false, now: NOW };
    expect(detailDialog({ ...base, backLabel: '返回图鉴' })).toContain('‹ 返回图鉴');
    expect(detailDialog({ ...base, backLabel: null })).not.toContain('dialogBack');
  });

  it('escapes every data field', () => {
    assertSafe(
      detailDialog({
        offer: hostile,
        poolLabel: EVIL,
        isFavorite: false,
        backLabel: EVIL,
        now: NOW,
      }),
    );
  });
});

describe('favoriteLabel', () => {
  it('toggles text', () => {
    expect(favoriteLabel(true)).toBe('已收藏 ✓');
    expect(favoriteLabel(false)).toBe('☆ 收藏到图鉴');
  });
});

describe('offer-views helpers', () => {
  it('renders chips, skeletons and errors safely', () => {
    const chips = chipsHTML({ ...offer().conditions, autoRenews: true });
    expect(chips).toContain('cond-chip warn');
    expect(skeletonRows(3).match(/skeleton-row/g)).toHaveLength(3);
    assertSafe(errorState(EVIL, BREAKOUT));
  });

  it('refuses to link anything but https', () => {
    expect(externalLink('javascript:alert(1)', 'x', 'c')).toBe('');
    expect(externalLink('https://example.com/"a', 'x', 'c')).toContain('%22a');
  });
});

describe('packHTML', () => {
  it('escapes pool text and keeps the trusted icon svg', () => {
    const html = packHTML({ id: 'cloud', title: EVIL, label: EVIL }, 0);
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg viewBox="0 0 64 64"');
    expect(html).toContain('pack--cloud');
    expect(html).toContain('data-index="0"');
    expect(html).toContain('class="pack-count"');
  });

  it('escapes the pool id used in classes and data attributes', () => {
    expect(packHTML({ id: BREAKOUT, title: 't', label: 'l' }, 0)).not.toContain(RAW_ATTR);
  });

  it('marks the ai icon as filled and ignores unknown or inherited keys', () => {
    expect(packHTML({ id: 'ai', title: 't', label: 'l' }, 1)).toContain('fill-icon');
    expect(poolIconSVG('constructor')).not.toContain('function');
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
