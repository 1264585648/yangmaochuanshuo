#!/usr/bin/env node
/**
 * Import the candidate catalog in data/candidates/ through the manage API.
 *
 *   node scripts/import-candidates.mjs --dry-run            validate only, no network
 *   node scripts/import-candidates.mjs [--pool ai] [--skip-providers]
 *
 * Environment (never hardcoded, never printed):
 *   DEALDEX_API_BASE         e.g. http://127.0.0.1:8787 or https://<your-site>
 *   DEALDEX_ADMIN_TOKEN      admin token; required to create providers
 *   DEALDEX_INSPECTOR_TOKEN  inspector token; offers created with it land in
 *                            pending_review directly
 *
 * Without an inspector token, offers are created with the admin token (as
 * drafts) and immediately submitted, so they also end in pending_review.
 * Nothing is ever published: a human reviews and publishes each card.
 *
 * Every record is validated with the Worker's own validators (loaded through
 * Vite, since they are TypeScript) before any request is sent.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'data/candidates');
/** Stay under the API's 60 writes per minute per token. */
const WRITE_INTERVAL_MS = 1100;
const MAX_RETRIES = 3;
const BODY_LIMIT = 16 * 1024;
const POOLS = ['ai', 'cloud', 'software', 'education'];

// ── data ──────────────────────────────────────────────────────────────

export function loadCandidates(dir = DATA_DIR) {
  const read = (name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  return { providers: read('providers.json').providers, offers: read('offers.json').offers };
}

/**
 * Path of the first value the caller supplied that parsing changed (URL
 * normalisation, trimming), or null. Defaults the schema adds are fine.
 */
export function changedPath(input, parsed, path = '') {
  if (input === null || typeof input !== 'object') {
    return Object.is(input, parsed) ? null : path;
  }
  if (parsed === null || typeof parsed !== 'object') return path;
  if (Array.isArray(input) && (!Array.isArray(parsed) || input.length !== parsed.length)) {
    return path;
  }
  for (const key of Object.keys(input)) {
    const found = changedPath(input[key], parsed[key], path ? `${path}.${key}` : key);
    if (found !== null) return found;
  }
  return null;
}

const stableJson = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

export const contentHash = (value) =>
  createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);

/**
 * Deterministic key: re-running the same import replays instead of
 * duplicating, and an edited record gets a new key instead of a 422.
 */
export const idempotencyKey = (kind, id, body) => `cand.${kind}.${id}.${contentHash(body)}`;

/**
 * Validate every record with the Worker's validators. `domain` holds the
 * real modules: { schema, urls, guide }. Returns a list of problems.
 */
export function validateCandidates({ providers, offers }, domain) {
  const { offerCreateSchema, providerSchema } = domain.schema;
  const { isOfficialUrl } = domain.urls;
  const { guideOfficialUrls, guideRuleViolation } = domain.guide;
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const zodIssues = (where, error) =>
    error.issues.forEach((i) => fail(where, `${i.path.join('.') || '(root)'} ${i.message}`));

  const domainsById = new Map();
  for (const [i, entry] of providers.entries()) {
    const where = `provider[${i}] ${entry?.request?.id ?? '?'}`;
    const parsed = providerSchema.safeParse(entry.request);
    if (!parsed.success) {
      zodIssues(where, parsed.error);
      continue;
    }
    if (domainsById.has(parsed.data.id)) fail(where, 'duplicate provider id');
    domainsById.set(parsed.data.id, parsed.data.officialDomains);
  }

  const seen = new Set();
  for (const [i, entry] of offers.entries()) {
    const where = `offer[${i}] ${entry?.request?.id ?? '?'}`;
    const parsed = offerCreateSchema.safeParse(entry.request);
    if (!parsed.success) {
      zodIssues(where, parsed.error);
      continue;
    }
    const offer = parsed.data;
    if (seen.has(offer.id)) fail(where, 'duplicate offer id');
    seen.add(offer.id);
    const drift = changedPath(entry.request, offer);
    if (drift !== null) {
      fail(where, `${drift || '(root)'} not in canonical form (the API would store another value)`);
    }
    const domains = domainsById.get(offer.providerId);
    if (!domains) {
      fail(where, `unknown provider ${offer.providerId}`);
    } else {
      const urls = {
        officialUrl: offer.officialUrl,
        sourceUrl: offer.sourceUrl,
        ...guideOfficialUrls(offer.guide),
      };
      for (const [field, url] of Object.entries(urls)) {
        if (!isOfficialUrl(url, domains)) fail(where, `${field} ${url} is not on ${domains}`);
      }
    }
    const violation = guideRuleViolation(offer.rarity, offer.guide);
    if (violation) fail(where, `guide: ${violation.message} (needed to publish)`);
    if (new TextEncoder().encode(JSON.stringify(entry.request)).length > BODY_LIMIT) {
      fail(where, 'request body exceeds 16 KB');
    }
    const review = entry.review ?? {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(review.fetchedAt ?? ''))
      fail(where, 'review.fetchedAt missing');
    if (!Array.isArray(review.evidenceUrls) || review.evidenceUrls.length === 0) {
      fail(where, 'review.evidenceUrls missing');
    }
    if (typeof review.quote !== 'string' || !review.quote.trim())
      fail(where, 'review.quote missing');
  }
  return errors;
}

/** Load the Worker's TypeScript validators through Vite without starting a server. */
async function loadDomain() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    // Only the three domain modules are loaded; never scan index.html or src/.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const load = (p) => server.ssrLoadModule(resolve(ROOT, p));
    return {
      schema: await load('worker/src/domain/schema.ts'),
      urls: await load('worker/src/domain/urls.ts'),
      guide: await load('worker/src/domain/guide.ts'),
    };
  } finally {
    await server.close();
  }
}

// ── cli ───────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { dryRun: false, pool: null, skipProviders: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-providers') options.skipProviders = true;
    else if (arg === '--pool') {
      const value = argv[++i];
      if (!POOLS.includes(value)) throw new Error(`--pool must be one of: ${POOLS.join(', ')}`);
      options.pool = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function readEnv(env = process.env) {
  const base = env.DEALDEX_API_BASE;
  if (!base) throw new Error('Set DEALDEX_API_BASE (e.g. http://127.0.0.1:8787)');
  const url = new URL(base);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('DEALDEX_API_BASE must be https (plain http only for localhost)');
  }
  const admin = env.DEALDEX_ADMIN_TOKEN || null;
  const inspector = env.DEALDEX_INSPECTOR_TOKEN || null;
  if (!admin && !inspector) {
    throw new Error('Set DEALDEX_ADMIN_TOKEN and/or DEALDEX_INSPECTOR_TOKEN');
  }
  return { base: url.origin, admin, inspector };
}

// ── http ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(base) {
  let lastWrite = 0;
  async function call(method, path, token, { body, key } = {}) {
    for (let attempt = 0; ; attempt++) {
      if (body !== undefined) {
        const wait = lastWrite + WRITE_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastWrite = Date.now();
      }
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Idempotency-Key'] = key;
      }
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      const code = json?.error?.code ?? null;
      if (res.status === 429 && code === 'rate_limited' && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 60;
        console.warn(`  rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }
      return {
        status: res.status,
        code,
        data: json?.data ?? null,
        error: json?.error ?? null,
        // A replayed Idempotency-Key returns the stored response, not live state.
        replayed: res.headers.get('idempotent-replayed') === 'true',
      };
    }
  }
  return call;
}

const describeError = (r) => `${r.status} ${r.code ?? ''} ${r.error?.message ?? ''}`.trim();

async function importProviders(call, token, providers) {
  for (const { request } of providers) {
    const r = await call('POST', '/api/manage/providers', token, {
      body: request,
      key: idempotencyKey('provider', request.id, request),
    });
    if (r.status === 201 && !r.replayed) console.log(`provider ${request.id}: created`);
    else if (r.replayed || r.code === 'already_exists') {
      console.log(`provider ${request.id}: exists (check its domains match providers.json)`);
    } else throw new Error(`provider ${request.id}: ${describeError(r)}`);
  }
}

async function importOffer(call, tokens, request, summary) {
  const token = tokens.inspector ?? tokens.admin;
  const created = await call('POST', '/api/manage/offers', token, {
    body: request,
    key: idempotencyKey('offer', request.id, request),
  });
  if (created.code === 'review_queue_full') {
    throw new Error('review queue full: publish or reject pending cards, then re-run');
  }
  let status;
  if (created.status === 201 && !created.replayed) status = created.data?.status;
  else if (created.replayed || created.code === 'already_exists') {
    const current = await call('GET', `/api/manage/offers/${request.id}`, token);
    status = current.data?.status;
    console.log(`offer ${request.id}: already exists (${status ?? 'unknown status'})`);
    summary.existing.push(request.id);
    // A pre-existing draft may have been rejected by a reviewer: never resubmit it.
    return;
  } else {
    summary.failed.push(`${request.id}: ${describeError(created)}`);
    console.error(`offer ${request.id}: ${describeError(created)}`);
    return;
  }

  if (status === 'draft') {
    const submitted = await call('POST', `/api/manage/offers/${request.id}/submit`, token, {
      body: {},
      key: `cand.submit.${request.id}.${contentHash(request)}`,
    });
    status = submitted.data?.status;
    if (submitted.status !== 200) {
      summary.failed.push(`${request.id}: submit ${describeError(submitted)}`);
      return;
    }
  }
  if (status !== 'pending_review') {
    summary.failed.push(`${request.id}: ended in ${status}, expected pending_review`);
    return;
  }
  if (created.status === 201) summary.created.push(request.id);
  console.log(`offer ${request.id}: pending_review`);
}

// ── main ──────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const all = loadCandidates();
  const errors = validateCandidates(all, await loadDomain());
  const offers = all.offers.filter((o) => !options.pool || o.request.pool === options.pool);
  const counts = Object.fromEntries(
    POOLS.map((p) => [p, all.offers.filter((o) => o.request.pool === p).length]),
  );
  console.log(
    `${all.providers.length} providers, ${all.offers.length} offers ${JSON.stringify(counts)}`,
  );
  if (errors.length) {
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    throw new Error(`${errors.length} validation error(s); nothing was sent`);
  }
  console.log('All records pass the Worker validators.');
  if (options.dryRun) {
    console.log(
      `Dry run: would create ${options.skipProviders ? 0 : all.providers.length} providers`,
    );
    console.log(`and ${offers.length} offers as pending_review. No request sent.`);
    return;
  }

  const env = readEnv();
  const call = makeClient(env.base);
  if (!options.skipProviders) {
    if (!env.admin) throw new Error('Creating providers needs DEALDEX_ADMIN_TOKEN');
    await importProviders(call, env.admin, all.providers);
  }
  const summary = { created: [], existing: [], failed: [] };
  for (const { request } of offers) {
    await importOffer(call, env, request, summary);
  }
  console.log(
    `\nDone: ${summary.created.length} created, ${summary.existing.length} already existed, ` +
      `${summary.failed.length} failed.`,
  );
  summary.failed.forEach((f) => console.error(`  ✗ ${f}`));
  if (summary.failed.length) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
