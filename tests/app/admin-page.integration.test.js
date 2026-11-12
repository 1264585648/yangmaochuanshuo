// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mountAdminPage } from '../../src/app/admin-page.js';

const $ = (selector) => document.querySelector(selector);
const flush = () => new Promise((r) => setTimeout(r, 0));

let template;

beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), 'admin.html'), 'utf8');
  template = html.replace(/<script[\s\S]*?<\/script>/g, '');
});

function createFakeManageApi({ scope = 'admin' } = {}) {
  const calls = [];
  const state = {
    providers: [
      {
        id: 'example',
        name: 'Example',
        officialDomains: ['example.com'],
        createdAt: '2026-11-11T00:00:00Z',
        updatedAt: '2026-11-11T00:00:00Z',
      },
    ],
    offers: [
      {
        id: 'demo-offer',
        providerId: 'example',
        providerName: 'Example',
        pool: 'ai',
        rarity: 'S',
        title: 'Demo <script>alert(1)</script>',
        summary: 'Summary',
        benefit: '$20 credit',
        officialUrl: 'https://www.example.com/promo',
        sourceUrl: 'https://docs.example.com/terms',
        conditions: {
          newUsersOnly: true,
          studentOnly: false,
          requiresPaymentMethod: false,
          autoRenews: false,
          regions: ['US'],
          note: '',
        },
        validFrom: null,
        validUntil: null,
        guide: { kind: 'brief', steps: [{ text: '1' }, { text: '2' }, { text: '3' }] },
        status: 'pending_review',
        lastVerifiedAt: null,
        version: 1,
        createdBy: 'admin-1',
        createdAt: '2026-11-11T00:00:00Z',
        updatedAt: '2026-11-11T00:00:00Z',
      },
    ],
    changes: [
      {
        id: 'chg-1',
        offerId: 'demo-offer',
        changes: { title: 'Updated' },
        sourceUrl: 'https://docs.example.com/terms',
        baseVersion: 1,
        status: 'pending',
        createdBy: 'inspector-1',
        createdAt: '2026-11-11T01:00:00Z',
        reviewedBy: null,
        reviewedAt: null,
      },
    ],
    audit: [
      {
        id: 7,
        actor: 'admin-1',
        action: 'offer.update',
        entityType: 'offer',
        entityId: 'demo-offer',
        before: { title: 'Old' },
        after: { title: 'Demo' },
        sourceUrl: null,
        createdAt: '2026-11-11T01:00:00Z',
      },
    ],
  };

  const reply = (data, status = 200, meta) =>
    new Response(JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl = vi.fn(async (url, init = {}) => {
    const parsed = new URL(url, 'https://dealdex.test');
    const path = parsed.pathname;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });

    if (init.headers?.authorization !== 'Bearer ddx_valid') {
      return new Response(
        JSON.stringify({
          success: false,
          data: null,
          error: { code: 'unauthorized', message: 'Invalid token' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }

    if (method === 'GET' && path === '/api/manage/me') {
      return reply({ id: `${scope}-1`, scope });
    }
    if (method === 'GET' && path === '/api/manage/providers') {
      return reply(state.providers);
    }
    if (method === 'POST' && path === '/api/manage/providers') {
      const p = { ...body, createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z' };
      state.providers.push(p);
      return reply(p, 201);
    }
    if (method === 'PATCH' && path.startsWith('/api/manage/providers/')) {
      const id = path.split('/').pop();
      const p = state.providers.find((x) => x.id === id);
      Object.assign(p, body, { updatedAt: '2026-11-12T01:00:00Z' });
      return reply(p);
    }
    if (method === 'GET' && path === '/api/manage/offers') {
      const status = parsed.searchParams.get('status');
      const offset = Number(parsed.searchParams.get('offset') ?? 0);
      const all = status ? state.offers.filter((o) => o.status === status) : state.offers;
      const rows = all.slice(offset, offset + 20);
      return reply(rows, 200, { total: all.length, limit: 20, offset });
    }
    if (method === 'POST' && path === '/api/manage/offers') {
      const o = {
        ...body,
        providerName: 'Example',
        status: 'draft',
        lastVerifiedAt: null,
        version: 1,
        createdBy: 'admin-1',
        createdAt: '2026-11-12T00:00:00Z',
        updatedAt: '2026-11-12T00:00:00Z',
      };
      state.offers.push(o);
      return reply(o, 201);
    }
    if (method === 'PATCH' && path.startsWith('/api/manage/offers/')) {
      const id = path.split('/').pop();
      const o = state.offers.find((x) => x.id === id);
      Object.assign(o, body.changes, { version: o.version + 1 });
      return reply(o);
    }
    if (method === 'POST' && path.endsWith('/submit')) {
      state.offers[0].status = 'pending_review';
      return reply(state.offers[0]);
    }
    if (method === 'POST' && path.endsWith('/publish')) {
      const o = state.offers[0];
      o.status = 'published';
      o.lastVerifiedAt = body.verified ? '2026-11-12T00:00:00Z' : null;
      return reply(o);
    }
    if (method === 'POST' && path.endsWith('/expire')) {
      state.offers[0].status = 'expired';
      return reply(state.offers[0]);
    }
    if (method === 'POST' && path.endsWith('/restore')) {
      state.offers[0].status = 'published';
      return reply(state.offers[0]);
    }
    if (method === 'POST' && path.endsWith('/changes')) {
      return reply({ id: 'chg-new' }, 201);
    }
    if (method === 'GET' && path === '/api/manage/changes') {
      const status = parsed.searchParams.get('status');
      const rows = status ? state.changes.filter((c) => c.status === status) : state.changes;
      return reply(rows);
    }
    if (method === 'POST' && path === '/api/manage/changes/chg-1/apply') {
      state.changes[0].status = 'applied';
      return reply({ offer: state.offers[0], change: state.changes[0] });
    }
    if (method === 'POST' && path === '/api/manage/changes/chg-1/reject') {
      state.changes[0].status = 'rejected';
      return reply(state.changes[0]);
    }
    if (method === 'GET' && path === '/api/manage/audit') {
      const entityType = parsed.searchParams.get('entityType');
      const rows = entityType
        ? state.audit.filter((a) => a.entityType === entityType)
        : state.audit;
      return reply(rows);
    }
    if (method === 'POST' && path === '/api/manage/audit/7/revert') {
      return reply(state.offers[0]);
    }
    return reply({});
  });

  return { fetchImpl, calls, state };
}

beforeEach(() => {
  window.sessionStorage.clear();
  document.documentElement.innerHTML = template;
});

describe('admin console integration', () => {
  it('logs in, escapes offer HTML, creates provider and offer, publishes with verify, and manages changes/audit', async () => {
    const fake = createFakeManageApi({ scope: 'admin' });
    mountAdminPage({
      main: $('#adminMain'),
      toastEl: $('#adminToast'),
      win: window,
      fetchImpl: fake.fetchImpl,
    });

    expect($('#adminLoginForm')).not.toBeNull();
    $('#adminTokenInput').value = 'ddx_valid';
    $('#adminLoginForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();

    // Offers loaded & XSS escaped
    expect($('#adminMain').innerHTML).not.toContain('<script>alert(1)</script>');
    expect($('#adminMain').innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(window.sessionStorage.getItem('dealdex_admin_token')).toBe('ddx_valid');

    // Publish with verified: true via action modal
    $('[data-offer-action="publish"]').click();
    expect($('#actionForm')).not.toBeNull();
    $('#actionForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect(
      fake.calls.some(
        (c) => c.path === '/api/manage/offers/demo-offer/publish' && c.body.verified === true,
      ),
    ).toBe(true);

    // Edit offer via modal
    $('[data-offer-edit="demo-offer"]').click();
    expect($('#offerForm')).not.toBeNull();
    $('#offerForm').elements.namedItem('title').value = 'Renamed Offer';
    $('#offerForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect(
      fake.calls.some(
        (c) =>
          c.method === 'PATCH' &&
          c.path === '/api/manage/offers/demo-offer' &&
          c.body.changes.title === 'Renamed Offer',
      ),
    ).toBe(true);

    // Switch to providers tab and create a provider
    $('[data-tab="providers"]').click();
    await flush();
    $('[data-provider-new]').click();
    $('#providerForm').elements.namedItem('id').value = 'cf';
    $('#providerForm').elements.namedItem('name').value = 'Cloudflare';
    $('#providerForm').elements.namedItem('officialDomains').value = 'cloudflare.com';
    $('#providerForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/api/manage/providers')).toBe(
      true,
    );

    // Switch to changes tab and apply pending change
    $('[data-tab="changes"]').click();
    await flush();
    $('[data-change-apply="chg-1"]').click();
    await flush();
    expect(fake.calls.some((c) => c.path === '/api/manage/changes/chg-1/apply')).toBe(true);

    // Switch to audit tab and revert entry
    $('[data-tab="audit"]').click();
    await flush();
    $('[data-audit-revert="7"]').click();
    await flush();
    expect(fake.calls.some((c) => c.path === '/api/manage/audit/7/revert')).toBe(true);

    // Logout clears sessionStorage
    $('[data-action="logout"]').click();
    expect(window.sessionStorage.getItem('dealdex_admin_token')).toBeNull();
    expect($('#adminLoginForm')).not.toBeNull();
  });

  it('shows inspector-specific controls and allows proposing changes', async () => {
    window.sessionStorage.setItem('dealdex_admin_token', 'ddx_valid');
    const fake = createFakeManageApi({ scope: 'inspector' });
    mountAdminPage({
      main: $('#adminMain'),
      toastEl: $('#adminToast'),
      win: window,
      fetchImpl: fake.fetchImpl,
    });
    await flush();

    // Audit tab is hidden for inspector
    expect($('[data-tab="audit"]')).toBeNull();
    expect($('[data-offer-edit="demo-offer"]')).toBeNull();
    $('[data-offer-propose="demo-offer"]').click();
    $('#offerForm').elements.namedItem('title').value = 'Inspector Edit';
    $('#offerForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect(
      fake.calls.some(
        (c) =>
          c.method === 'POST' &&
          c.path === '/api/manage/offers/demo-offer/changes' &&
          c.body.changes.title === 'Inspector Edit',
      ),
    ).toBe(true);
  });

  it('creates an offer using the guide template generator and filters by keyword', async () => {
    window.sessionStorage.setItem('dealdex_admin_token', 'ddx_valid');
    const fake = createFakeManageApi({ scope: 'admin' });
    mountAdminPage({ main: $('#adminMain'), win: window, fetchImpl: fake.fetchImpl });
    await flush();

    $('[data-offer-new]').click();
    $('[data-guide-template]').click();
    expect($('#offerGuideTextarea').value).toContain('"kind": "brief"');
    const f = $('#offerForm');
    f.elements.namedItem('id').value = 'new-offer';
    f.elements.namedItem('title').value = 'New Offer';
    f.elements.namedItem('benefit').value = 'Free Tier';
    f.elements.namedItem('summary').value = 'Details';
    f.elements.namedItem('officialUrl').value = 'https://example.com/offer';
    f.elements.namedItem('sourceUrl').value = 'https://example.com/docs';
    f.dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/api/manage/offers')).toBe(
      true,
    );

    // Filter input
    const input = $('#offerFilterInput');
    input.value = 'new-offer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.admin-card')).toHaveLength(1);
  });

  it('shows error banner on invalid token', async () => {
    const fake = createFakeManageApi();
    mountAdminPage({ main: $('#adminMain'), win: window, fetchImpl: fake.fetchImpl });
    $('#adminTokenInput').value = 'ddx_wrong';
    $('#adminLoginForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect($('.admin-alert.is-error').textContent).toContain('unauthorized');
  });

  it('signs out and forgets the token when it is revoked mid-session', async () => {
    window.sessionStorage.setItem('dealdex_admin_token', 'ddx_valid');
    const fake = createFakeManageApi();
    let revoked = false;
    const fetchImpl = (url, init = {}) =>
      fake.fetchImpl(
        url,
        revoked ? { ...init, headers: { ...init.headers, authorization: 'x' } } : init,
      );
    mountAdminPage({ main: $('#adminMain'), win: window, fetchImpl });
    await flush();
    expect($('#adminLoginForm')).toBeNull();

    revoked = true;
    $('[data-action="refresh"]').click();
    await flush();
    expect($('#adminLoginForm')).not.toBeNull();
    expect($('.admin-alert.is-error').textContent).toContain('unauthorized');
    expect(window.sessionStorage.getItem('dealdex_admin_token')).toBeNull();
  });

  it('keeps the stored token after a transient failure on startup', async () => {
    window.sessionStorage.setItem('dealdex_admin_token', 'ddx_valid');
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: false,
          data: null,
          error: { code: 'internal', message: 'down' },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    mountAdminPage({ main: $('#adminMain'), win: window, fetchImpl });
    await flush();
    expect($('#adminLoginForm')).not.toBeNull();
    expect(window.sessionStorage.getItem('dealdex_admin_token')).toBe('ddx_valid');
  });

  it('only uses known statuses as badge classes', async () => {
    window.sessionStorage.setItem('dealdex_admin_token', 'ddx_valid');
    const fake = createFakeManageApi();
    fake.state.offers[0].status = 'published injected-class';
    mountAdminPage({ main: $('#adminMain'), win: window, fetchImpl: fake.fetchImpl });
    await flush();
    const badge = $('.admin-card .status-badge');
    expect(badge.className).toBe('status-badge is-unknown');
    expect(badge.textContent).toBe('published injected-class');
  });

  it('covers status filters, editing providers, rejecting changes, audit filters and modal errors', async () => {
    window.sessionStorage.setItem('dealdex_admin_token', 'ddx_valid');
    const fake = createFakeManageApi({ scope: 'admin' });
    mountAdminPage({
      main: $('#adminMain'),
      toastEl: $('#adminToast'),
      win: window,
      fetchImpl: fake.fetchImpl,
    });
    await flush();

    // Filter offers by status and refresh
    $('[data-offer-status="draft"]').click();
    await flush();
    expect($('.empty-state')).not.toBeNull();
    $('[data-offer-status=""]').click();
    await flush();

    // Edit offer with no changes -> modalError, then invalid guide JSON -> modalError, then close
    $('[data-offer-edit="demo-offer"]').click();
    $('#offerForm').dispatchEvent(new Event('submit', { bubbles: true }));
    expect($('.admin-modal .admin-alert.is-error').textContent).toContain('no_changes');
    $('#offerGuideTextarea').value = '{bad';
    $('#offerForm').dispatchEvent(new Event('submit', { bubbles: true }));
    expect($('.admin-modal .admin-alert.is-error').textContent).toContain('invalid_guide');
    $('[data-modal-close]').click();
    expect($('.admin-modal')).toBeNull();

    // Publish -> Expire -> Restore workflow
    $('[data-offer-action="publish"]').click();
    $('#actionForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    $('[data-offer-action="expire"]').click();
    $('#actionForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    $('[data-offer-action="restore"]').click();
    await flush();
    expect(fake.state.offers[0].status).toBe('published');

    // Edit existing provider
    $('[data-tab="providers"]').click();
    await flush();
    $('[data-provider-edit="example"]').click();
    $('#providerForm').elements.namedItem('name').value = 'Example Updated';
    $('#providerForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    expect(fake.state.providers[0].name).toBe('Example Updated');

    // Filter & reject change
    $('[data-tab="changes"]').click();
    await flush();
    $('#changeFilterForm').elements.namedItem('offerId').value = 'demo-offer';
    $('#changeFilterForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    $('[data-change-reject="chg-1"]').click();
    await flush();
    $('[data-change-status="rejected"]').click();
    await flush();
    expect(document.querySelectorAll('.admin-card')).toHaveLength(1);

    // Filter audit & refresh button
    $('[data-tab="audit"]').click();
    await flush();
    $('[data-audit-type="provider"]').click();
    await flush();
    expect($('.empty-state')).not.toBeNull();
    $('#auditFilterForm').elements.namedItem('entityId').value = 'demo-offer';
    $('#auditFilterForm').dispatchEvent(new Event('submit', { bubbles: true }));
    await flush();
    $('[data-action="refresh"]').click();
    await flush();
  });
});
