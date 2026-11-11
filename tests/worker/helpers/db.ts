import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';

// Tests are not type-checked by tsc; D1Database comes from the generated worker types.
type D1Database = Env['DB'];

export interface TestDb {
  db: D1Database;
  dispose: () => Promise<void>;
}

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

/** Split a migration file into statements, keeping trigger bodies intact. */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql.replace(/--.*$/gm, '');
  const statements: string[] = [];
  let current = '';
  let depth = 0;
  for (const token of withoutComments.split(/(;|\bBEGIN\b|\bEND\b)/i)) {
    current += token;
    if (/^BEGIN$/i.test(token)) depth++;
    else if (/^END$/i.test(token)) depth--;
    else if (token === ';' && depth === 0) {
      if (current.trim() !== ';') statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function applyMigrations(db: D1Database): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    await db.batch(splitStatements(sql).map((s) => db.prepare(s)));
  }
}

/** Fresh in-memory local D1 with all migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve(process.cwd(), 'wrangler.jsonc'),
    persist: false,
  });
  await applyMigrations(env.DB);
  return { db: env.DB, dispose };
}
