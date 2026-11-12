import { describe, it, expect, vi } from 'vitest';
import { createDrawFlow } from '../../src/app/draw-flow.js';
import { ApiError } from '../../src/api/client.js';

const QUOTA = { max: 3, used: 3, day: '2026-11-12', resetsAt: '2026-11-12T16:00:00.000Z' };
const done = Promise.resolve();

function flow(results) {
  let n = 0;
  const draw = vi.fn(async () => {
    const next = results[n++];
    if (next instanceof Error) throw next;
    return next;
  });
  let k = 0;
  return { draw, flow: createDrawFlow({ draw, makeKey: () => `key-${++k}` }) };
}

describe('createDrawFlow', () => {
  it('returns the drawn card', async () => {
    const result = { draw: { id: 'd_1' } };
    const { flow: f } = flow([result]);
    expect(await f.open('ai', done)).toEqual({ kind: 'drawn', result });
  });

  it('reuses the key after an unknown outcome and drops it after an answer', async () => {
    const { draw, flow: f } = flow([new ApiError('timeout', 'x'), { draw: {} }, { draw: {} }]);
    const failed = await f.open('ai', done);
    expect(failed).toMatchObject({ kind: 'failed', unknownOutcome: true });
    await f.open('ai', done);
    await f.open('ai', done);
    expect(draw.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1', 'key-2']);
  });

  it('keeps an unknown outcome per pool, so switching pools cannot lose it', async () => {
    const { draw, flow: f } = flow([new ApiError('network', 'x'), { draw: {} }, { draw: {} }]);
    await f.open('ai', done);
    await f.open('cloud', done);
    await f.open('ai', done);
    expect(draw.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['ai', 'key-1'],
      ['cloud', 'key-2'],
      ['ai', 'key-1'],
    ]);
  });

  it('maps empty pools and spent quotas', async () => {
    const { flow: f } = flow([
      new ApiError('http', 'x', { status: 409, code: 'pool_empty' }),
      new ApiError('http', 'x', { status: 429, code: 'quota_exhausted', details: QUOTA }),
      new ApiError('http', 'x', { status: 429, code: 'quota_exhausted', details: 'junk' }),
      new ApiError('http', 'x', { status: 400, code: 'invalid_body' }),
    ]);
    expect(await f.open('ai', done)).toEqual({ kind: 'empty' });
    expect(await f.open('ai', done)).toMatchObject({ kind: 'exhausted', quota: { used: 3 } });
    expect(await f.open('ai', done)).toEqual({ kind: 'exhausted', quota: null });
    expect(await f.open('ai', done)).toMatchObject({ kind: 'failed', unknownOutcome: false });
  });

  it('waits for the animation as well as the draw', async () => {
    let finish;
    const animation = new Promise((resolve) => (finish = resolve));
    const { flow: f } = flow([{ draw: {} }]);
    let settled = false;
    const pending = f.open('ai', animation).then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await pending;
    expect(settled).toBe(true);
  });
});
