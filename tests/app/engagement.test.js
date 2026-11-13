// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bindOfficialClicks,
  bindReportButtons,
  createEngagement,
  readFeedbackForm,
} from '../../src/app/engagement.js';
import { ApiError } from '../../src/api/client.js';

const form = (fields) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe('readFeedbackForm', () => {
  it('builds an offer report with an optional message', () => {
    const read = readFeedbackForm(form({ category: 'expired', message: ' ', contact: ' wx ' }), {
      id: 'a',
    });
    expect(read).toEqual({
      ok: true,
      payload: { kind: 'offer', offerId: 'a', category: 'expired', message: '', contact: 'wx' },
    });
  });

  it('requires a message for general feedback and enforces limits', () => {
    const cases = [
      { category: 'bug', message: 'x' },
      { category: 'bug', message: 'x'.repeat(1001) },
      { category: 'bug', message: '好的', contact: 'c'.repeat(101) },
      { message: '好的' },
    ];
    for (const fields of cases) expect(readFeedbackForm(form(fields), null).ok).toBe(false);
  });
});

describe('createEngagement', () => {
  let root;
  let client;
  let engagement;
  const showView = (html) => {
    root.innerHTML = html;
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.querySelector('#root');
    client = {
      sendFeedback: vi.fn(async () => ({ id: 1 })),
      getCommunity: vi.fn(async () => null),
    };
    engagement = createEngagement({ client, showView, root: () => root });
  });

  const submit = async () => {
    root.querySelector('#feedbackForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('#feedbackSubmit')?.disabled).not.toBe(true));
  };

  it('shows the offer title escaped and sends a report', async () => {
    engagement.openFeedback({ id: 'a', title: '<b>卡</b>' });
    expect(root.innerHTML).toContain('&lt;b&gt;卡&lt;/b&gt;');
    root.querySelector('textarea').value = '已结束';
    await submit();
    expect(client.sendFeedback).toHaveBeenCalledWith({
      kind: 'offer',
      offerId: 'a',
      category: 'expired',
      message: '已结束',
      contact: '',
    });
    expect(root.textContent).toContain('收到，谢谢你');
  });

  it('shows validation and server errors inline and allows a retry', async () => {
    engagement.openFeedback(null);
    await submit();
    expect(root.querySelector('#feedbackError').hidden).toBe(false);
    expect(client.sendFeedback).not.toHaveBeenCalled();

    client.sendFeedback.mockRejectedValueOnce(new ApiError('http', 'x', { code: 'rate_limited' }));
    root.querySelector('textarea').value = '希望多一些学生福利';
    await submit();
    expect(root.querySelector('#feedbackError').textContent).toContain('操作太频繁');
    expect(root.querySelector('#feedbackSubmit').disabled).toBe(false);
  });

  it('opens the community dialog only once a group is loaded', async () => {
    const onCommunity = vi.fn();
    client.getCommunity.mockResolvedValueOnce({
      title: '群',
      description: '',
      link: 'https://qm.qq.com/q/x',
      linkLabel: '',
      qr: null,
    });
    engagement = createEngagement({ client, showView, root: () => root, onCommunity });
    engagement.openCommunity();
    expect(root.innerHTML).toBe('');
    await engagement.loadCommunity();
    expect(onCommunity).toHaveBeenCalledWith(expect.objectContaining({ title: '群' }));
    engagement.openCommunity();
    expect(root.querySelector('a[href="https://qm.qq.com/q/x"]')).not.toBeNull();
  });

  it('treats a failed community load as no group', async () => {
    const onCommunity = vi.fn();
    client.getCommunity.mockRejectedValueOnce(new Error('down'));
    engagement = createEngagement({ client, showView, root: () => root, onCommunity });
    await expect(engagement.loadCommunity()).resolves.toBeNull();
    expect(onCommunity).toHaveBeenCalledWith(null);
  });
});

describe('page bindings', () => {
  it('tracks clicks and middle clicks on official links only', () => {
    document.body.innerHTML =
      '<a id="o" data-official-offer="ai-1" href="#"><span id="inner">go</span></a><a id="x" href="#">x</a>';
    const track = vi.fn();
    bindOfficialClicks(document, track);
    document.querySelector('#inner').click();
    document.querySelector('#x').click();
    const official = document.querySelector('#o');
    official.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    official.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(track.mock.calls).toEqual([['ai-1'], ['ai-1']]);
  });

  it('opens the report form from data attributes', () => {
    document.body.innerHTML =
      '<button data-report-offer="ai-1" data-report-title="标题"><span id="t">反馈</span></button>';
    const open = vi.fn();
    bindReportButtons(document, open);
    document.querySelector('#t').click();
    expect(open).toHaveBeenCalledWith({ id: 'ai-1', title: '标题' });
  });
});
