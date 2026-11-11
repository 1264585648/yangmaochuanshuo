import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  STATUSES,
  SCOPES,
  planTransition,
  initialStatus,
  canEditDirectly,
  canManageProviders,
  scopeMayAttempt,
  type Action,
  type Scope,
  type Status,
} from '../../worker/src/domain/status';
import { isOfficialUrl } from '../../worker/src/domain/urls';
import { isPubliclyVisible, utcDay } from '../../worker/src/domain/visibility';

/**
 * The completion standard as a table: every scope × action × status.
 * Anything not listed here must be denied.
 */
const ALLOWED: Record<string, Status> = {
  'admin:submit:draft': 'pending_review',
  'inspector:submit:draft': 'pending_review',
  'admin:publish:pending_review': 'published',
  'admin:reject:pending_review': 'draft',
  'admin:expire:published': 'expired',
  'inspector:expire:published': 'expired',
  'admin:restore:expired': 'published',
  'admin:verify:published': 'published',
  'inspector:verify:published': 'published',
};

describe('planTransition (full matrix)', () => {
  const cases = SCOPES.flatMap((scope) =>
    ACTIONS.flatMap((action) => STATUSES.map((status) => [scope, action, status] as const)),
  );

  it.each(cases)('%s %s from %s', (scope: Scope, action: Action, status: Status) => {
    const expected = ALLOWED[`${scope}:${action}:${status}`];
    const result = planTransition(scope, action, status);
    if (expected) {
      expect(result).toEqual({ ok: true, to: expected });
    } else {
      expect(result.ok).toBe(false);
    }
  });

  it('distinguishes forbidden from invalid state', () => {
    expect(planTransition('inspector', 'publish', 'pending_review')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(planTransition('admin', 'publish', 'draft')).toEqual({
      ok: false,
      reason: 'invalid_state',
    });
  });

  it('never lets an inspector reach published from a non-published state', () => {
    for (const action of ACTIONS) {
      for (const status of STATUSES.filter((s) => s !== 'published')) {
        const r = planTransition('inspector', action, status);
        expect(r.ok && r.to === 'published').toBe(false);
      }
    }
  });
});

describe('scope rules', () => {
  it('scopeMayAttempt agrees with the transition matrix', () => {
    for (const scope of SCOPES) {
      for (const action of ACTIONS) {
        const anyAllowed = STATUSES.some((status) => ALLOWED[`${scope}:${action}:${status}`]);
        expect(scopeMayAttempt(scope, action), `${scope} ${action}`).toBe(anyAllowed);
      }
    }
  });

  it('lands inspector-created offers in review, admin ones in draft', () => {
    expect(initialStatus('inspector')).toBe('pending_review');
    expect(initialStatus('admin')).toBe('draft');
  });

  it('only admins edit content directly or manage providers', () => {
    expect(canEditDirectly('admin')).toBe(true);
    expect(canEditDirectly('inspector')).toBe(false);
    expect(canManageProviders('admin')).toBe(true);
    expect(canManageProviders('inspector')).toBe(false);
  });
});

describe('isOfficialUrl', () => {
  const domains = ['example.com', 'example.org'];

  it.each([
    'https://example.com/',
    'https://www.example.com/deal?x=1',
    'https://a.b.example.org/path',
    'https://EXAMPLE.com/',
  ])('accepts %s', (url) => {
    expect(isOfficialUrl(url, domains)).toBe(true);
  });

  it.each([
    'https://evil-example.com/',
    'https://example.com.evil.com/',
    'https://example.com@evil.com/',
    'https://evil.com/?u=example.com',
    'http://example.com/',
    'javascript:alert(1)//example.com',
    'not a url',
    'https://example.com:pass@evil.com/',
  ])('rejects %s', (url) => {
    expect(isOfficialUrl(url, domains)).toBe(false);
  });

  it('rejects everything when no domains are registered', () => {
    expect(isOfficialUrl('https://example.com/', [])).toBe(false);
  });
});

describe('visibility', () => {
  const today = '2026-11-11';
  const base = { status: 'published' as Status, validFrom: null, validUntil: null };

  it('shows published offers without dates', () => {
    expect(isPubliclyVisible(base, today)).toBe(true);
  });

  it.each(['draft', 'pending_review', 'expired'] as Status[])('hides %s', (status) => {
    expect(isPubliclyVisible({ ...base, status }, today)).toBe(false);
  });

  it('respects the validity window inclusively', () => {
    expect(isPubliclyVisible({ ...base, validUntil: today }, today)).toBe(true);
    expect(isPubliclyVisible({ ...base, validUntil: '2026-11-10' }, today)).toBe(false);
    expect(isPubliclyVisible({ ...base, validFrom: today }, today)).toBe(true);
    expect(isPubliclyVisible({ ...base, validFrom: '2026-11-12' }, today)).toBe(false);
  });

  it('utcDay uses UTC, not local time', () => {
    expect(utcDay(new Date('2026-11-11T23:30:00-05:00'))).toBe('2026-11-12');
  });
});
