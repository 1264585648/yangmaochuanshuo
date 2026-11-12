import { describe, it, expect } from 'vitest';
import { guideSection, inlineMarks } from '../../src/ui/guide-view.js';
import { catalogDetail } from '../../src/ui/catalog-cards.js';
import { detailDialog, guideLink, resultDialog } from '../../src/ui/views.js';
import { normalizeGuide, normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';
import { briefGuide, fullGuide } from '../fixtures/guides.js';

const EVIL = '<img src=x onerror="alert(1)">';
const NOW = new Date('2026-11-11T00:00:00Z');
const guide = (raw) => normalizeGuide(raw);
const offer = (patch = {}) =>
  /** @type {import('../../src/domain/offer.js').Offer} */ (
    normalizeOffer(apiOffer({ id: 'deal-1', ...patch }))
  );

/** No raw markup or attribute breakout from data reaches the output. */
function assertSafe(html) {
  expect(html).not.toContain('<img');
  expect(html).not.toContain('" onerror=');
  expect(html).not.toContain('javascript:');
}

describe('inlineMarks', () => {
  it('turns `code` and **bold** into tags after escaping', () => {
    expect(inlineMarks('点 `设置` 再选 **免费**')).toBe(
      '点 <code>设置</code> 再选 <strong>免费</strong>',
    );
  });

  it('never lets marks wrap raw markup', () => {
    const html = inlineMarks(`**${EVIL}** \`${EVIL}\``);
    assertSafe(html);
    expect(html).toContain('<strong>&lt;img');
    expect(html).toContain('<code>&lt;img');
  });
});

describe('guideSection', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('renders nothing for a %s guide', (_name, value) => {
    expect(guideSection(value)).toBe('');
  });

  it('renders a brief guide as one ordered list of steps', () => {
    const html = guideSection(guide(briefGuide()));
    expect(html).toContain('<section class="guide is-brief" id="guide"');
    expect(html).toContain('领取攻略');
    expect(html.match(/<ol class="guide-steps">/g)).toHaveLength(1);
    expect(html.match(/<li class="guide-step">/g)).toHaveLength(3);
    expect(html).toContain('<code>控制台</code>');
    expect(html).toContain('<li>选择地区</li>');
    expect(html).toContain('href="https://www.example.com/quota"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('guide-note is-warn');
    expect(html).toContain('需要绑卡');
    expect(html).not.toContain('关键数据');
    expect(html).not.toContain('常见问题');
  });

  it('renders a full guide with phases, continuous numbering, facts, FAQ and references', () => {
    const html = guideSection(guide(fullGuide()));
    expect(html).toContain('guide is-full');
    expect(html).toContain('阶段 1</span>注册账号');
    expect(html).toContain('阶段 2</span>创建实例');
    expect(html).toContain('约 10 分钟');
    // Second phase continues after the first phase's two steps.
    expect(html).toContain('<ol class="guide-steps" start="3">');
    expect(html).toContain(
      '<pre class="guide-code"><code>ssh ubuntu@host\nsudo apt update</code></pre>',
    );
    expect(html).toContain('guide-note is-danger');
    expect(html).toContain('风险');
    expect(html).toContain('关键数据');
    expect(html).toContain('<dt>免费额度</dt><dd>4 核 24 GB<small>按月计</small></dd>');
    expect(html).toContain('常见问题');
    expect(html).toContain('<details><summary>需要信用卡吗？</summary>');
    expect(html).toContain('参考来源');
    expect(html).toContain('href="https://blog.example.org/howto"');
  });

  it('labels the basis of every FAQ answer and reference', () => {
    const html = guideSection(guide(fullGuide()));
    expect(html.match(/guide-basis is-official">官方说明/g)).toHaveLength(2);
    expect(html.match(/guide-basis is-community">社区经验/g)).toHaveLength(2);
  });

  it('omits empty facts, FAQ and references', () => {
    const html = guideSection(guide({ ...fullGuide(), facts: [], faq: [], references: [] }));
    expect(html).not.toContain('关键数据');
    expect(html).not.toContain('常见问题');
    expect(html).not.toContain('参考来源');
  });

  it('escapes every text field and only links to https', () => {
    const raw = fullGuide();
    const hostile = {
      ...raw,
      phases: [
        {
          title: EVIL,
          note: EVIL,
          steps: [
            {
              text: EVIL,
              bullets: [EVIL],
              link: { label: EVIL, url: 'javascript:alert(1)' },
              code: `</code>${EVIL}`,
              notes: [{ tone: 'warn', title: EVIL, text: EVIL }],
            },
            { text: 'http', link: { label: '明文链接', url: 'http://insecure.example.com' } },
          ],
        },
      ],
      facts: [{ label: EVIL, value: EVIL, note: EVIL }],
      faq: [{ question: EVIL, answer: EVIL, basis: 'official' }],
      references: [{ title: EVIL, url: 'javascript:alert(1)', basis: 'official' }],
    };
    const html = guideSection(guide(hostile));
    assertSafe(html);
    expect(html).not.toContain('http://insecure.example.com');
    expect(html).not.toContain('明文链接');
    expect(html).toContain('&lt;/code&gt;');
    // A reference with an unsafe URL keeps its (escaped) title, without a link.
    expect(html).toMatch(/官方说明<\/span>&lt;img/);
  });
});

describe('catalogDetail with a guide', () => {
  it('shows the guide below the conditions and above the official button', () => {
    const html = catalogDetail(offer({ guide: fullGuide() }));
    const conditions = html.indexOf('领取条件');
    const guideAt = html.indexOf('领取攻略');
    const official = html.indexOf('前往官方页面');
    expect(conditions).toBeGreaterThan(-1);
    expect(guideAt).toBeGreaterThan(conditions);
    expect(official).toBeGreaterThan(guideAt);
  });

  it('renders no guide section when the offer has none', () => {
    expect(catalogDetail(offer())).not.toContain('领取攻略');
    expect(catalogDetail(offer({ guide: null }))).not.toContain('领取攻略');
  });
});

describe('dialog guide link', () => {
  const LINK = '<a class="offer-page-link" href="/offers/deal-1#guide">查看领取攻略 ›</a>';

  it('links to the guide on the offer page instead of inlining it', () => {
    const props = { offer: offer({ guide: briefGuide() }), poolLabel: 'AI', isFavorite: false };
    const result = resultDialog({ ...props, canDrawAgain: true, now: NOW });
    const detail = detailDialog({ ...props, backLabel: null, now: NOW });
    for (const html of [result, detail]) {
      expect(html).toContain(LINK);
      expect(html).not.toContain('guide-steps');
    }
  });

  it('shows the link for list offers, whose guide is not loaded yet', () => {
    expect(guideLink(offer())).toContain(LINK);
  });

  it('hides the link when the offer is known to have no guide', () => {
    expect(guideLink(offer({ guide: null }))).toBe('');
  });

  it('escapes the offer id in the link', () => {
    const html = guideLink({ ...offer(), id: 'a"b<c' });
    expect(html).toContain('href="/offers/a%22b%3Cc#guide"');
  });
});
