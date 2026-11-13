#!/usr/bin/env node
/* Start the Worker for end-to-end tests: build the front end, reset a separate
   local D1 (so per-IP rate limits never carry over between runs), seed the
   fictional example offers and serve on E2E_PORT. Used by playwright.config.js. */
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const PORT = process.env.E2E_PORT ?? '8790';
const STATE = resolve('.wrangler/e2e-state');
// Test-only key for hashing client IPs; production uses a Worker secret.
const IP_HASH_SECRET = 'e2e-only-ip-hash-secret-0123456789abcdef';

const wrangler = resolve(
  dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin/wrangler.js',
);
const vite = resolve(
  dirname(createRequire(import.meta.url).resolve('vite/package.json')),
  'bin/vite.js',
);
const node = (args) => execFileSync(process.execPath, args, { stdio: 'inherit' });

rmSync(STATE, { recursive: true, force: true });
node([vite, 'build', '--logLevel', 'warn']);
node(['scripts/seed-local.mjs', '--persist-to', STATE]);

const server = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--port',
    PORT,
    '--ip',
    '127.0.0.1',
    // HTTPS like production: WebKit stores but never sends Secure cookies over plain http.
    '--local-protocol',
    'https',
    '--persist-to',
    STATE,
    '--var',
    `IP_HASH_SECRET:${IP_HASH_SECRET}`,
    '--show-interactive-dev-session=false',
  ],
  { stdio: ['ignore', 'inherit', 'pipe'] },
);
// Browsers probe the self-signed certificate before Playwright's ignoreHTTPSErrors
// applies; wrangler logs each rejected handshake. Drop that noise, keep the rest.
server.stderr.on('data', (chunk) => {
  const text = String(chunk)
    .split('\n')
    .filter((line) => !line.includes('TLS handshake failed'))
    .join('\n');
  if (text.trim()) process.stderr.write(text);
});
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
