import { describe, expect, it } from 'vitest';
import {
  checkContentSourceUnmanaged, checkDnsOwnership, checkProtected, checkStagingIsolation, checkWorkers, checkWorkflowSecrets,
  envReads, resourceBlocks, secretKeys, workerEnvs,
} from './infra-check';

describe('envReads', () => {
  it('三種讀法都抓到', () => {
    const src = `const a = process.env.PAYLOAD_SECRET; env.ACCESS_AUD; process.env['X_Y']; need('GITHUB_APP_ID'); env.lowercase; myenv.NOPE`;
    expect([...envReads(src)].sort()).toEqual(['ACCESS_AUD', 'GITHUB_APP_ID', 'PAYLOAD_SECRET', 'X_Y']);
  });
});

describe('checkWorkers', () => {
  const cfg = {
    name: 'w', vars: { ADMIN_URL: 'x' }, secrets: { required: ['A', 'B'] }, services: [{ binding: 'MAILER' }],
    env: { staging: { name: 'w-staging', vars: { ADMIN_URL: 'y' }, secrets: { required: ['A'] } }, e2e: { name: 'w-e2e' } },
  };
  const matrix = { w: ['A', 'B'], 'w-staging': ['A'] };
  const reads = new Map([['w', new Set(['A', 'B', 'ADMIN_URL', 'MAILER', 'VITEST'])], ['w-staging', new Set(['A'])]]);
  const allow = { VITEST: '測試' };

  it('一致 → 沒有問題（e2e env 不算）', () => expect(checkWorkers(workerEnvs(cfg), reads, matrix, allow)).toEqual([]));
  it('env 不繼承頂層：staging 少了 secrets.required → 擋下', () => {
    const c = structuredClone(cfg); delete (c.env.staging as { secrets?: unknown }).secrets;
    expect(checkWorkers(workerEnvs(c), reads, matrix, allow).join()).toMatch(/w-staging.*不一致/);
  });
  it('同一個名稱同時是 var 與 secret → 擋下', () => {
    const c = structuredClone(cfg); (c.vars as Record<string, string>).A = '';
    expect(checkWorkers(workerEnvs(c), reads, matrix, allow).join()).toMatch(/A 同時是 var 與 secret/);
  });
  it('程式讀了沒人設的 env → 擋下並指出名稱', () => {
    const r = new Map(reads); r.set('w', new Set([...reads.get('w')!, 'NEW_SECRET']));
    expect(checkWorkers(workerEnvs(cfg), r, matrix, allow).join()).toMatch(/NEW_SECRET/);
  });
  it('對照表有、但沒有 wrangler 部署的 Worker → 擋下', () =>
    expect(checkWorkers(workerEnvs(cfg), reads, { ...matrix, ghost: ['A'] }, allow).join()).toMatch(/ghost/));
});

it('checkStagingIsolation：staging 拿到發佈金鑰 → 擋下', () => {
  expect(checkStagingIsolation({ 'a-staging': ['PAYLOAD_SECRET'], a: ['PUBLISH_HMAC_SECRET'] })).toEqual([]);
  expect(checkStagingIsolation({ 'a-staging': ['GITHUB_APP_PRIVATE_KEY'] })).toHaveLength(1);
});

describe('HCL', () => {
  const tf = `
resource "cloudflare_d1_database" "ok" {
  name = "x"
  lifecycle {
    prevent_destroy = true
  }
}
resource "cloudflare_r2_bucket" "bad" {
  name = "y"
  # prevent_destroy = true（註解不算）
}
resource "random_password" "free" {
  length = 1
}`;
  it('resourceBlocks 以大括號配對', () => expect(resourceBlocks(tf).map((b) => b.name)).toEqual(['ok', 'bad', 'free']));
  it('受保護的資源沒有 prevent_destroy → 擋下；註解掉的不算', () => expect(checkProtected({ 'a.tf': tf })).toEqual(['a.tf：cloudflare_r2_bucket.bad 沒有 prevent_destroy = true']));
  it('CONTENT_SOURCE 出現在程式裡 → 擋下；只在註解裡沒關係', () => {
    expect(checkContentSourceUnmanaged({ 'a.tf': '# 不管理 CONTENT_SOURCE' })).toEqual([]);
    expect(checkContentSourceUnmanaged({ 'b.tf': 'resource "github_actions_variable" "x" {\n  variable_name = "CONTENT_SOURCE"\n}' })).toHaveLength(1);
  });
  it('自動建立的 DNS 記錄不能交給 tofu', () => {
    const dns = 'resource "cloudflare_dns_record" "m" {\n  name = "media.jackywu.ca"\n  lifecycle {\n    prevent_destroy = true\n  }\n}';
    expect(checkDnsOwnership({ 'z.tf': dns }, ['media.jackywu.ca'])).toHaveLength(1);
    expect(checkDnsOwnership({ 'z.tf': dns }, ['admin.jackywu.ca'])).toEqual([]);
  });
  it('secretKeys 取 for_each 裡的名稱', () => expect(secretKeys('  for_each = {\n    CF_ACCESS_CLIENT_ID = a\n    PUBLISH_HMAC_SECRET = b\n  }')).toEqual(['CF_ACCESS_CLIENT_ID', 'PUBLISH_HMAC_SECRET']));
});

it('checkWorkflowSecrets：沒有出處、或兩個 stack 寫同一個 → 擋下', () => {
  const producers = { bootstrap: ['R2_PUBLIC_SECRET', 'R2_PUBLIC_SECRET'], live: ['PUBLISH_HMAC_SECRET'] };
  expect(checkWorkflowSecrets(new Set(['R2_PUBLIC_SECRET', 'PUBLISH_HMAC_SECRET', 'CLOUDFLARE_ACCOUNT_ID']), producers, { CLOUDFLARE_ACCOUNT_ID: '手動' })).toEqual([]);
  expect(checkWorkflowSecrets(new Set(['MYSTERY']), producers, {}).join()).toMatch(/MYSTERY/);
  expect(checkWorkflowSecrets(new Set(), { a: ['X'], b: ['X'] }, {}).join()).toMatch(/互相覆蓋/);
});
