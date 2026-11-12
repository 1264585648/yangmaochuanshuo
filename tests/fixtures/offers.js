/* API-shaped offers for frontend tests. Fictional, on reserved example.* domains. */

/**
 * @param {Partial<Record<string, unknown>> & { id: string }} overrides
 * @returns {Record<string, unknown>} One offer exactly as `/api/offers` returns it.
 */
export function apiOffer(overrides) {
  return {
    provider: { id: 'sample', name: '示例提供方' },
    pool: 'ai',
    rarity: 'A',
    title: `Offer ${overrides.id}`,
    summary: 'summary',
    benefit: 'benefit',
    officialUrl: 'https://www.example.com/deal',
    sourceUrl: 'https://docs.example.com/deal',
    conditions: {
      newUsersOnly: false,
      studentOnly: false,
      requiresPaymentMethod: false,
      autoRenews: false,
      regions: [],
      note: '',
    },
    validFrom: null,
    validUntil: null,
    lastVerifiedAt: '2026-11-10T00:00:00Z',
    ...overrides,
  };
}

/**
 * @param {unknown[]} data
 * @param {{ total?: number, limit?: number, offset?: number }} [meta]
 */
export function listEnvelope(data, meta = {}) {
  return {
    success: true,
    data,
    error: null,
    meta: { total: data.length, limit: 50, offset: 0, ...meta },
  };
}

/** @param {unknown} body @param {number} [status] */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
