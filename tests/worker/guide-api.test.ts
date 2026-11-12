import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, offerInput, PROVIDER, type Harness } from './helpers/api';
import { seedOffers } from './helpers/seed';
import { briefGuide, fullGuide, oracleGuide } from './guide-fixtures';

let h: Harness;

const ORACLE = {
  id: 'oracle',
  name: 'Oracle Cloud',
  officialDomains: ['oracle.com', 'oraclecloud.com'],
};

beforeAll(async () => {
  h = await createHarness();
  for (const provider of [PROVIDER, ORACLE]) {
    const { res } = await h.write('POST', '/api/manage/providers', { body: provider });
    expect(res.status).toBe(201);
  }
}, 60_000);

afterAll(async () => {
  await h?.t.dispose();
});

const create = (id: string, overrides: Record<string, unknown> = {}) =>
  h.write('POST', '/api/manage/offers', { body: offerInput(id, overrides) });

const act = (id: string, action: string, body: unknown = {}) =>
  h.write('POST', `/api/manage/offers/${id}/${action}`, { body });

const edit = (id: string, baseVersion: number, changes: Record<string, unknown>) =>
  h.write('PATCH', `/api/manage/offers/${id}`, { body: { baseVersion, changes } });

async function publish(id: string, overrides: Record<string, unknown> = {}) {
  expect((await create(id, overrides)).res.status).toBe(201);
  expect((await act(id, 'submit')).res.status).toBe(200);
  const res = await act(id, 'publish');
  expect(res.res.status).toBe(200);
  return res.body.data;
}

describe('publishing requires a matching guide', () => {
  it('refuses to publish an offer without a guide', async () => {
    await create('no-guide', { guide: null });
    await act('no-guide', 'submit');
    const { res, body } = await act('no-guide', 'publish');
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('guide_required');
  });

  it('refuses SSR with a brief guide until the full guide is added', async () => {
    await create('ssr-brief', { rarity: 'SSR' });
    await act('ssr-brief', 'submit');
    const refused = await act('ssr-brief', 'publish');
    expect(refused.res.status).toBe(422);
    expect(refused.body.error?.code).toBe('guide_mismatch');

    expect((await edit('ssr-brief', 1, { guide: fullGuide() })).res.status).toBe(200);
    expect((await act('ssr-brief', 'publish')).res.status).toBe(200);
  });

  it('refuses a full guide on a non-SSR offer', async () => {
    await create('s-full', { guide: fullGuide() });
    await act('s-full', 'submit');
    expect((await act('s-full', 'publish')).body.error?.code).toBe('guide_mismatch');
  });

  it('lets drafts carry any guide or none', async () => {
    expect((await create('draft-mix', { rarity: 'SSR', guide: briefGuide() })).res.status).toBe(
      201,
    );
    expect((await edit('draft-mix', 1, { guide: null })).res.status).toBe(200);
  });
});

describe('published offers cannot be edited out of the rule', () => {
  it('blocks re-rating to SSR without a full guide', async () => {
    await publish('rerate');
    const { res, body } = await edit('rerate', 1, { rarity: 'SSR' });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('guide_mismatch');
    const both = await edit('rerate', 1, { rarity: 'SSR', guide: fullGuide() });
    expect(both.res.status).toBe(200);
  });

  it('blocks removing the guide', async () => {
    await publish('remove-guide');
    expect((await edit('remove-guide', 1, { guide: null })).body.error?.code).toBe(
      'guide_required',
    );
  });

  it('blocks applying an inspector proposal that breaks the rule', async () => {
    await publish('proposal');
    const proposal = await h.write('POST', '/api/manage/offers/proposal/changes', {
      token: h.tokens.inspector,
      body: {
        baseVersion: 1,
        changes: { rarity: 'SSR' },
        sourceUrl: 'https://docs.example.com/terms',
      },
    });
    expect(proposal.res.status).toBe(201);
    const applied = await h.write('POST', `/api/manage/changes/${proposal.body.data.id}/apply`);
    expect(applied.res.status).toBe(422);
    expect(applied.body.error?.code).toBe('guide_mismatch');
  });

  it('does not let inspectors write guides directly', async () => {
    await publish('inspector-direct');
    const { res } = await h.write('PATCH', '/api/manage/offers/inspector-direct', {
      token: h.tokens.inspector,
      body: { baseVersion: 1, changes: { guide: briefGuide() } },
    });
    expect(res.status).toBe(403);
  });

  it('blocks a revert that would leave a published offer without a guide', async () => {
    await seedOffers(h.db, [{ id: 'legacy', guide: null }]);
    expect((await edit('legacy', 1, { guide: briefGuide() })).res.status).toBe(200);
    const audit = await h.read('/api/manage/audit?entityType=offer&entityId=legacy');
    const { res, body } = await h.write(
      'POST',
      `/api/manage/audit/${audit.body.data[0].id}/revert`,
    );
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('guide_required');
  });

  it('still lets legacy guide-less offers be verified', async () => {
    await seedOffers(h.db, [{ id: 'legacy-verify', guide: null }]);
    const { res } = await act('legacy-verify', 'verify', {
      sourceUrl: 'https://docs.example.com/deal',
    });
    expect(res.status).toBe(200);
  });
});

describe('guide links', () => {
  it('rejects step links outside the provider domains, naming the field', async () => {
    const guide = briefGuide() as { steps: Record<string, unknown>[] };
    guide.steps[1] = { text: 'x', link: { label: 'l', url: 'https://evil.example/' } };
    const { res, body } = await create('bad-link', { guide });
    expect(res.status).toBe(422);
    expect(body.error?.code).toBe('unofficial_url');
    expect(body.error?.message).toContain('guide.steps.1.link.url');
  });

  it('rejects official references on other domains but accepts community ones', async () => {
    const guide = fullGuide() as { references: unknown[] };
    guide.references = [{ title: 't', url: 'https://dev.to/x', basis: 'official' }];
    const bad = await create('bad-ref', { rarity: 'SSR', guide });
    expect(bad.body.error?.code).toBe('unofficial_url');
    guide.references = [{ title: 't', url: 'https://dev.to/x', basis: 'community' }];
    expect((await create('community-ref', { rarity: 'SSR', guide })).res.status).toBe(201);
  });
});

describe('the Oracle sample end to end', () => {
  const oracle = {
    providerId: 'oracle',
    pool: 'cloud',
    rarity: 'SSR',
    title: 'Oracle Cloud 永久免费云服务器',
    officialUrl: 'https://signup.oraclecloud.com/',
    sourceUrl:
      'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
    conditions: { requiresPaymentMethod: true },
    guide: oracleGuide(),
  };

  it('publishes, serves the guide on the detail endpoint only, and detects no-op edits', async () => {
    await publish('oracle-cloud-always-free', oracle);

    const detail = await h.read('/api/offers/oracle-cloud-always-free', null);
    expect(detail.res.status).toBe(200);
    expect(detail.body.data.guide.kind).toBe('full');
    expect(detail.body.data.guide.phases).toHaveLength(3);
    expect(detail.body.data.guide.faq[3].basis).toBe('community');

    const list = await h.read('/api/offers?provider=oracle', null);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).not.toHaveProperty('guide');

    const same = await edit('oracle-cloud-always-free', 1, { guide: oracleGuide() });
    expect(same.res.status).toBe(422);
    expect(same.body.error?.code).toBe('no_changes');
  });
});
