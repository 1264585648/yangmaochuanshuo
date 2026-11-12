import { describe, it, expect } from 'vitest';
import { openButtonState, poolStatus } from '../../src/app/lobby.js';
import { ApiError } from '../../src/api/client.js';

const ready = { status: 'ready', offers: [], error: null, loadedAt: 0 };
const view = (patch) => ({
  remaining: 3,
  max: 3,
  opening: false,
  catalog: ready,
  poolCount: 4,
  description: '',
  ...patch,
});

describe('openButtonState', () => {
  it.each([
    ['ready', {}, '打开卡包', false],
    ['opening', { opening: true }, '开启中…', true],
    ['out of draws', { remaining: 0 }, '明日再来', true],
    ['loading', { catalog: { ...ready, status: 'loading' }, poolCount: null }, '载入卡池…', true],
    ['idle', { catalog: { ...ready, status: 'idle' }, poolCount: null }, '载入卡池…', true],
    ['error', { catalog: { ...ready, status: 'error' }, poolCount: null }, '暂不可用', true],
    ['empty pool', { poolCount: 0 }, '卡池补充中', true],
  ])('%s', (_name, patch, label, disabled) => {
    expect(openButtonState(view(patch))).toEqual({ label, disabled });
  });

  it('prefers "opening" over "out of draws" while the last draw animates', () => {
    expect(openButtonState(view({ opening: true, remaining: 0 })).label).toBe('开启中…');
  });
});

describe('poolStatus', () => {
  it('reports each catalog state', () => {
    expect(poolStatus(view({}))).toEqual({ text: '收录 4 张有效福利', tone: 'ready' });
    expect(poolStatus(view({ poolCount: 0 })).tone).toBe('empty');
    expect(poolStatus(view({ catalog: { ...ready, status: 'loading' } })).tone).toBe('loading');
    const failed = poolStatus(
      view({ catalog: { ...ready, status: 'error', error: new ApiError('network', 'x') } }),
    );
    expect(failed).toEqual({ text: expect.stringContaining('网络'), tone: 'error' });
  });
});
