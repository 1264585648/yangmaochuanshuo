import { describe, it, expect } from 'vitest';
import { attemptFor, isSettled } from '../../src/domain/draw-attempt.js';
import { ApiError } from '../../src/api/client.js';

let seq = 0;
const makeKey = () => `key-${++seq}`;

describe('attemptFor', () => {
  it('starts a fresh attempt when none is pending', () => {
    expect(attemptFor(null, 'ai', makeKey)).toEqual({ pool: 'ai', key: 'key-1' });
  });

  it('reuses a pending attempt for the same pool', () => {
    const pending = { pool: 'ai', key: 'kept' };
    expect(attemptFor(pending, 'ai', makeKey)).toBe(pending);
  });

  it('starts over when the pool changed', () => {
    expect(attemptFor({ pool: 'ai', key: 'kept' }, 'cloud', makeKey).key).not.toBe('kept');
  });
});

describe('isSettled', () => {
  it('treats success and client errors as settled', () => {
    expect(isSettled(null)).toBe(true);
    for (const status of [400, 409, 422, 429]) {
      expect(isSettled(new ApiError('http', 'x', { status }))).toBe(true);
    }
  });

  it('keeps the attempt when the outcome is unknown', () => {
    expect(isSettled(new ApiError('network', 'x'))).toBe(false);
    expect(isSettled(new ApiError('timeout', 'x'))).toBe(false);
    expect(isSettled(new ApiError('http', 'x', { status: 503 }))).toBe(false);
    expect(isSettled(new ApiError('invalid', 'x', { status: 201 }))).toBe(false);
    expect(isSettled(new Error('boom'))).toBe(false);
  });
});
