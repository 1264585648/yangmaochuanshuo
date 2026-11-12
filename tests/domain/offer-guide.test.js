import { describe, it, expect } from 'vitest';
import { normalizeGuide, normalizeOffer } from '../../src/domain/offer.js';
import { apiOffer } from '../fixtures/offers.js';
import { briefGuide, fullGuide } from '../fixtures/guides.js';

describe('normalizeOffer guide', () => {
  it('leaves the key out when the response has no guide (list endpoint)', () => {
    const offer = normalizeOffer(apiOffer({ id: 'x' }));
    expect(offer).not.toHaveProperty('guide');
  });

  it('keeps a valid guide and deep-freezes it', () => {
    const offer = normalizeOffer(apiOffer({ id: 'x', guide: fullGuide() }));
    expect(offer?.guide?.kind).toBe('full');
    expect(Object.isFrozen(offer?.guide)).toBe(true);
    const guide = /** @type {any} */ (offer?.guide);
    expect(Object.isFrozen(guide.phases[0].steps[0])).toBe(true);
    expect(Object.isFrozen(guide.faq)).toBe(true);
  });

  it('keeps the offer but sets guide to null when the guide is unusable', () => {
    const offer = normalizeOffer(apiOffer({ id: 'x', guide: { kind: 'nope' } }));
    expect(offer).not.toBeNull();
    expect(offer?.guide).toBeNull();
    expect(normalizeOffer(apiOffer({ id: 'y', guide: null }))?.guide).toBeNull();
  });
});

describe('normalizeGuide', () => {
  it.each([
    ['non-object', 'guide'],
    ['array', []],
    ['unknown kind', { kind: 'long', steps: briefGuide().steps }],
    ['brief without steps', { kind: 'brief', steps: [] }],
    ['brief with only bad steps', { kind: 'brief', steps: [null, { text: '  ' }, { text: 1 }] }],
    ['full without phases', { ...fullGuide(), phases: 'x' }],
    ['full with only empty phases', { ...fullGuide(), phases: [{ title: 'a', steps: [] }] }],
  ])('returns null for %s', (_name, raw) => {
    expect(normalizeGuide(raw)).toBeNull();
  });

  it('normalises a brief guide, trimming text and defaulting missing parts', () => {
    const guide = normalizeGuide({ kind: 'brief', steps: [{ text: '  第一步  ' }] });
    expect(guide).toEqual({
      kind: 'brief',
      steps: [{ text: '第一步', bullets: [], link: null, notes: [], code: '' }],
    });
  });

  it('drops malformed parts instead of the whole guide', () => {
    const raw = fullGuide();
    const guide = /** @type {any} */ (
      normalizeGuide({
        ...raw,
        phases: [
          { title: '', steps: [{ text: 'orphan' }] },
          {
            title: '有效阶段',
            note: 42,
            steps: [
              {
                text: '步骤',
                bullets: ['ok', '', 3],
                link: { label: '', url: 'https://x.example.com' },
                notes: [{ tone: 'loud', title: 't', text: 'x' }, { title: 'no text' }, null],
                code: '   ',
              },
              'bad step',
            ],
          },
        ],
        facts: [{ label: 'a', value: '' }, null, { label: 'b', value: 'c' }],
        faq: [
          { question: 'q', answer: '' },
          { question: 'q2', answer: 'a2', basis: 'OFFICIAL' },
        ],
        references: [{ title: 't', url: '' }, 'x', { title: 'r', url: 'https://r.example.com' }],
      })
    );
    expect(guide.phases).toHaveLength(1);
    expect(guide.phases[0]).toMatchObject({ title: '有效阶段', note: '' });
    const step = guide.phases[0].steps[0];
    expect(step).toEqual({
      text: '步骤',
      bullets: ['ok'],
      link: null,
      notes: [{ tone: 'warn', title: 't', text: 'x' }],
      code: '',
    });
    expect(guide.facts).toEqual([{ label: 'b', value: 'c', note: '' }]);
    // Anything not exactly "official" is shown as community knowledge.
    expect(guide.faq).toEqual([{ question: 'q2', answer: 'a2', basis: 'community' }]);
    expect(guide.references).toEqual([
      { title: 'r', url: 'https://r.example.com', basis: 'community' },
    ]);
  });

  it('keeps multi-line code verbatim and danger notes', () => {
    const guide = /** @type {any} */ (normalizeGuide(fullGuide()));
    const step = guide.phases[1].steps[0];
    expect(step.code).toBe('ssh ubuntu@host\nsudo apt update');
    expect(step.notes[0].tone).toBe('danger');
  });

  it('treats non-array lists and oversized text as empty', () => {
    const guide = /** @type {any} */ (
      normalizeGuide({
        kind: 'full',
        phases: [{ title: 'p', steps: [{ text: 'a'.repeat(2001) }, { text: 's', code: 7 }] }],
        facts: null,
      })
    );
    expect(guide.phases[0].steps).toHaveLength(1);
    expect(guide.phases[0].steps[0].code).toBe('');
    expect(guide.facts).toEqual([]);
    expect(guide.faq).toEqual([]);
    expect(guide.references).toEqual([]);
  });
});
