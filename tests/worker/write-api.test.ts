import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, offerInput, PROVIDER, type Harness } from './helpers/api';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  const { res } = await h.write('POST', '/api/manage/providers', { body: PROVIDER });
  expect(res.status).toBe(201);
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

const create = (id: string, token = h.tokens.admin, overrides = {}) =>
  h.write('POST', '/api/manage/offers', { token, body: offerInput(id, overrides) });

const act = (id: string, action: string, token = h.tokens.admin, body: unknown = {}) =>
  h.write('POST', `/api/manage/offers/${id}/${action}`, { token, body });

const evidence = { sourceUrl: 'https://docs.example.com/terms' };

const publicStatus = async (id: string) => (await h.call('GET', `/api/offers/${id}`)).status;

async function published(id: string) {
  await create(id);
  await act(id, 'submit');
  await act(id, 'publish');
}

describe('providers', () => {
  it('rejects duplicates, bad domains and non-admins', async () => {
    expect((await h.write('POST', '/api/manage/providers', { body: PROVIDER })).res.status).toBe(
      409,
    );
    const bad = { ...PROVIDER, id: 'bad', officialDomains: ['https://x.com'] };
    expect((await h.write('POST', '/api/manage/providers', { body: bad })).res.status).toBe(400);
    const other = { ...PROVIDER, id: 'other' };
    const asInspector = await h.write('POST', '/api/manage/providers', {
      token: h.tokens.inspector,
      body: other,
    });
    expect(asInspector.res.status).toBe(403);
  });

  it('lets admins update official domains', async () => {
    await h.write('POST', '/api/manage/providers', {
      body: { id: 'acme', name: 'Acme', officialDomains: ['acme.example'] },
    });
    const { res, body } = await h.write('PATCH', '/api/manage/providers/acme', {
      body: { officialDomains: ['acme.example', 'acme-docs.example'] },
    });
    expect(res.status).toBe(200);
    expect(body.data.officialDomains).toEqual(['acme.example', 'acme-docs.example']);
    const inspector = await h.write('PATCH', '/api/manage/providers/acme', {
      token: h.tokens.inspector,
      body: { officialDomains: ['evil.example'] },
    });
    expect(inspector.res.status).toBe(403);
  });
});

describe('creating offers', () => {
  it('creates admin offers as drafts with server-owned fields', async () => {
    const { res, body } = await create('admin-draft');
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({
      id: 'admin-draft',
      status: 'draft',
      version: 1,
      createdBy: 'admin-1',
      lastVerifiedAt: null,
      createdAt: '2026-11-11T12:00:00.000Z',
    });
    expect(body.data.conditions.newUsersOnly).toBe(true);
    expect(await publicStatus('admin-draft')).toBe(404);
  });

  it('sends inspector offers straight to review', async () => {
    const { res, body } = await create('inspector-new', h.tokens.inspector);
    expect(res.status).toBe(201);
    expect(body.data.status).toBe('pending_review');
    expect(await publicStatus('inspector-new')).toBe(404);
  });

  it.each([
    ['sourceUrl', 'https://evil.example/terms'],
    ['officialUrl', 'https://example.com.evil.example/'],
  ])('rejects a %s outside the provider domains', async (field, url) => {
    const { res, body } = await create(`bad-${field.toLowerCase()}`, h.tokens.admin, {
      [field]: url,
    });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('unofficial_url');
  });

  it('rejects unknown providers, duplicates and server-owned fields', async () => {
    expect(
      (await create('no-provider', h.tokens.admin, { providerId: 'missing' })).res.status,
    ).toBe(422);
    expect((await create('admin-draft')).res.status).toBe(409);
    const sneaky = await create('sneaky', h.tokens.inspector, { status: 'published' });
    expect(sneaky.res.status).toBe(400);
  });
});

describe('status transitions', () => {
  it('runs the full lifecycle with correct visibility', async () => {
    await create('lifecycle');
    expect((await act('lifecycle', 'submit')).body.data.status).toBe('pending_review');
    expect((await act('lifecycle', 'publish')).body.data.status).toBe('published');
    expect(await publicStatus('lifecycle')).toBe(200);

    const verified = await act('lifecycle', 'verify', h.tokens.inspector, evidence);
    expect(verified.res.status).toBe(200);
    expect(verified.body.data.lastVerifiedAt).toBe('2026-11-11T12:00:00.000Z');

    expect((await act('lifecycle', 'expire', h.tokens.inspector, evidence)).body.data.status).toBe(
      'expired',
    );
    expect(await publicStatus('lifecycle')).toBe(404);
    expect((await act('lifecycle', 'restore')).body.data.status).toBe('published');
  });

  it('forbids inspectors from publishing their own submissions', async () => {
    const { res, body } = await act('inspector-new', 'publish', h.tokens.inspector);
    expect(res.status).toBe(403);
    expect(body.error?.code).toBe('forbidden');
  });

  it('rejects transitions from the wrong state', async () => {
    const { res, body } = await act('admin-draft', 'publish');
    expect(res.status).toBe(409);
    expect(body.error?.code).toBe('invalid_state');
  });

  it('requires official evidence to verify or expire', async () => {
    await published('needs-evidence');
    expect((await act('needs-evidence', 'verify', h.tokens.inspector, {})).res.status).toBe(400);
    const offsite = { sourceUrl: 'https://evil.example/' };
    expect((await act('needs-evidence', 'expire', h.tokens.inspector, offsite)).res.status).toBe(
      422,
    );
  });

  it('returns 404 for unknown offers and actions', async () => {
    expect((await act('missing-offer', 'submit')).res.status).toBe(404);
    expect((await act('admin-draft', 'teleport')).res.status).toBe(404);
  });
});

describe('direct edits', () => {
  it('lets admins edit with optimistic concurrency', async () => {
    await published('editable');
    const { res, body } = await h.write('PATCH', '/api/manage/offers/editable', {
      body: { baseVersion: 1, changes: { title: 'Edited title' } },
    });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ title: 'Edited title', version: 2, status: 'published' });

    const stale = await h.write('PATCH', '/api/manage/offers/editable', {
      body: { baseVersion: 1, changes: { title: 'Lost update' } },
    });
    expect(stale.res.status).toBe(409);
    expect(stale.body.error?.code).toBe('version_conflict');
  });

  it('forbids inspectors from editing directly', async () => {
    const { res } = await h.write('PATCH', '/api/manage/offers/editable', {
      token: h.tokens.inspector,
      body: { baseVersion: 2, changes: { title: 'Inspector edit' } },
    });
    expect(res.status).toBe(403);
  });

  it.each([
    [{ baseVersion: 2, changes: { status: 'draft' } }],
    [{ baseVersion: 2, changes: {} }],
    [{ changes: { title: 'x' } }],
    [{ baseVersion: 2, changes: { validFrom: '2027-01-01', validUntil: '2026-01-01' } }],
  ])('rejects invalid edit %j', async (body) => {
    expect((await h.write('PATCH', '/api/manage/offers/editable', { body })).res.status).toBe(400);
  });

  it('validates the merged result, not just the patch', async () => {
    await h.write('PATCH', '/api/manage/offers/editable', {
      body: { baseVersion: 2, changes: { validUntil: '2026-12-31' } },
    });
    const { res } = await h.write('PATCH', '/api/manage/offers/editable', {
      body: { baseVersion: 3, changes: { validFrom: '2027-01-01' } },
    });
    expect(res.status).toBe(400);
  });

  it('re-checks official domains on edited URLs', async () => {
    const { res } = await h.write('PATCH', '/api/manage/offers/editable', {
      body: { baseVersion: 3, changes: { officialUrl: 'https://evil.example/' } },
    });
    expect(res.status).toBe(422);
  });
});

describe('change requests', () => {
  it('lets inspectors propose edits that admins apply', async () => {
    await published('proposed');
    const proposal = await h.write('POST', '/api/manage/offers/proposed/changes', {
      token: h.tokens.inspector,
      body: { baseVersion: 1, changes: { benefit: 'Bigger credit' }, ...evidence },
    });
    expect(proposal.res.status).toBe(201);
    expect(proposal.body.data).toMatchObject({ status: 'pending', createdBy: 'inspector-1' });
    const changeId = proposal.body.data.id;

    const live = await (await h.call('GET', '/api/offers/proposed')).json();
    expect((live as { data: { benefit: string } }).data.benefit).toBe('Test credit');

    const pending = await h.read('/api/manage/changes?status=pending', h.tokens.admin);
    expect(pending.body.data.map((c: { id: string }) => c.id)).toContain(changeId);

    expect(
      (
        await h.write('POST', `/api/manage/changes/${changeId}/apply`, {
          token: h.tokens.inspector,
        })
      ).res.status,
    ).toBe(403);

    const applied = await h.write('POST', `/api/manage/changes/${changeId}/apply`);
    expect(applied.res.status).toBe(200);
    expect(applied.body.data.offer).toMatchObject({ benefit: 'Bigger credit', version: 2 });
    expect(applied.body.data.change.status).toBe('applied');

    const again = await h.write('POST', `/api/manage/changes/${changeId}/apply`);
    expect(again.res.status).toBe(409);
  });

  it('refuses to apply a change whose base is stale', async () => {
    await published('raced');
    const proposal = await h.write('POST', '/api/manage/offers/raced/changes', {
      token: h.tokens.inspector,
      body: { baseVersion: 1, changes: { title: 'Inspector title' }, ...evidence },
    });
    await h.write('PATCH', '/api/manage/offers/raced', {
      body: { baseVersion: 1, changes: { title: 'Admin title' } },
    });
    const apply = await h.write('POST', `/api/manage/changes/${proposal.body.data.id}/apply`);
    expect(apply.res.status).toBe(409);
    const stillPending = await h.read(`/api/manage/changes?status=pending`, h.tokens.admin);
    expect(stillPending.body.data.map((c: { id: string }) => c.id)).toContain(
      proposal.body.data.id,
    );
  });

  it('lets admins reject proposals', async () => {
    await published('rejected-proposal');
    const proposal = await h.write('POST', '/api/manage/offers/rejected-proposal/changes', {
      token: h.tokens.inspector,
      body: { baseVersion: 1, changes: { title: 'Nope' }, ...evidence },
    });
    const id = proposal.body.data.id;
    const rejected = await h.write('POST', `/api/manage/changes/${id}/reject`);
    expect(rejected.body.data.status).toBe('rejected');
    expect((await h.write('POST', `/api/manage/changes/${id}/apply`)).res.status).toBe(409);
  });

  it('requires official evidence for proposals', async () => {
    const { res } = await h.write('POST', '/api/manage/offers/proposed/changes', {
      token: h.tokens.inspector,
      body: { baseVersion: 2, changes: { title: 'x' }, sourceUrl: 'https://evil.example/' },
    });
    expect(res.status).toBe(422);
  });
});

describe('audit and revert', () => {
  it('records before and after for every write', async () => {
    await published('audited');
    await h.write('PATCH', '/api/manage/offers/audited', {
      body: { baseVersion: 1, changes: { title: 'Audited v2' } },
    });
    const { res, body } = await h.read('/api/manage/audit?entityType=offer&entityId=audited');
    expect(res.status).toBe(200);
    expect(body.data.map((e: { action: string }) => e.action)).toEqual([
      'offer.update',
      'offer.publish',
      'offer.submit',
      'offer.create',
    ]);
    const update = body.data[0];
    expect(update.actor).toBe('admin-1');
    expect(update.before.title).toBe('Offer audited');
    expect(update.after.title).toBe('Audited v2');
  });

  it('is admin-only', async () => {
    expect(
      (await h.read('/api/manage/audit?entityId=audited', h.tokens.inspector)).res.status,
    ).toBe(403);
  });

  it('reverts a content edit as a new audited write', async () => {
    const log = await h.read('/api/manage/audit?entityType=offer&entityId=audited');
    const updateId = log.body.data[0].id;
    const { res, body } = await h.write('POST', `/api/manage/audit/${updateId}/revert`);
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ title: 'Offer audited', version: 3 });
    const again = await h.write('POST', `/api/manage/audit/${updateId}/revert`);
    expect(again.res.status).toBe(409);
  });

  it('refuses to revert non-content actions', async () => {
    const log = await h.read('/api/manage/audit?entityType=offer&entityId=audited');
    const publish = log.body.data.find((e: { action: string }) => e.action === 'offer.publish');
    expect((await h.write('POST', `/api/manage/audit/${publish.id}/revert`)).res.status).toBe(422);
  });
});

describe('management reads', () => {
  it('lists offers by status for any authenticated caller', async () => {
    const { res, body } = await h.read(
      '/api/manage/offers?status=pending_review',
      h.tokens.inspector,
    );
    expect(res.status).toBe(200);
    expect(body.data.map((o: { id: string }) => o.id)).toContain('inspector-new');
    expect(body.data.every((o: { status: string }) => o.status === 'pending_review')).toBe(true);
  });

  it('shows a single offer in any status', async () => {
    const { body } = await h.read('/api/manage/offers/admin-draft');
    expect(body.data).toMatchObject({ id: 'admin-draft', status: 'draft' });
    expect((await h.read('/api/manage/offers/nope')).res.status).toBe(404);
  });

  it('never caches management responses', async () => {
    const { res } = await h.read('/api/manage/offers');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
