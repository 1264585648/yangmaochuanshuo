export const STATUSES = ['draft', 'pending_review', 'published', 'expired'] as const;
export const SCOPES = ['admin', 'inspector'] as const;
export const ACTIONS = ['submit', 'publish', 'reject', 'expire', 'restore', 'verify'] as const;

export type Status = (typeof STATUSES)[number];
export type Scope = (typeof SCOPES)[number];
export type Action = (typeof ACTIONS)[number];

interface Transition {
  from: readonly Status[];
  to: Status;
  scopes: readonly Scope[];
}

/**
 * Inspectors (automated checkers) may only take conservative, reversible
 * actions on live content: refresh verification and mark as expired.
 */
const TRANSITIONS: Readonly<Record<Action, Transition>> = Object.freeze({
  submit: { from: ['draft'], to: 'pending_review', scopes: ['admin', 'inspector'] },
  publish: { from: ['pending_review'], to: 'published', scopes: ['admin'] },
  reject: { from: ['pending_review'], to: 'draft', scopes: ['admin'] },
  expire: { from: ['published'], to: 'expired', scopes: ['admin', 'inspector'] },
  restore: { from: ['expired'], to: 'published', scopes: ['admin'] },
  verify: { from: ['published'], to: 'published', scopes: ['admin', 'inspector'] },
});

export type TransitionResult =
  { ok: true; to: Status } | { ok: false; reason: 'forbidden' | 'invalid_state' };

export function planTransition(scope: Scope, action: Action, status: Status): TransitionResult {
  const rule = TRANSITIONS[action];
  if (!rule.scopes.includes(scope)) return { ok: false, reason: 'forbidden' };
  if (!rule.from.includes(status)) return { ok: false, reason: 'invalid_state' };
  return { ok: true, to: rule.to };
}

/** Offers created by inspectors go straight to human review. */
export function initialStatus(scope: Scope): Status {
  return scope === 'inspector' ? 'pending_review' : 'draft';
}

/** Non-admins propose edits as change requests instead of overwriting content. */
export function canEditDirectly(scope: Scope): boolean {
  return scope === 'admin';
}

/** Provider domains form the source whitelist, so only admins may change them. */
export function canManageProviders(scope: Scope): boolean {
  return scope === 'admin';
}
