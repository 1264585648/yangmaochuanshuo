/* `/api/me/collection`, `/api/me/draws`, `/api/me/favorites/:id`, `/api/me/import`. */
import { z } from 'zod';
import { utcDay } from '../domain/visibility';
import { readJsonBody } from '../http/body';
import { fail, methodNotAllowed, notFound, ok } from '../http/respond';
import { addFavorite, readCollection, readHistory, removeFavorite } from '../users/collection';
import { ensureUser, ipActor, limitUserWrites, type UserContext } from '../users/context';
import { applyImport, firstSeen, liveOfferIds } from '../users/import';
import { invalid } from './manage/shared';

const READ_METHODS = ['GET', 'HEAD'] as const;
const isRead = (request: Request) => (READ_METHODS as readonly string[]).includes(request.method);

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;
const DRAW_ID = /^d_[A-Za-z0-9_-]{22}$/;
const OFFER_ID_MAX = 100;
/** Matches the legacy browser history cap (`COLLECTION_LIMIT`). */
const IMPORT_MAX_ENTRIES = 100;
const IMPORT_MAX_BODY_BYTES = 32 * 1024;

const offerId = z.string().min(1).max(OFFER_ID_MAX);
const importBody = z.strictObject({
  collection: z
    .array(z.strictObject({ id: offerId, ts: z.number().finite() }))
    .max(IMPORT_MAX_ENTRIES),
  favorites: z.array(offerId).max(IMPORT_MAX_ENTRIES),
});

export async function getCollection(request: Request, ctx: UserContext): Promise<Response> {
  if (!isRead(request)) return methodNotAllowed(READ_METHODS);
  const userId = ctx.session?.user.id ?? null;
  return ok(await readCollection(ctx.db, userId, utcDay(ctx.now)));
}

function parseHistoryQuery(url: URL): { before: string | null; limit: number } | null {
  for (const key of url.searchParams.keys()) if (key !== 'before' && key !== 'limit') return null;
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? HISTORY_DEFAULT_LIMIT : Number(rawLimit);
  if (!/^\d+$/.test(rawLimit ?? '20') || limit < 1 || limit > HISTORY_MAX_LIMIT) return null;
  const before = url.searchParams.get('before');
  if (before !== null && !DRAW_ID.test(before)) return null;
  return { before, limit };
}

export async function getHistory(request: Request, url: URL, ctx: UserContext): Promise<Response> {
  if (!isRead(request)) return methodNotAllowed(READ_METHODS);
  const query = parseHistoryQuery(url);
  if (!query) return fail(400, 'invalid_query', 'Invalid query parameters');
  if (!ctx.session) return ok({ items: [], nextCursor: null });
  return ok(await readHistory(ctx.db, ctx.session.user.id, utcDay(ctx.now), query));
}

const FAVORITE_METHODS = ['PUT', 'DELETE'] as const;

export async function setFavorite(
  request: Request,
  rawId: string,
  ctx: UserContext,
): Promise<Response> {
  if (!(FAVORITE_METHODS as readonly string[]).includes(request.method)) {
    return methodNotAllowed(FAVORITE_METHODS);
  }
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return notFound();
  }
  if (!ctx.session || !offerId.safeParse(id).success) return notFound();
  const userId = ctx.session.user.id;
  const limited = await limitUserWrites(ctx, userId);
  if (limited) return limited;
  if (request.method === 'DELETE') {
    await removeFavorite(ctx.db, userId, id);
    return ok({ offerId: id, favorite: false });
  }
  if (!(await addFavorite(ctx.db, userId, id, ctx.now))) return notFound();
  return ok({ offerId: id, favorite: true });
}

export async function postImport(request: Request, ctx: UserContext): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const body = await readJsonBody(request, IMPORT_MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = importBody.safeParse(body.value);
  if (!parsed.success) return invalid(parsed.error);

  const seen = firstSeen(parsed.data.collection, ctx.now);
  const live = await liveOfferIds(ctx.db, [...seen.keys()], utcDay(ctx.now));
  const cards = new Map([...seen].filter(([id]) => live.has(id)));
  const favorites = [...new Set(parsed.data.favorites)];
  // Nothing to keep: answer without creating a user or using up the one-time import.
  if (cards.size === 0 && (!ctx.session || favorites.length === 0)) {
    return ok({ imported: 0, favorites: 0 });
  }

  const actor = await ipActor(ctx, request);
  if (actor instanceof Response) return actor;
  const owner = await ensureUser(ctx, actor);
  if (owner instanceof Response) return owner;

  const limited = await limitUserWrites(ctx, owner.user.id);
  if (limited) return limited;
  const result = await applyImport(ctx.db, owner.user.id, { cards, favorites }, ctx.now);
  if (!result) return fail(409, 'already_imported', 'Browser data was already imported');
  const response = ok(result);
  if (owner.cookie) response.headers.append('set-cookie', owner.cookie);
  return response;
}
