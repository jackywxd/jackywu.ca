#!/usr/bin/env node
/** IaC 的靜態檢查：對真實的檔案跑 packages/infra/infra-check.ts 的每一條規則。不連任何服務。 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  checkContentSourceUnmanaged, checkDnsOwnership, checkProtected, checkStagingIsolation, checkWorkers, checkWorkflowSecrets,
  envReads, secretKeys, workerEnvs,
} from '../../packages/infra/infra-check.ts';

const ts = createRequire(import.meta.url)('typescript');
const jsonc = (f) => ts.parseConfigFileTextToJson(f, readFileSync(f, 'utf8')).config;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const readAll = (files) => files.map((f) => readFileSync(f, 'utf8')).join('\n');

const matrix = Object.fromEntries(Object.entries(JSON.parse(readFileSync('infra/worker-secrets.json', 'utf8'))).filter(([k]) => !k.startsWith('$')));

// 不需要由 IaC 提供的 env：每一項都寫原因
const ALLOW = {
  ADMIN_DEV_BYPASS_EMAIL: '只在 localhost 有效，其他主機設了會直接 throw',
  ADMIN_PERSIST_DIR: '本機與測試的 miniflare 資料夾',
  CLOUDFLARE_ENV: 'OpenNext／wrangler 建置時決定是哪個 env',
  GITHUB_API_BASE: '只給本機 E2E 的假 GitHub；正式環境固定 api.github.com',
  GITHUB_REPO: '有預設值 jackywxd/jackywu.ca',
  VITEST: '測試執行器自己設',
  NODE_ENV: '執行環境自己設',
};

// 只有某個 Worker 可以沒有的：staging 沒有發佈流程，這幾個缺了會安全地失敗
const ALLOW_FOR = {
  'hongchen-admin-staging': {
    PUBLISH_HMAC_SECRET: '沒設時回呼的 verify 一律拒絕（admin/src/lib/hmac.ts）',
    GITHUB_APP_ID: '沒設時 publish-deps 的 need() 丟錯，發佈顯示錯誤而不是靜默',
    GITHUB_APP_INSTALLATION_ID: '同上',
    GITHUB_APP_PRIVATE_KEY: '同上',
  },
};

const adminSrc = walk('admin/src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const adminReads = envReads(readAll(adminSrc));
const cronReads = envReads(readFileSync('admin/cron/index.ts', 'utf8'));

const admin = jsonc('admin/wrangler.jsonc'), cron = jsonc('admin/cron/wrangler.jsonc'), site = jsonc('wrangler.jsonc');
const envs = [...workerEnvs(admin), ...workerEnvs(cron)];
const reads = new Map(envs.map((e) => [e.worker, e.worker.includes('-cron') ? cronReads : adminReads]));

const tfFiles = Object.fromEntries(['infra/bootstrap', 'infra/live'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.tf')).map((f) => [join(d, f), readFileSync(join(d, f), 'utf8')])));

const routeHosts = (c) => [...(c.routes ?? []), ...Object.values(c.env ?? {}).flatMap((e) => e.routes ?? [])].map((r) => r.pattern).filter(Boolean);
const autoHosts = [...routeHosts(site), ...routeHosts(admin), 'media.jackywu.ca'];

const used = new Set(walk('.github/workflows').filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/secrets\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1])));
const producers = { bootstrap: secretKeys(readFileSync('infra/bootstrap/github.tf', 'utf8')), live: secretKeys(readFileSync('infra/live/github.tf', 'utf8')) };
const MANUAL = {
  CLOUDFLARE_ACCOUNT_ID: '帳號 id，不是秘密，也不會變',
  CLOUDFLARE_API_TOKEN: 'repo 層級的部署 token（前台 deploy、admin-deploy、backup）；infra 的兩個 environment 另有自己的同名 secret',
  GITHUB_TOKEN: 'Actions 自動提供',
};

const problems = [
  ...checkWorkers(envs, reads, matrix, ALLOW, ALLOW_FOR),
  ...checkStagingIsolation(matrix),
  ...checkProtected(tfFiles),
  ...checkContentSourceUnmanaged(tfFiles),
  ...checkDnsOwnership(tfFiles, autoHosts),
  ...checkWorkflowSecrets(used, producers, MANUAL),
];
if (problems.length) { console.error(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }
console.log(`✓ infra 檢查通過（${envs.length} 個 Worker、${Object.keys(tfFiles).length} 個 .tf、${used.size} 個 workflow secret）`);
