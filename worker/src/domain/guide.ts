import { z } from 'zod';
import { httpsUrl } from './urls-schema';

/**
 * How-to guides attached to offers. SSR offers carry a full guide (phases,
 * facts, FAQ, references); every other rarity carries a brief 3–5 step one.
 *
 * All text is plain and is escaped by the client before display. Two inline
 * marks are allowed by convention: `code` for UI labels and commands, and
 * **bold** for emphasis. No HTML, no inline links: links are structured so
 * they can be checked against the provider's official domains.
 */
export const GUIDE_LIMITS = {
  briefStepsMin: 3,
  briefStepsMax: 5,
  phases: 6,
  fullSteps: 30,
  bullets: 8,
  notes: 3,
  facts: 12,
  faq: 10,
  references: 10,
  short: 80,
  text: 400,
  code: 1000,
  bytes: 32 * 1024,
} as const;

// Matching control characters is the point of these patterns.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
// Code blocks may contain tab and newline (\u0009, \u000A).
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F]/;

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL.test(s), 'must not contain control characters');

const optionalPlain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !CONTROL.test(s), 'must not contain control characters')
    .default('');

/** Self-hosted screenshots only: third-party hosts are blocked by CSP and licensing. */
const GUIDE_IMAGE =
  /^\/guides\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:[-_][a-z0-9]+)*\.(?:png|jpe?g|webp)$/;

const figureSchema = z.strictObject({
  src: z.string().regex(GUIDE_IMAGE, 'must be a /guides/<offer>/<file>.png|jpg|webp path'),
  alt: plain(GUIDE_LIMITS.text),
  caption: optionalPlain(GUIDE_LIMITS.text),
});

const linkSchema = z.strictObject({
  label: plain(GUIDE_LIMITS.short),
  url: httpsUrl,
});

const noteSchema = z.strictObject({
  tone: z.enum(['warn', 'danger']),
  title: plain(GUIDE_LIMITS.short),
  text: plain(GUIDE_LIMITS.text),
});

const stepSchema = z.strictObject({
  text: plain(GUIDE_LIMITS.text),
  bullets: z.array(plain(GUIDE_LIMITS.text)).max(GUIDE_LIMITS.bullets).default([]),
  link: linkSchema.optional(),
  figure: figureSchema.optional(),
  notes: z.array(noteSchema).max(GUIDE_LIMITS.notes).default([]),
  code: z
    .string()
    .min(1)
    .max(GUIDE_LIMITS.code)
    .refine((s) => !CONTROL_EXCEPT_NEWLINE.test(s), 'must not contain control characters')
    .optional(),
});

const BASES = ['official', 'community'] as const;

const briefSchema = z.strictObject({
  kind: z.literal('brief'),
  steps: z.array(stepSchema).min(GUIDE_LIMITS.briefStepsMin).max(GUIDE_LIMITS.briefStepsMax),
});

const fullSchema = z.strictObject({
  kind: z.literal('full'),
  phases: z
    .array(
      z.strictObject({
        title: plain(GUIDE_LIMITS.short),
        note: optionalPlain(GUIDE_LIMITS.short),
        steps: z.array(stepSchema).min(1).max(GUIDE_LIMITS.fullSteps),
      }),
    )
    .min(1)
    .max(GUIDE_LIMITS.phases)
    .refine(
      (phases) => phases.reduce((n, p) => n + p.steps.length, 0) <= GUIDE_LIMITS.fullSteps,
      `a full guide has at most ${GUIDE_LIMITS.fullSteps} steps`,
    ),
  facts: z
    .array(
      z.strictObject({
        label: plain(GUIDE_LIMITS.short),
        value: plain(GUIDE_LIMITS.short),
        note: optionalPlain(GUIDE_LIMITS.text),
      }),
    )
    .max(GUIDE_LIMITS.facts)
    .default([]),
  faq: z
    .array(
      z.strictObject({
        question: plain(GUIDE_LIMITS.short),
        answer: plain(GUIDE_LIMITS.text),
        basis: z.enum(BASES),
      }),
    )
    .max(GUIDE_LIMITS.faq)
    .default([]),
  references: z
    .array(
      z.strictObject({
        title: plain(GUIDE_LIMITS.text),
        url: httpsUrl,
        basis: z.enum(BASES),
      }),
    )
    .max(GUIDE_LIMITS.references)
    .default([]),
});

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export const guideSchema = z
  .discriminatedUnion('kind', [briefSchema, fullSchema])
  .refine(
    (g) => byteLength(g) <= GUIDE_LIMITS.bytes,
    `guide must not exceed ${GUIDE_LIMITS.bytes} bytes as JSON`,
  );

export type Guide = z.infer<typeof guideSchema>;
export type GuideKind = Guide['kind'];

export interface GuideViolation {
  code: 'guide_required' | 'guide_mismatch';
  message: string;
}

/** Guide a rarity must carry once the offer is public. */
export const requiredGuideKind = (rarity: string): GuideKind =>
  rarity === 'SSR' ? 'full' : 'brief';

/**
 * Rule for public offers: every one has a guide, SSR ones a full guide and the
 * rest a brief one. Applied to merged content so separate rarity and guide
 * edits cannot bypass it.
 */
export function guideRuleViolation(rarity: string, guide: Guide | null): GuideViolation | null {
  if (!guide) {
    return { code: 'guide_required', message: 'Published offers need a guide' };
  }
  const kind = requiredGuideKind(rarity);
  if (guide.kind !== kind) {
    return {
      code: 'guide_mismatch',
      message: `${rarity} offers need a ${kind} guide, not a ${guide.kind} one`,
    };
  }
  return null;
}

type Step = z.infer<typeof stepSchema>;

const stepLinks = (steps: readonly Step[], prefix: string): [string, string][] =>
  steps.flatMap((s, i): [string, string][] =>
    s.link ? [[`${prefix}.${i}.link.url`, s.link.url]] : [],
  );

/**
 * URLs that claim to be the provider's own and so must sit on its official
 * domains: every step link and every reference marked official. Community
 * references are labelled as such on the page and are exempt.
 */
export function guideOfficialUrls(guide: Guide | null): Record<string, string> {
  if (!guide) return {};
  if (guide.kind === 'brief') return Object.fromEntries(stepLinks(guide.steps, 'guide.steps'));
  const links = guide.phases.flatMap((p, i) => stepLinks(p.steps, `guide.phases.${i}.steps`));
  const refs = guide.references.flatMap((r, i): [string, string][] =>
    r.basis === 'official' ? [[`guide.references.${i}.url`, r.url]] : [],
  );
  return Object.fromEntries([...links, ...refs]);
}

/** Read a stored guide column; anything unreadable counts as no guide. */
export function parseStoredGuide(raw: string | null): Guide | null {
  if (raw === null) return null;
  try {
    const parsed = guideSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
