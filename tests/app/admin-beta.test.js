// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  buildCommunityBody,
  fromLocalInput,
  handleBetaClick,
  isBetaButton,
  loadBetaTab,
  renderBetaTab,
  toLocalInput,
} from '../../src/app/admin-beta.js';

const NOW = new Date('2026-11-12T00:00:00Z');

const feedbackItem = (overrides = {}) => ({
  id: 3,
  kind: 'offer',
  offer: { id: 'ai-1', title: '<img src=x onerror=alert(1)>' },
  category: 'expired',
  message: '<script>x</script>',
  contact: 'wx<b>',
  status: 'open',
  note: '',
  createdAt: '2026-11-12T03:04:05Z',
  updatedAt: '2026-11-12T03:04:05Z',
  ...overrides,
});

describe('renderBetaTab', () => {
  it('escapes everything a visitor typed', () => {
    const html = renderBetaTab({
      tab: 'feedback',
      feedbackStatus: 'open',
      feedback: [feedbackItem()],
      feedbackTotal: 1,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('wx&lt;b&gt;');
    expect(html).toContain('data-feedback-action="resolve"');
  });

  it('offers reopen for handled feedback', () => {
    const html = renderBetaTab({
      tab: 'feedback',
      feedbackStatus: '',
      feedback: [feedbackItem({ status: 'resolved', note: '已处理' })],
      feedbackTotal: 1,
    });
    expect(html).toContain('data-feedback-action="reopen"');
    expect(html).toContain('处理备注：已处理');
  });

  it('renders stats with bars and the top table', () => {
    const html = renderBetaTab({
      tab: 'stats',
      statsDays: 7,
      stats: {
        since: '2026-11-06',
        daily: [{ day: '2026-11-12', visitors: 4 }],
        totals: { visitors: 9, recentVisitors: 4, clicks: 12, recentClicks: 5 },
        topOffers: [
          {
            id: 'a',
            title: '<i>A</i>',
            pool: 'ai',
            status: 'published',
            visitors: 3,
            recentVisitors: 2,
          },
        ],
      },
    });
    expect(html).toContain('<meter min="0" max="4" value="4">');
    expect(html).toContain('&lt;i&gt;A&lt;/i&gt;');
    expect(html).toContain('<td>AI 福利</td>');
  });

  it('warns when the QR is about to expire or has expired', () => {
    const base = { enabled: true, title: 't', description: '', link: null, linkLabel: '' };
    const qr = { sha256: 'x', contentType: 'image/png' };
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const warn = renderBetaTab({ tab: 'community', community: { ...base, qr, qrExpiresAt: soon } });
    expect(warn).toContain('24 小时内过期');
    const past = new Date(Date.now() - 1000).toISOString();
    const expired = renderBetaTab({
      tab: 'community',
      community: { ...base, qr, qrExpiresAt: past },
    });
    expect(expired).toContain('已过期');
    expect(expired).not.toContain('admin-qr-preview');
  });
});

describe('datetime helpers', () => {
  it('round-trips through the local input format', () => {
    const iso = '2026-11-18T08:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('nonsense')).toBeNull();
  });
});

describe('buildCommunityBody', () => {
  const fields = (extra = {}) => {
    const data = new FormData();
    data.set('enabled', 'on');
    data.set('title', ' 内测群 ');
    data.set('description', '');
    data.set('link', '');
    data.set('linkLabel', '');
    data.set('qrExpiresAt', '');
    for (const [k, v] of Object.entries(extra)) data.set(k, v);
    return data;
  };

  it('keeps the current image when no file is chosen', async () => {
    expect(await buildCommunityBody(fields(), NOW)).toEqual({
      enabled: true,
      title: '内测群',
      description: '',
      link: null,
      linkLabel: '',
      qrExpiresAt: null,
    });
  });

  it('removes the image on request', async () => {
    expect((await buildCommunityBody(fields({ removeQr: 'on' }), NOW)).qr).toBeNull();
  });

  it('uploads a small image as base64 and defaults the expiry to 7 days', async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'qr.png', {
      type: 'image/png',
    });
    const body = await buildCommunityBody(fields({ qrFile: png }), NOW);
    expect(body.qr).toEqual({ base64: 'iVBORw==' });
    expect(body.qrExpiresAt).toBe('2026-11-19T00:00:00.000Z');
  });

  it('refuses other file types', async () => {
    const svg = new File(['<svg/>'], 'qr.svg', { type: 'image/svg+xml' });
    await expect(buildCommunityBody(fields({ qrFile: svg }), NOW)).rejects.toThrow('PNG');
  });

  describe('large images', () => {
    const big = () => new File([new Uint8Array(600 * 1024)], 'qr.png', { type: 'image/png' });
    /** Stub the canvas pipeline; `sizes` maps output type to blob size. */
    const stubCanvas = (sizes) => {
      const types = [];
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width: 1440, height: 960, close: vi.fn() })),
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb, type) {
        types.push({ type, width: this.width, height: this.height });
        cb(new Blob([new Uint8Array(sizes[type])], { type }));
      });
      return types;
    };
    const restore = () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    };

    it('downscales to 720px and keeps PNG when it fits', async () => {
      const calls = stubCanvas({ 'image/png': 100 * 1024 });
      try {
        const body = await buildCommunityBody(fields({ qrFile: big() }), NOW);
        expect(calls).toEqual([{ type: 'image/png', width: 720, height: 480 }]);
        expect(body.qr.base64.length).toBeGreaterThan(0);
      } finally {
        restore();
      }
    });

    it('falls back to JPEG when the downscaled PNG is still too large', async () => {
      const calls = stubCanvas({ 'image/png': 640 * 1024, 'image/jpeg': 70 * 1024 });
      try {
        const body = await buildCommunityBody(fields({ qrFile: big() }), NOW);
        expect(calls.map((c) => c.type)).toEqual(['image/png', 'image/jpeg']);
        expect(atob(body.qr.base64).length).toBe(70 * 1024);
      } finally {
        restore();
      }
    });

    it('rejects when even the JPEG is too large', async () => {
      stubCanvas({ 'image/png': 640 * 1024, 'image/jpeg': 500 * 1024 });
      try {
        await expect(buildCommunityBody(fields({ qrFile: big() }), NOW)).rejects.toThrow(
          '图片太大',
        );
      } finally {
        restore();
      }
    });
  });
});

describe('loadBetaTab and handleBetaClick', () => {
  const client = {
    listFeedback: vi.fn(async () => ({ data: [feedbackItem()], meta: { total: 1 } })),
    getClickStats: vi.fn(async () => ({ daily: [] })),
    getCommunity: vi.fn(async () => null),
    transitionFeedback: vi.fn(async () => ({})),
  };

  it('loads each tab from its endpoint', async () => {
    expect(await loadBetaTab(client, { tab: 'feedback', feedbackStatus: 'open' })).toEqual({
      feedback: [feedbackItem()],
      feedbackTotal: 1,
    });
    await loadBetaTab(client, { tab: 'stats', statsDays: 30 });
    expect(client.getClickStats).toHaveBeenCalledWith(30);
    expect(await loadBetaTab(client, { tab: 'community' })).toEqual({ community: null });
    expect(await loadBetaTab(client, { tab: 'offers' })).toEqual({});
  });

  it('resolves with a note, and does nothing when the prompt is cancelled', async () => {
    const button = document.createElement('button');
    button.dataset.feedbackAction = 'resolve';
    button.dataset.feedbackId = '3';
    expect(isBetaButton(button)).toBe(true);
    expect(isBetaButton(document.createElement('button'))).toBe(false);
    const ctx = {
      state: {},
      client,
      refresh: vi.fn(async () => {}),
      showToast: vi.fn(),
      handleError: vi.fn(),
      render: vi.fn(),
    };
    globalThis.prompt = vi.fn(() => '已下架');
    await handleBetaClick(button, ctx);
    expect(client.transitionFeedback).toHaveBeenCalledWith('3', 'resolve', { note: '已下架' });
    globalThis.prompt = vi.fn(() => null);
    client.transitionFeedback.mockClear();
    await handleBetaClick(button, ctx);
    expect(client.transitionFeedback).not.toHaveBeenCalled();
  });
});
