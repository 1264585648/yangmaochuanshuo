import { parseListQuery } from '../domain/query';
import { slugSchema } from '../domain/schema';
import { fail, notFound, ok, PUBLIC_CACHE } from '../http/respond';
import { getPublicOffer, listPublicOffers } from '../repo/offers';

type DB = Env['DB'];

export async function listOffers(db: DB, url: URL, today: string): Promise<Response> {
  const parsed = parseListQuery(url.searchParams);
  if (!parsed.success) {
    return fail(400, 'invalid_query', 'Invalid query parameters', {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const { offers, total } = await listPublicOffers(db, parsed.data, today);
  return ok(offers, {
    cache: PUBLIC_CACHE,
    meta: { total, limit: parsed.data.limit, offset: parsed.data.offset },
  });
}

export async function getOffer(db: DB, id: string, today: string): Promise<Response> {
  // Malformed ids cannot exist, so answer like any other missing offer.
  if (!slugSchema.safeParse(id).success) return notFound();
  const offer = await getPublicOffer(db, id, today);
  return offer ? ok(offer, { cache: PUBLIC_CACHE }) : notFound();
}
