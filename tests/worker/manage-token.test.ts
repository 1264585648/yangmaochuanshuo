import { describe, it, expect } from 'vitest';
import {
  buildIssue,
  buildRevoke,
  clientIdFor,
  generateToken,
  hashToken,
  parseArgs,
} from '../../scripts/manage-token.mjs';
import { hashToken as workerHash } from '../../worker/src/auth/tokens';

const NOW = new Date('2026-11-11T12:00:00Z');

describe('manage-token script', () => {
  it('generates tokens in the same format as the worker', () => {
    expect(generateToken()).toMatch(/^ddx_[A-Za-z0-9_-]{43}$/);
  });

  it('hashes exactly like the worker', async () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(await workerHash(token));
  });

  it('derives slug ids from names', () => {
    expect(clientIdFor('AI Inspector v2', 'ab12')).toBe('ai-inspector-v2-ab12');
    expect(clientIdFor('---', 'ab12')).toBe('client-ab12');
  });

  it('builds an insert storing only the hash', () => {
    const { id, token, statement } = buildIssue({ name: 'AI inspector', scope: 'inspector' }, NOW);
    expect(id).toMatch(/^ai-inspector-[0-9a-f]{4}$/);
    expect(statement).toContain(hashToken(token));
    expect(statement).not.toContain(token);
    expect(statement).toContain("'inspector'");
  });

  it.each([
    [{ name: "x'; DROP TABLE offers; --", scope: 'admin' }],
    [{ name: '', scope: 'admin' }],
    [{ name: 'ok', scope: 'root' }],
  ])('rejects unsafe or invalid input %j', (opts) => {
    expect(() => buildIssue(opts, NOW)).toThrow();
  });

  it('builds a revoke that only touches active tokens', () => {
    expect(buildRevoke({ id: 'ai-inspector-ab12' }, NOW)).toBe(
      "UPDATE api_clients SET revoked_at = '2026-11-11T12:00:00.000Z' WHERE id = 'ai-inspector-ab12' AND revoked_at IS NULL;",
    );
    expect(() => buildRevoke({ id: "x' OR 1=1 --" }, NOW)).toThrow();
  });

  it('parses arguments strictly', () => {
    expect(parseArgs(['issue', '--name', 'n', '--scope', 'admin', '--remote'])).toEqual({
      command: 'issue',
      options: { name: 'n', scope: 'admin', remote: true },
    });
    expect(() => parseArgs(['issue', '--name'])).toThrow();
    expect(() => parseArgs(['issue', '--bogus'])).toThrow();
  });
});
