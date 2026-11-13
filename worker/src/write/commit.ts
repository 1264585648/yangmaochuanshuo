import type { Client } from '../auth/tokens';
import { fail, sendJson } from '../http/respond';
import {
  checkIdempotency,
  purgeStatement,
  recordStatement,
  type IdempotencyRef,
} from './idempotency';

type DB = Env['DB'];
type Statement = ReturnType<DB['prepare']>;

export interface AuditEntry {
  action: string;
  entityType: 'offer' | 'provider' | 'change' | 'feedback' | 'setting' | 'prize';
  entityId: string;
  before: unknown;
  after: unknown;
  sourceUrl?: string | null;
}

export interface WriteStep {
  statement: Statement;
  /** Abort the whole batch unless this statement changed exactly one row. */
  guarded?: boolean;
}

export interface WritePlan {
  kind: 'write';
  steps: WriteStep[];
  audit: AuditEntry;
  status: number;
  data: unknown;
  /**
   * Response when a guarded step misses. A function can re-read state to
   * explain which precondition failed.
   */
  conflict?: { code: string; message: string } | (() => Promise<Response>);
}

export interface WriteContext {
  db: DB;
  client: Client;
  now: Date;
  idempotency: IdempotencyRef;
}

export const plan = (p: Omit<WritePlan, 'kind'>): WritePlan => ({ kind: 'write', ...p });

const GENERIC_CONFLICT = { code: 'conflict', message: 'The resource changed; reload and retry' };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function auditStatement(db: DB, client: Client, audit: AuditEntry, at: string): Statement {
  return db
    .prepare(
      `INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after, source_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      client.id,
      audit.action,
      audit.entityType,
      audit.entityId,
      audit.before === null ? null : JSON.stringify(audit.before),
      audit.after === null ? null : JSON.stringify(audit.after),
      audit.sourceUrl ?? null,
      at,
    );
}

function buildBatch(ctx: WriteContext, p: WritePlan, body: string): Statement[] {
  const { db, client, now, idempotency } = ctx;
  const at = now.toISOString();
  const guard = db.prepare('INSERT INTO write_guard (expected) VALUES (changes())');
  const steps = p.steps.flatMap((s) => (s.guarded ? [s.statement, guard] : [s.statement]));
  return [
    ...steps,
    auditStatement(db, client, p.audit, at),
    purgeStatement(db, client.id, now),
    recordStatement(db, client.id, idempotency, p.status, body, at),
  ];
}

async function explainFailure(ctx: WriteContext, p: WritePlan, error: unknown): Promise<Response> {
  // A concurrent request with the same key may have won; its result is the answer.
  const replay = await checkIdempotency(ctx.db, ctx.client.id, ctx.idempotency, ctx.now);
  if (replay) return replay;

  const message = errorText(error);
  if (message.includes('write_conflict')) {
    const conflict = p.conflict ?? GENERIC_CONFLICT;
    return typeof conflict === 'function' ? conflict() : fail(409, conflict.code, conflict.message);
  }
  if (/UNIQUE constraint failed|PRIMARY KEY/i.test(message)) {
    return fail(409, 'already_exists', 'A resource with this id already exists');
  }
  throw error;
}

/**
 * Run the plan's statements, its audit row and the idempotency record in one
 * D1 batch (a single transaction): all of them persist or none do.
 */
export async function commit(ctx: WriteContext, p: WritePlan): Promise<Response> {
  const body = JSON.stringify({ success: true, data: p.data, error: null });
  try {
    await ctx.db.batch(buildBatch(ctx, p, body));
  } catch (error: unknown) {
    return explainFailure(ctx, p, error);
  }
  return sendJson(p.status, body, { 'cache-control': 'no-store' });
}
