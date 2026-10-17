/**
 * IaC 的靜態檢查（scripts/infra/verify-infra.mjs 對真實的檔案跑，這裡是純函式）。
 * 每一條都對應一種「部署之後才發現」的失敗：程式讀了一個沒人設的 env、wrangler 要求的 secret 與 IaC 產生的不一致、
 * 有東西被刪了而沒有保護、或後台的內容來源開關被 IaC 改回去。
 */

/** 程式碼讀的 env 名稱：process.env.X、env.X（access-strategy 收的是 process.env）、need('X')（publish-deps） */
export function envReads(src: string): Set<string> {
  const out = new Set<string>();
  for (const re of [/\benv\.([A-Z][A-Z0-9_]+)\b/g, /\benv\[['"]([A-Z][A-Z0-9_]+)['"]\]/g, /\bneed\(['"]([A-Z][A-Z0-9_]+)['"]\)/g]) {
    for (const m of src.matchAll(re)) out.add(m[1]!);
  }
  return out;
}

export interface WorkerEnv {
  worker: string;
  vars: string[];
  bindings: string[];
  required: string[];
}

type WranglerEnv = {
  name?: string; vars?: Record<string, unknown>; secrets?: { required?: string[] };
  services?: { binding: string }[]; d1_databases?: { binding: string }[]; r2_buckets?: { binding: string }[];
  images?: { binding: string }; assets?: { binding?: string }; send_email?: { name: string }[];
  durable_objects?: { bindings?: { name: string }[] };
};

/** wrangler 設定的頂層與每個 env 各是一個 Worker（env 底下的 vars 與 secrets 不繼承頂層） */
export function workerEnvs(config: WranglerEnv & { env?: Record<string, WranglerEnv> }, skipEnvs: string[] = ['e2e']): WorkerEnv[] {
  const one = (c: WranglerEnv, name: string): WorkerEnv => ({
    worker: name,
    vars: Object.keys(c.vars ?? {}),
    required: c.secrets?.required ?? [],
    bindings: [
      ...(c.services ?? []).map((s) => s.binding), ...(c.d1_databases ?? []).map((s) => s.binding), ...(c.r2_buckets ?? []).map((s) => s.binding),
      ...(c.images ? [c.images.binding] : []), ...(c.assets?.binding ? [c.assets.binding] : []), ...(c.send_email ?? []).map((s) => s.name),
      ...(c.durable_objects?.bindings ?? []).map((b) => b.name),
    ],
  });
  const out = [one(config, config.name!)];
  for (const [k, e] of Object.entries(config.env ?? {})) if (!skipEnvs.includes(k)) out.push(one(e, e.name ?? `${config.name}-${k}`));
  return out;
}

/**
 * 每個 Worker：程式讀的 env ⊆ vars ∪ bindings ∪ 對照表 ∪ 允許清單；對照表 == secrets.required；vars 與對照表不重疊
 */
export function checkWorkers(envs: WorkerEnv[], reads: Map<string, Set<string>>, matrix: Record<string, string[]>, allow: Record<string, string>, allowFor: Record<string, Record<string, string>> = {}): string[] {
  const out: string[] = [];
  for (const e of envs) {
    const m = matrix[e.worker];
    if (!m) { if (e.required.length) out.push(`${e.worker}：wrangler 有 secrets.required，但 infra/worker-secrets.json 沒有這個 Worker`); continue; }
    const want = [...m].sort(), req = [...e.required].sort();
    if (JSON.stringify(want) !== JSON.stringify(req)) {
      out.push(`${e.worker}：wrangler 的 secrets.required [${req.join(', ')}] 與 infra/worker-secrets.json [${want.join(', ')}] 不一致`);
    }
    for (const v of e.vars) if (m.includes(v)) out.push(`${e.worker}：${v} 同時是 var 與 secret（wrangler 會靜默地把它當 var，Secrets API 也會拒絕）`);
    const known = new Set([...e.vars, ...e.bindings, ...m, ...Object.keys(allow), ...Object.keys(allowFor[e.worker] ?? {})]);
    for (const r of reads.get(e.worker) ?? []) if (!known.has(r)) out.push(`${e.worker}：程式讀 ${r}，但它不是 var、binding、也不在 infra/worker-secrets.json（部署後會是 undefined）`);
  }
  for (const w of Object.keys(matrix)) if (!envs.some((e) => e.worker === w)) out.push(`infra/worker-secrets.json 有 ${w}，但沒有任何 wrangler 設定部署這個 Worker`);
  return out;
}

/** staging 沒有發佈流程（publish.yml 固定指向正式站）：它拿到發佈金鑰只會觸發正式站的 workflow */
export function checkStagingIsolation(matrix: Record<string, string[]>): string[] {
  const banned = ['PUBLISH_HMAC_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'];
  return Object.entries(matrix).filter(([w]) => w.endsWith('-staging'))
    .flatMap(([w, names]) => names.filter((n) => banned.includes(n)).map((n) => `${w} 不能有 ${n}（staging 沒有發佈流程）`));
}

/** HCL 的 resource 區塊（以大括號配對；字串裡的大括號在這些檔案裡不出現在區塊層級） */
export function resourceBlocks(tf: string): { type: string; name: string; body: string }[] {
  const out: { type: string; name: string; body: string }[] = [];
  const re = /^resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/gm;
  for (const m of tf.matchAll(re)) {
    let depth = 0, i = m.index! + m[0].length - 1;
    for (; i < tf.length; i++) { if (tf[i] === '{') depth++; else if (tf[i] === '}' && --depth === 0) break; }
    out.push({ type: m[1]!, name: m[2]!, body: tf.slice(m.index!, i + 1) });
  }
  return out;
}

const stripComments = (tf: string) => tf.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

/** 刪掉就失去資料、入口或歷史的資源一律要 prevent_destroy */
export const MUST_PROTECT = [
  'cloudflare_d1_database', 'cloudflare_r2_bucket', 'cloudflare_zero_trust_access_application', 'cloudflare_zero_trust_access_policy',
  'cloudflare_zero_trust_access_identity_provider', 'cloudflare_zero_trust_access_service_token', 'cloudflare_ruleset',
  'cloudflare_dns_record', 'cloudflare_email_routing_settings', 'github_repository_environment',
];

export function checkProtected(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [f, tf] of Object.entries(files)) {
    for (const b of resourceBlocks(stripComments(tf))) {
      if (MUST_PROTECT.includes(b.type) && !/prevent_destroy\s*=\s*true/.test(b.body)) out.push(`${f}：${b.type}.${b.name} 沒有 prevent_destroy = true`);
    }
  }
  return out;
}

/** CONTENT_SOURCE 是內容來源的切換開關（M4 由你手動切）。IaC 一管它，下一次 apply 就會把切換改回去 */
export function checkContentSourceUnmanaged(files: Record<string, string>): string[] {
  return Object.entries(files).filter(([, tf]) => /CONTENT_SOURCE/.test(stripComments(tf)))
    .map(([f]) => `${f}：不可以管理 CONTENT_SOURCE（見 docs/infra.md）`);
}

/** Worker 與 R2 custom domain 的 DNS 記錄由 Cloudflare 自動建立（唯讀），tofu 不能接手 */
export function checkDnsOwnership(files: Record<string, string>, autoHosts: string[]): string[] {
  const out: string[] = [];
  for (const [f, tf] of Object.entries(files)) {
    for (const b of resourceBlocks(stripComments(tf)).filter((x) => x.type === 'cloudflare_dns_record')) {
      const name = /\bname\s*=\s*"([^"]+)"/.exec(b.body)?.[1];
      if (name && autoHosts.includes(name)) out.push(`${f}：cloudflare_dns_record.${b.name} 是 ${name}，那筆記錄由 Worker 或 R2 custom domain 管`);
    }
  }
  return out;
}

/** workflow 用到的每個 secret 都要有出處（IaC 產生，或明列為手動）；兩個 stack 寫同一個 repo secret 會互相覆蓋 */
export function checkWorkflowSecrets(used: Set<string>, producers: Record<string, string[]>, manual: Record<string, string>): string[] {
  const out: string[] = [];
  const owner = new Map<string, string>();
  for (const [stack, names] of Object.entries(producers)) {
    for (const n of new Set(names)) { if (owner.has(n)) out.push(`${n} 同時由 ${owner.get(n)} 與 ${stack} 寫入，會互相覆蓋`); owner.set(n, stack); }
  }
  for (const n of used) if (!owner.has(n) && !(n in manual)) out.push(`workflow 用到 secrets.${n}，但沒有任何 stack 產生它，也不在手動清單`);
  return out;
}

/** HCL 裡 for_each = { NAME = ... } 的鍵（github.tf 的 secret 名稱） */
export const secretKeys = (tf: string): string[] => [...stripComments(tf).matchAll(/^\s+([A-Z][A-Z0-9_]+)\s+=/gm)].map((m) => m[1]!);
