#!/usr/bin/env node
/**
 * 把 infra/live 產生的 Worker secret 寫進各個 Worker（邏輯在 packages/infra/secret-sync.ts）。
 *
 *   node scripts/infra/sync-worker-secrets.mjs            同步（infra-apply 在 tofu apply 之後跑）
 *   node scripts/infra/sync-worker-secrets.mjs --dry-run  只列出會寫哪些名稱
 *   node scripts/infra/sync-worker-secrets.mjs --check    只比對名稱，不讀任何值（admin-deploy 建置前用）
 *   --worker=<名稱>  只處理一個 Worker；--force  不看指紋，全部重寫
 *
 * 環境變數：
 *   CLOUDFLARE_API_TOKEN                        需要 Workers Scripts 的讀（--check）或寫
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   state bucket 的憑證（指紋檔；--check 不需要）
 *   TF_VAR_state_passphrase 等 tofu output 需要的變數（--check 不需要）
 *
 * 值只在記憶體裡：tofu output 的 stdout 直接解析，不寫檔、不放進命令列參數，輸出只有名稱。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { check, sync } from '../../packages/infra/secret-sync.ts';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || 'e92ee6e81173e12edb023ed5ee34faee';
const COMPAT_DATE = '2026-09-03';
const STATE_BUCKET = 'hongchen-tofu-state';
const FP_KEY = 'live/secret-sync-fingerprints.json';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.find((a) => a.startsWith('--worker='))?.slice(9);
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) { console.error('需要 CLOUDFLARE_API_TOKEN'); process.exit(2); }

const matrix = Object.fromEntries(Object.entries(JSON.parse(readFileSync('infra/worker-secrets.json', 'utf8'))).filter(([k]) => !k.startsWith('$')));

async function cf(method, path, body, headers = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method, body, headers: { authorization: `Bearer ${TOKEN}`, ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
  });
  const j = await r.json().catch(() => ({}));
  const err = (j.errors ?? [])[0];
  return { status: r.status, ok: r.ok && j.success !== false, result: j.result, code: err?.code, message: err?.message };
}

const api = {
  async list(worker) {
    const r = await cf('GET', `/workers/scripts/${worker}/secrets`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`讀取 ${worker} 的 secret 名稱失敗：HTTP ${r.status} ${r.code ?? ''} ${r.message ?? ''}`);
    return (r.result ?? []).map((s) => s.name);
  },
  async put(worker, name, text) {
    const r = await cf('PUT', `/workers/scripts/${worker}/secrets`, JSON.stringify({ name, text, type: 'secret_text' }));
    return { ok: r.ok, code: r.code, message: r.message };
  },
  async createPlaceholder(worker, secrets) {
    const form = new FormData();
    form.set('metadata', JSON.stringify({
      main_module: 'placeholder.js', compatibility_date: COMPAT_DATE,
      bindings: Object.entries(secrets).map(([name, text]) => ({ type: 'secret_text', name, text })),
    }));
    form.set('placeholder.js', new Blob(['export default { fetch() { return new Response("尚未部署", { status: 503 }); } };'], { type: 'application/javascript+module' }), 'placeholder.js');
    const r = await cf('PUT', `/workers/scripts/${worker}`, form);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    // workers.dev 是繞過 Access 的入口：空殼也要關掉
    const s = await cf('POST', `/workers/scripts/${worker}/subdomain`, JSON.stringify({ enabled: false, previews_enabled: false }));
    return { ok: s.ok, code: s.code, message: s.message };
  },
};

const log = (l) => console.log(l);

if (flag('--check')) {
  const { ok } = await check(matrix, api, log, only);
  process.exit(ok ? 0 : 1);
}

const tofuOutput = (name) => JSON.parse(execFileSync('tofu', ['-chdir=infra/live', 'output', '-json', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 << 20 }));
let values, fpKey;
try { values = tofuOutput('worker_secrets'); fpKey = tofuOutput('secret_sync_fp_key'); }
catch (e) { console.error(`讀不到 tofu output（先 tofu init 並設好 state 憑證與密語）：${String(e.stderr ?? e.message).split('\n').find((l) => /Error/.test(l)) ?? 'tofu 失敗'}`); process.exit(2); }

// 只有真的要同步時才載入（--check 在只裝了後台依賴的 admin-deploy 裡也要能跑）
const { AwsClient } = await import('aws4fetch');
const s3 = new AwsClient({ accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '', service: 's3', region: 'auto' });
const fpUrl = `https://${ACCOUNT}.r2.cloudflarestorage.com/${STATE_BUCKET}/${FP_KEY}`;
const fp = {
  async load() {
    const r = await s3.fetch(fpUrl);
    if (r.status === 404) return {};
    if (!r.ok) throw new Error(`讀取指紋檔失敗：HTTP ${r.status}`);
    return r.json();
  },
  async save(map) {
    const r = await s3.fetch(fpUrl, { method: 'PUT', body: JSON.stringify(map), headers: { 'content-type': 'application/json' } });
    if (!r.ok) throw new Error(`寫入指紋檔失敗：HTTP ${r.status}`);
  },
};

const { ok } = await sync({ matrix, values, api, fp, fpKey, log, force: flag('--force'), dryRun: flag('--dry-run'), only });
process.exit(ok ? 0 : 1);
