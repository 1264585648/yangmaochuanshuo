/* Validation for offers received from the public API. The server already
   validates on write; this guards the UI against schema drift and bad caches. */

/**
 * @typedef {object} Conditions
 * @property {boolean} newUsersOnly
 * @property {boolean} studentOnly
 * @property {boolean} requiresPaymentMethod
 * @property {boolean} autoRenews
 * @property {readonly string[]} regions ISO 3166-1 alpha-2; empty means unrestricted.
 * @property {string} note
 */

/**
 * @typedef {object} Offer
 * @property {string} id
 * @property {{ id: string, name: string }} provider
 * @property {'ai' | 'cloud' | 'software' | 'education'} pool
 * @property {'A' | 'S' | 'SSR'} rarity
 * @property {string} title
 * @property {string} summary
 * @property {string} benefit
 * @property {string} officialUrl
 * @property {string} sourceUrl
 * @property {Conditions} conditions
 * @property {string | null} validFrom
 * @property {string | null} validUntil
 * @property {string | null} lastVerifiedAt
 * @property {Guide | null} [guide] Only on single-offer responses; absent from list
 *   responses, null when the server has none or it failed validation.
 */

/**
 * @typedef {object} GuideLink
 * @property {string} label
 * @property {string} url Not yet checked for https; renderers must use `safeHttpsUrl`.
 */

/**
 * @typedef {object} GuideNote
 * @property {'warn' | 'danger'} tone
 * @property {string} title
 * @property {string} text
 */

/**
 * @typedef {object} GuideStep
 * @property {string} text
 * @property {readonly string[]} bullets
 * @property {GuideLink | null} link
 * @property {readonly GuideNote[]} notes
 * @property {string} code Empty when absent.
 */

/**
 * @typedef {object} GuidePhase
 * @property {string} title
 * @property {string} note
 * @property {readonly GuideStep[]} steps
 */

/**
 * @typedef {{ kind: 'brief', steps: readonly GuideStep[] }} BriefGuide
 * @typedef {{ kind: 'full', phases: readonly GuidePhase[],
 *   facts: readonly { label: string, value: string, note: string }[],
 *   faq: readonly { question: string, answer: string, basis: 'official' | 'community' }[],
 *   references: readonly { title: string, url: string, basis: 'official' | 'community' }[] }} FullGuide
 * @typedef {BriefGuide | FullGuide} Guide
 */

export const POOL_IDS = Object.freeze(['ai', 'cloud', 'software', 'education']);
export const RARITY_IDS = Object.freeze(['A', 'S', 'SSR']);

const FLAGS = Object.freeze(['newUsersOnly', 'studentOnly', 'requiresPaymentMethod', 'autoRenews']);
const MAX_TEXT = 500;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;
const isNullableText = (v) => v === null || (typeof v === 'string' && v.length <= MAX_TEXT);

/**
 * @param {unknown} raw
 * @returns {Conditions | null}
 */
function normalizeConditions(raw) {
  if (!isObject(raw)) return null;
  if (!FLAGS.every((flag) => typeof raw[flag] === 'boolean')) return null;
  const regions = Array.isArray(raw.regions)
    ? raw.regions.filter((r) => typeof r === 'string' && /^[A-Z]{2}$/.test(r))
    : [];
  return Object.freeze({
    newUsersOnly: raw.newUsersOnly,
    studentOnly: raw.studentOnly,
    requiresPaymentMethod: raw.requiresPaymentMethod,
    autoRenews: raw.autoRenews,
    regions: Object.freeze(regions),
    note: typeof raw.note === 'string' ? raw.note.slice(0, MAX_TEXT) : '',
  });
}

/* Guides are validated loosely: caps are generous so a server-side limit change
   never hides content, and a malformed part is dropped instead of the offer. */
const GUIDE_TEXT = 2000;
const GUIDE_CODE = 4000;
const GUIDE_LIST = 50;

const guideText = (v) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= GUIDE_TEXT ? v.trim() : null;
const optionalText = (v) => guideText(v) ?? '';

/**
 * Map an array with `fn`, dropping items it rejects (null).
 * @template T
 * @param {unknown} list
 * @param {(item: unknown) => T | null} fn
 * @returns {readonly T[]}
 */
const keepValid = (list, fn) =>
  Object.freeze(
    Array.isArray(list)
      ? list
          .slice(0, GUIDE_LIST)
          .map(fn)
          .filter((x) => x !== null)
      : [],
  );

/** Anything not explicitly official is shown as community knowledge. */
const basisOf = (v) => (v === 'official' ? 'official' : 'community');

/** @returns {GuideLink | null} */
function normalizeLink(raw) {
  if (!isObject(raw)) return null;
  const label = guideText(raw.label);
  const url = guideText(raw.url);
  return label && url ? Object.freeze({ label, url }) : null;
}

/** @returns {GuideNote | null} */
function normalizeNote(raw) {
  if (!isObject(raw)) return null;
  const title = guideText(raw.title);
  const text = guideText(raw.text);
  if (!title || !text) return null;
  return Object.freeze({ tone: raw.tone === 'danger' ? 'danger' : 'warn', title, text });
}

/** @returns {GuideStep | null} */
function normalizeStep(raw) {
  if (!isObject(raw)) return null;
  const text = guideText(raw.text);
  if (!text) return null;
  const code = typeof raw.code === 'string' && raw.code.length <= GUIDE_CODE ? raw.code : '';
  return Object.freeze({
    text,
    bullets: keepValid(raw.bullets, guideText),
    link: normalizeLink(raw.link),
    notes: keepValid(raw.notes, normalizeNote),
    code: code.trim() ? code : '',
  });
}

/** @returns {GuidePhase | null} */
function normalizePhase(raw) {
  if (!isObject(raw)) return null;
  const title = guideText(raw.title);
  const steps = keepValid(raw.steps, normalizeStep);
  if (!title || steps.length === 0) return null;
  return Object.freeze({ title, note: optionalText(raw.note), steps });
}

function normalizeFact(raw) {
  if (!isObject(raw)) return null;
  const label = guideText(raw.label);
  const value = guideText(raw.value);
  return label && value ? Object.freeze({ label, value, note: optionalText(raw.note) }) : null;
}

function normalizeFaq(raw) {
  if (!isObject(raw)) return null;
  const question = guideText(raw.question);
  const answer = guideText(raw.answer);
  return question && answer ? Object.freeze({ question, answer, basis: basisOf(raw.basis) }) : null;
}

function normalizeReference(raw) {
  if (!isObject(raw)) return null;
  const title = guideText(raw.title);
  const url = guideText(raw.url);
  return title && url ? Object.freeze({ title, url, basis: basisOf(raw.basis) }) : null;
}

/**
 * Deep-frozen guide, or null when it is missing, of an unknown kind, or has
 * no usable step left after dropping malformed parts.
 * @param {unknown} raw
 * @returns {Guide | null}
 */
export function normalizeGuide(raw) {
  if (!isObject(raw)) return null;
  if (raw.kind === 'brief') {
    const steps = keepValid(raw.steps, normalizeStep);
    return steps.length ? Object.freeze({ kind: 'brief', steps }) : null;
  }
  if (raw.kind !== 'full') return null;
  const phases = keepValid(raw.phases, normalizePhase);
  if (phases.length === 0) return null;
  return Object.freeze({
    kind: 'full',
    phases,
    facts: keepValid(raw.facts, normalizeFact),
    faq: keepValid(raw.faq, normalizeFaq),
    references: keepValid(raw.references, normalizeReference),
  });
}

/**
 * Return a frozen, well-formed offer, or null when any required field is wrong.
 * @param {unknown} raw
 * @returns {Offer | null}
 */
export function normalizeOffer(raw) {
  if (!isObject(raw)) return null;
  const { provider } = raw;
  const textFields = ['id', 'title', 'summary', 'benefit', 'officialUrl', 'sourceUrl'];
  if (!textFields.every((key) => isText(raw[key]))) return null;
  if (!POOL_IDS.includes(raw.pool) || !RARITY_IDS.includes(raw.rarity)) return null;
  if (!isObject(provider) || !isText(provider.id) || !isText(provider.name)) return null;
  if (!['validFrom', 'validUntil', 'lastVerifiedAt'].every((k) => isNullableText(raw[k] ?? null))) {
    return null;
  }
  const conditions = normalizeConditions(raw.conditions);
  if (!conditions) return null;
  return Object.freeze({
    id: raw.id,
    provider: Object.freeze({ id: provider.id, name: provider.name }),
    pool: raw.pool,
    rarity: raw.rarity,
    title: raw.title,
    summary: raw.summary,
    benefit: raw.benefit,
    officialUrl: raw.officialUrl,
    sourceUrl: raw.sourceUrl,
    conditions,
    validFrom: raw.validFrom ?? null,
    validUntil: raw.validUntil ?? null,
    lastVerifiedAt: raw.lastVerifiedAt ?? null,
    // List responses carry no guide: leave the key out rather than claim there is none.
    ...('guide' in raw ? { guide: normalizeGuide(raw.guide) } : {}),
  });
}
