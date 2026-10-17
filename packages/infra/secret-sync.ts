/**
 * 把 infra/live 產生的 Worker secret 寫進各個 Worker（scripts/infra/sync-worker-secrets.mjs 的邏輯）。
 *
 * Cloudflare 讀不回 secret 的值，所以「有沒有變」靠指紋判斷：HMAC-SHA256(fpKey, worker/名稱/值)，存在 state bucket。
 * 沒有 fpKey 就推不出值，指紋檔外流也不會洩漏任何東西。每一次寫入都會產生一個新的 Worker 部署，所以沒變的值一律跳過。
 * 輸出只有 Worker 與 secret 的名稱，從不出現值。
 */
import { createHmac } from 'node:crypto';

export type Matrix = Record<string, string[]>;
export type Values = Record<string, Record<string, string>>;
export interface PutResult { ok: boolean; code?: number; message?: string }
export interface Api {
  /** 遠端已有的 secret 名稱；Worker 不存在回 null */
  list(worker: string): Promise<string[] | null>;
  put(worker: string, name: string, value: string): Promise<PutResult>;
  /** Worker 還沒部署過：建一個回 503 的空殼，一次帶上所有 secret（第一次 wrangler deploy 會保留它們） */
  createPlaceholder(worker: string, secrets: Record<string, string>): Promise<PutResult>;
}
export interface FingerprintStore { load(): Promise<Record<string, string>>; save(fp: Record<string, string>): Promise<void> }
export interface Options { matrix: Matrix; values: Values; api: Api; fp: FingerprintStore; fpKey: string; log: (line: string) => void; force?: boolean; dryRun?: boolean; only?: string }

/** Cloudflare 的錯誤代碼：這個名稱已經是 plain-text var */
export const VAR_CONFLICT = 10053;

export const fingerprint = (key: string, worker: string, name: string, value: string) =>
  createHmac('sha256', key).update(`${worker}\0${name}\0${value}`).digest('hex');

/** 對照表與產生的值必須逐一相同：少一個就停，不要部分同步 */
export function checkShape(matrix: Matrix, values: Values): string[] {
  const out: string[] = [];
  for (const w of new Set([...Object.keys(matrix), ...Object.keys(values)])) {
    const want = new Set(matrix[w] ?? []), have = new Set(Object.keys(values[w] ?? {}));
    for (const n of want) if (!have.has(n)) out.push(`${w} 少了 ${n} 的值`);
    for (const n of have) if (!want.has(n)) out.push(`${w} 多了 ${n}（不在 infra/worker-secrets.json）`);
    for (const [n, v] of Object.entries(values[w] ?? {})) if (typeof v !== 'string' || v === '') out.push(`${w} 的 ${n} 是空的`);
  }
  return out;
}

export async function sync(o: Options): Promise<{ ok: boolean }> {
  const shape = checkShape(o.matrix, o.values);
  if (shape.length) { for (const s of shape) o.log(`✗ ${s}`); return { ok: false }; }
  const fp = await o.fp.load();
  let ok = true;

  for (const worker of Object.keys(o.matrix).sort()) {
    if (o.only && worker !== o.only) continue;
    const names = [...o.matrix[worker]!].sort();
    const remote = await o.api.list(worker);

    if (remote === null) {
      if (o.dryRun) { for (const n of names) o.log(`· ${worker} ${n} 會建立（Worker 尚未部署，先建空殼）`); continue; }
      const r = await o.api.createPlaceholder(worker, o.values[worker]!);
      if (!r.ok) { o.log(`✗ ${worker} 建立空殼失敗：${r.code ?? ''} ${r.message ?? ''}`.trim()); ok = false; continue; }
      for (const n of names) { fp[`${worker}/${n}`] = fingerprint(o.fpKey, worker, n, o.values[worker]![n]!); o.log(`✓ ${worker} ${n} created`); }
      await o.fp.save(fp);
      continue;
    }

    for (const n of names) {
      const value = o.values[worker]![n]!;
      const f = fingerprint(o.fpKey, worker, n, value);
      const status = !remote.includes(n) ? 'created' : o.force || fp[`${worker}/${n}`] !== f ? 'updated' : 'unchanged';
      if (status === 'unchanged') { o.log(`✓ ${worker} ${n} unchanged`); continue; }
      if (o.dryRun) { o.log(`· ${worker} ${n} 會 ${status === 'created' ? '建立' : '更新'}`); continue; }
      const r = await o.api.put(worker, n, value);
      if (!r.ok) {
        ok = false;
        o.log(r.code === VAR_CONFLICT
          ? `✗ ${worker} ${n} 目前是 plain-text var：先部署拿掉這個 var 的 wrangler.jsonc（admin-deploy），再重跑同步`
          : `✗ ${worker} ${n} 寫入失敗：${r.code ?? ''} ${r.message ?? ''}`.trim());
        continue;
      }
      fp[`${worker}/${n}`] = f;
      await o.fp.save(fp); // 每成功一個就存：中途失敗再跑時從斷點繼續
      o.log(`✓ ${worker} ${n} ${status}`);
    }

    // 遠端多出來的不刪：可能是別人手動放的，刪掉會讓 Worker 壞掉。列出指令交給人決定
    for (const extra of remote.filter((n) => !names.includes(n)).sort()) {
      o.log(`! ${worker} 有不在對照表裡的 ${extra}；確定不要的話：pnpm --dir admin exec wrangler secret delete ${extra} --name ${worker}`);
    }
  }
  return { ok };
}

/** --check：只比名稱，不碰任何值（給 admin-deploy.yml 在建置前用） */
export async function check(matrix: Matrix, api: Pick<Api, 'list'>, log: (l: string) => void, only?: string): Promise<{ ok: boolean }> {
  let ok = true;
  for (const worker of Object.keys(matrix).sort()) {
    if (only && worker !== only) continue;
    const remote = await api.list(worker);
    const missing = remote === null ? matrix[worker]! : matrix[worker]!.filter((n) => !remote.includes(n));
    if (missing.length) { ok = false; log(`✗ ${worker} 缺少 ${missing.join('、')}${remote === null ? '（Worker 不存在）' : ''}：先跑 infra-apply（它會同步 secret）`); }
    else log(`✓ ${worker} ${matrix[worker]!.length} 個 secret 都在`);
  }
  return { ok };
}
