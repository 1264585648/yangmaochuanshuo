#!/usr/bin/env node
/**
 * Issue, list and revoke write-API tokens.
 *
 *   node scripts/manage-token.mjs issue --name "AI inspector" --scope inspector [--remote]
 *   node scripts/manage-token.mjs list [--remote]
 *   node scripts/manage-token.mjs revoke --id ai-inspector-1a2b [--remote]
 *
 * The raw token is printed once and never stored; D1 keeps only its SHA-256.
 * Without --remote the local development database is used.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATABASE = 'dealdex';
const SCOPES = ['admin', 'inspector'];
const NAME_PATTERN = /^[A-Za-z0-9 ._-]{1,60}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const generateToken = () => `ddx_${randomBytes(32).toString('base64url')}`;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function clientIdFor(name, suffix = randomBytes(2).toString('hex')) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'client'}-${suffix}`;
}

/** Inputs are validated against strict patterns; quotes are still escaped. */
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { remote: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--remote') options.remote = true;
    else if (arg === '--name' || arg === '--scope' || arg === '--id') {
      const value = rest[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, options };
}

export function buildIssue({ name, scope }, now = new Date(), token = generateToken()) {
  if (!name || !NAME_PATTERN.test(name)) {
    throw new Error('--name must be 1-60 letters, digits, spaces, . _ -');
  }
  if (!SCOPES.includes(scope)) throw new Error(`--scope must be one of: ${SCOPES.join(', ')}`);
  const id = clientIdFor(name);
  const statement =
    'INSERT INTO api_clients (id, name, token_hash, scope, created_at) VALUES ' +
    `(${sql(id)}, ${sql(name)}, ${sql(hashToken(token))}, ${sql(scope)}, ${sql(now.toISOString())});`;
  return { id, token, statement };
}

export function buildRevoke({ id }, now = new Date()) {
  if (!id || !ID_PATTERN.test(id)) throw new Error('--id must be a client id from `list`');
  return `UPDATE api_clients SET revoked_at = ${sql(now.toISOString())} WHERE id = ${sql(id)} AND revoked_at IS NULL;`;
}

export const LIST_STATEMENT =
  'SELECT id, name, scope, created_at, revoked_at FROM api_clients ORDER BY created_at;';

function runD1(statement, remote) {
  const require = createRequire(import.meta.url);
  const wranglerBin = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  const args = [
    wranglerBin,
    'd1',
    'execute',
    DATABASE,
    remote ? '--remote' : '--local',
    '--command',
    statement,
  ];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`wrangler exited with status ${result.status}`);
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'issue') {
    const { id, token, statement } = buildIssue(options);
    runD1(statement, options.remote);
    console.log(`\nIssued ${options.scope} token for client "${id}".`);
    console.log('Store it in a secret manager now; it cannot be shown again:\n');
    console.log(token);
  } else if (command === 'revoke') {
    runD1(buildRevoke(options), options.remote);
  } else if (command === 'list') {
    runD1(LIST_STATEMENT, options.remote);
  } else {
    throw new Error('Usage: manage-token.mjs <issue|list|revoke> [options]');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
