#!/usr/bin/env node
/* Fill the LOCAL D1 database with clearly fictional offers so the UI can be
   developed against the real API. Uses reserved example.* domains (RFC 2606)
   and marks every title 「示例」. Refuses to touch a remote database. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

if (process.argv.includes('--remote')) {
  console.error('seed-local only seeds the local database. Real offers go through the manage API.');
  process.exit(1);
}

const TS = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

const PROVIDERS = [
  ['sample-cloud', '示例云', 'example.com'],
  ['sample-ai', '示例智能', 'example.org'],
  ['sample-soft', '示例软件', 'example.net'],
  ['sample-edu', '示例学院', 'example.edu'],
];

/** [id, provider, pool, rarity, title, benefit, flags, regions, verifiedDaysAgo, validUntil] */
const OFFERS = [
  [
    'demo-cloud-vps',
    'sample-cloud',
    'cloud',
    'A',
    '入门 VPS 首月折扣',
    '首月 5 折',
    'n',
    [],
    2,
    null,
  ],
  [
    'demo-cloud-credit',
    'sample-cloud',
    'cloud',
    'S',
    '云平台开发者赠金',
    '注册得 100 美元额度，90 天有效',
    'np',
    [],
    6,
    '2027-03-31',
  ],
  [
    'demo-cloud-gpu',
    'sample-cloud',
    'cloud',
    'SSR',
    'GPU 算力体验额度',
    '20 小时 GPU 实例',
    'np',
    ['US', 'JP', 'SG', 'DE'],
    1,
    null,
  ],
  [
    'demo-cloud-object',
    'sample-cloud',
    'cloud',
    'A',
    '对象存储免费层',
    '每月 5 GB 存储',
    '',
    [],
    30,
    null,
  ],
  ['demo-ai-chat', 'sample-ai', 'ai', 'A', '对话模型免费额度', '每日 50 次对话', '', [], 0, null],
  ['demo-ai-api', 'sample-ai', 'ai', 'S', 'API 新用户试用金', '5 美元 API 额度', 'np', [], 3, null],
  [
    'demo-ai-code',
    'sample-ai',
    'ai',
    'SSR',
    '编程助手专业版试用',
    '30 天专业版',
    'r',
    [],
    9,
    '2026-12-31',
  ],
  ['demo-ai-image', 'sample-ai', 'ai', 'A', '图像生成积分', '注册送 100 积分', 'n', [], null, null],
  [
    'demo-soft-ide',
    'sample-soft',
    'software',
    'S',
    'IDE 专业版开源授权',
    '开源维护者免费授权一年',
    '',
    [],
    12,
    null,
  ],
  [
    'demo-soft-design',
    'sample-soft',
    'software',
    'A',
    '设计工具团队试用',
    '14 天团队版',
    'pr',
    [],
    4,
    null,
  ],
  [
    'demo-soft-notes',
    'sample-soft',
    'software',
    'A',
    '笔记应用年费优惠',
    '首年 7 折',
    'r',
    ['CN'],
    20,
    null,
  ],
  [
    'demo-edu-pack',
    'sample-edu',
    'education',
    'S',
    '学生开发者礼包',
    '多款开发工具学生授权',
    's',
    [],
    5,
    null,
  ],
  [
    'demo-edu-course',
    'sample-edu',
    'education',
    'A',
    '在线课程免费旁听',
    '全部公开课免费旁听',
    '',
    [],
    1,
    null,
  ],
];

const q = (v) => (v === null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);
const flag = (flags, f) => (flags.includes(f) ? 1 : 0);

const sql = [
  ...PROVIDERS.map(
    ([id, name, domain]) =>
      `INSERT OR REPLACE INTO providers (id, name, official_domains, created_at, updated_at) VALUES (${q(id)}, ${q(name)}, ${q(JSON.stringify([domain]))}, ${q(TS)}, ${q(TS)});`,
  ),
  ...OFFERS.map(([id, provider, pool, rarity, title, benefit, flags, regions, verified, until]) => {
    const domain = PROVIDERS.find((p) => p[0] === provider)[2];
    return `INSERT OR REPLACE INTO offers (id, provider_id, pool, rarity, title, summary, benefit, official_url, source_url, new_users_only, student_only, requires_payment_method, auto_renews, regions, conditions_note, status, valid_from, valid_until, last_verified_at, created_by, created_at, updated_at) VALUES (${q(id)}, ${q(provider)}, ${q(pool)}, ${q(rarity)}, ${q(`【示例】${title}`)}, ${q('本地开发用的虚构福利，不对应任何真实活动。')}, ${q(benefit)}, ${q(`https://www.${domain}/offers/${id}`)}, ${q(`https://docs.${domain}/terms/${id}`)}, ${flag(flags, 'n')}, ${flag(flags, 's')}, ${flag(flags, 'p')}, ${flag(flags, 'r')}, ${q(JSON.stringify(regions))}, ${q(flags.includes('p') ? '验证付款方式时可能产生小额预授权。' : '')}, 'published', NULL, ${q(until)}, ${verified === null ? 'NULL' : q(daysAgo(verified))}, 'local-seed', ${q(TS)}, ${q(TS)});`;
  }),
].join('\n');

const dir = mkdtempSync(join(tmpdir(), 'dealdex-seed-'));
const file = join(dir, 'seed.sql');
writeFileSync(file, sql);
// Run wrangler's JS entry with this Node, avoiding a shell and its quoting rules.
const wranglerPkg = createRequire(import.meta.url).resolve('wrangler/package.json');
const wrangler = resolve(dirname(wranglerPkg), 'bin/wrangler.js');
const run = (args) => execFileSync(process.execPath, [wrangler, ...args], { stdio: 'inherit' });
try {
  run(['d1', 'migrations', 'apply', 'dealdex', '--local']);
  run(['d1', 'execute', 'dealdex', '--local', `--file=${file}`]);
  console.log(`Seeded ${PROVIDERS.length} providers and ${OFFERS.length} example offers locally.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
