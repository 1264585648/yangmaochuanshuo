import { z } from 'zod';
import { POOLS, RARITIES, slugSchema } from './schema';

export const PAGE = { defaultLimit: 50, maxLimit: 100, maxQuery: 100 } as const;

const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

const intInRange = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const listQuerySchema = z.strictObject({
  pool: z.enum(POOLS).optional(),
  rarity: z.enum(RARITIES).optional(),
  provider: slugSchema.optional(),
  newUsersOnly: flag.optional(),
  studentOnly: flag.optional(),
  requiresPaymentMethod: flag.optional(),
  autoRenews: flag.optional(),
  q: z.string().trim().min(1).max(PAGE.maxQuery).optional(),
  limit: intInRange(1, PAGE.maxLimit).default(PAGE.defaultLimit),
  offset: intInRange(0, Number.MAX_SAFE_INTEGER).default(0),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Parse URL search params; repeated keys keep the last value. */
export function parseListQuery(params: URLSearchParams) {
  return listQuerySchema.safeParse(Object.fromEntries(params));
}
