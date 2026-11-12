import { z } from 'zod';
import { guideSchema } from './guide';
import { isSharedHost } from './shared-hosts';
import { httpsUrl } from './urls-schema';

export { httpsUrl };

export const POOLS = ['ai', 'cloud', 'software', 'education'] as const;
export const RARITIES = ['A', 'S', 'SSR'] as const;

const LIMITS = {
  idMin: 3,
  idMax: 64,
  title: 60,
  summary: 200,
  benefit: 120,
  note: 200,
  name: 80,
  domains: 10,
  regions: 50,
} as const;

export const slugSchema = z
  .string()
  .min(LIMITS.idMin)
  .max(LIMITS.idMax)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens');

const text = (max: number) => z.string().trim().min(1).max(max);

const isoDate = z.iso.date();

const conditionsSchema = z.strictObject({
  newUsersOnly: z.boolean().default(false),
  studentOnly: z.boolean().default(false),
  requiresPaymentMethod: z.boolean().default(false),
  autoRenews: z.boolean().default(false),
  regions: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code'))
    .max(LIMITS.regions)
    .default([]),
  note: z.string().trim().max(LIMITS.note).default(''),
});

/** Content fields a caller may set. Status, verification and audit fields are server-owned. */
const contentShape = {
  pool: z.enum(POOLS),
  rarity: z.enum(RARITIES),
  title: text(LIMITS.title),
  summary: text(LIMITS.summary),
  benefit: text(LIMITS.benefit),
  officialUrl: httpsUrl,
  sourceUrl: httpsUrl,
  conditions: conditionsSchema,
  validFrom: isoDate.nullable().default(null),
  validUntil: isoDate.nullable().default(null),
  guide: guideSchema.nullable().default(null),
};

const validWindow = (v: { validFrom?: string | null; validUntil?: string | null }) =>
  !v.validFrom || !v.validUntil || v.validFrom <= v.validUntil;

const windowError = { message: 'validUntil must not be before validFrom', path: ['validUntil'] };

export const offerCreateSchema = z
  .strictObject({ id: slugSchema, providerId: slugSchema, ...contentShape })
  .refine(validWindow, windowError);

export const offerPatchSchema = z
  .strictObject({
    pool: contentShape.pool.optional(),
    rarity: contentShape.rarity.optional(),
    title: contentShape.title.optional(),
    summary: contentShape.summary.optional(),
    benefit: contentShape.benefit.optional(),
    officialUrl: httpsUrl.optional(),
    sourceUrl: httpsUrl.optional(),
    conditions: conditionsSchema.optional(),
    validFrom: isoDate.nullable().optional(),
    validUntil: isoDate.nullable().optional(),
    guide: guideSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'patch must change at least one field')
  .refine(validWindow, windowError);

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, 'bare registrable domain')
  .refine(
    (d) => !isSharedHost(d),
    'shared hosting or public suffix; register the exact host instead',
  );

export const providerSchema = z.strictObject({
  id: slugSchema,
  name: text(LIMITS.name),
  officialDomains: z.array(domain).min(1).max(LIMITS.domains),
});

export type OfferCreate = z.infer<typeof offerCreateSchema>;
export type OfferPatch = z.infer<typeof offerPatchSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type Conditions = z.infer<typeof conditionsSchema>;
