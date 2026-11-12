import { describe, it, expect } from 'vitest';
import {
  GUIDE_LIMITS,
  guideOfficialUrls,
  guideRuleViolation,
  guideSchema,
  parseStoredGuide,
} from '../../worker/src/domain/guide';
import { briefGuide, fullGuide, oracleGuide } from './guide-fixtures';

type Json = Record<string, unknown>;
const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `第 ${i + 1} 步` }));

describe('guideSchema', () => {
  it('holds the approved Oracle sample page without loss', () => {
    const parsed = guideSchema.parse(oracleGuide());
    expect(parsed.kind).toBe('full');
    if (parsed.kind !== 'full') return;
    expect(parsed.phases).toHaveLength(3);
    expect(parsed.phases.flatMap((p) => p.steps)).toHaveLength(12);
    expect(parsed.facts).toHaveLength(7);
    expect(parsed.faq.map((f) => f.basis)).toEqual([
      'official',
      'official',
      'official',
      'community',
    ]);
    expect(parsed.references).toHaveLength(5);
  });

  it('keeps the Oracle guide well under the size cap', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(oracleGuide())).length;
    expect(bytes).toBeLessThan(GUIDE_LIMITS.bytes / 2);
  });

  it('fills defaults for optional parts', () => {
    const parsed = guideSchema.parse(fullGuide());
    expect(parsed).toMatchObject({ facts: [], faq: [], references: [] });
    const brief = guideSchema.parse(briefGuide());
    expect(brief.kind === 'brief' && brief.steps[0]).toEqual({
      text: '打开官方活动页并登录账户',
      bullets: [],
      notes: [],
    });
  });

  it('round-trips to identical JSON, so unchanged guides compare equal', () => {
    const once = JSON.stringify(guideSchema.parse(oracleGuide()));
    const twice = JSON.stringify(guideSchema.parse(JSON.parse(once)));
    expect(twice).toBe(once);
  });

  it.each([2, 6])('rejects a brief guide with %i steps', (n) => {
    expect(guideSchema.safeParse({ kind: 'brief', steps: steps(n) }).success).toBe(false);
  });

  it.each([3, 5])('accepts a brief guide with %i steps', (n) => {
    expect(guideSchema.safeParse({ kind: 'brief', steps: steps(n) }).success).toBe(true);
  });

  it('caps the total number of steps in a full guide', () => {
    const phase = (n: number) => ({ title: '阶段', steps: steps(n) });
    const ok = { kind: 'full', phases: [phase(15), phase(15)] };
    const tooMany = { kind: 'full', phases: [phase(15), phase(16)] };
    expect(guideSchema.safeParse(ok).success).toBe(true);
    expect(guideSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects unknown kinds and unknown fields', () => {
    expect(guideSchema.safeParse({ kind: 'video', steps: steps(3) }).success).toBe(false);
    expect(guideSchema.safeParse({ ...briefGuide(), html: '<b>x</b>' }).success).toBe(false);
    const g = briefGuide() as { steps: Json[] };
    g.steps[0] = { text: 'x', onclick: 'y' };
    expect(guideSchema.safeParse(g).success).toBe(false);
  });

  it.each([
    'https://dev-to-uploads.s3.amazonaws.com/x.png',
    '//evil.example/x.png',
    '/guides/../secret.png',
    '/guides/a/b.svg',
    '/assets/a/b.png',
    'guides/a/b.png',
  ])('only allows self-hosted guide images, not %s', (src) => {
    const g = briefGuide() as { steps: Json[] };
    g.steps[0] = { text: 'x', figure: { src, alt: 'a', caption: 'c' } };
    expect(guideSchema.safeParse(g).success).toBe(false);
  });

  it('requires alt text on figures', () => {
    const g = briefGuide() as { steps: Json[] };
    g.steps[0] = { text: 'x', figure: { src: '/guides/a/b.png', alt: ' ', caption: '' } };
    expect(guideSchema.safeParse(g).success).toBe(false);
  });

  it.each(['http://www.example.com/', 'javascript:alert(1)', 'https://u:p@example.com/'])(
    'rejects unsafe link %s',
    (url) => {
      const g = briefGuide() as { steps: Json[] };
      g.steps[0] = { text: 'x', link: { label: 'l', url } };
      expect(guideSchema.safeParse(g).success).toBe(false);
    },
  );

  it('rejects control characters in text but keeps newlines in code', () => {
    const g = briefGuide() as { steps: Json[] };
    g.steps[0] = { text: 'a\u0000b' };
    expect(guideSchema.safeParse(g).success).toBe(false);
    g.steps[0] = { text: 'a', code: 'line 1\nline 2' };
    expect(guideSchema.safeParse(g).success).toBe(true);
  });

  it('rejects guides over the serialized size cap', () => {
    const long = 'x'.repeat(GUIDE_LIMITS.code);
    const step = {
      text: '步骤',
      code: long,
      bullets: Array(GUIDE_LIMITS.bullets).fill('y'.repeat(GUIDE_LIMITS.text)),
    };
    const phase = { title: '阶段', steps: Array(GUIDE_LIMITS.fullSteps / 2).fill(step) };
    const g = { kind: 'full', phases: [phase, phase] };
    const result = guideSchema.safeParse(g);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => /bytes/.test(i.message))).toBe(true);
  });
});

describe('guideRuleViolation', () => {
  const brief = guideSchema.parse(briefGuide());
  const full = guideSchema.parse(fullGuide());

  it('requires a guide', () => {
    expect(guideRuleViolation('A', null)?.code).toBe('guide_required');
    expect(guideRuleViolation('SSR', null)?.code).toBe('guide_required');
  });

  it('pairs SSR with a full guide and everything else with a brief one', () => {
    expect(guideRuleViolation('SSR', full)).toBeNull();
    expect(guideRuleViolation('S', brief)).toBeNull();
    expect(guideRuleViolation('A', brief)).toBeNull();
    expect(guideRuleViolation('SSR', brief)?.code).toBe('guide_mismatch');
    expect(guideRuleViolation('S', full)?.code).toBe('guide_mismatch');
  });
});

describe('guideOfficialUrls', () => {
  it('collects step links and official references, not community ones', () => {
    const urls = guideOfficialUrls(guideSchema.parse(oracleGuide()));
    expect(Object.keys(urls)).toEqual([
      'guide.phases.0.steps.0.link.url',
      'guide.references.0.url',
      'guide.references.1.url',
      'guide.references.2.url',
    ]);
    expect(Object.values(urls).some((u) => u.includes('dev.to'))).toBe(false);
  });

  it('handles brief guides and null', () => {
    const g = briefGuide() as { steps: Json[] };
    g.steps[1] = { text: 'x', link: { label: 'l', url: 'https://www.example.com/a' } };
    expect(guideOfficialUrls(guideSchema.parse(g))).toEqual({
      'guide.steps.1.link.url': 'https://www.example.com/a',
    });
    expect(guideOfficialUrls(null)).toEqual({});
  });
});

describe('parseStoredGuide', () => {
  it('parses stored JSON and treats null, junk and invalid shapes as no guide', () => {
    expect(parseStoredGuide(JSON.stringify(briefGuide()))?.kind).toBe('brief');
    expect(parseStoredGuide(null)).toBeNull();
    expect(parseStoredGuide('{not json')).toBeNull();
    expect(parseStoredGuide('{"kind":"brief","steps":[]}')).toBeNull();
  });
});
