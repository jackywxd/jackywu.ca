/**
 * workflow 的靜態檢查。workflow 沒辦法在本機跑，所以把「容易默默壞掉」的約束寫成可測的規則：
 *  1. run 區塊不可直接內插不受信任的上下文（命令注入）
 *  2. publish.yml 的 verify 步驟與 package.json 的 postbuild 一致（不會少跑一個檢查）
 *  3. describeFailure 依賴的 step id 都真的存在
 *  4. 部署類 workflow 不可在半途取消；觸發事件名與後台送出的一致
 */
import { STEPS } from './ci.ts';

export interface Step { id?: string; name?: string; run?: string; uses?: string; if?: string; env?: Record<string, unknown> }
export interface Workflow { name?: string; on?: unknown; concurrency?: { group?: string; 'cancel-in-progress'?: boolean }; jobs?: Record<string, { steps?: Step[] }> }

// github.event.*.number 是 GitHub 保證的整數，不可能夾帶指令；其餘 event 欄位（標題、內文、分支名、label…）都是攻擊者可控
const UNTRUSTED = /\$\{\{\s*(github\.event\.(?!(?:pull_request\.|issue\.)?number\s*\}\})|github\.head_ref|github\.ref_name|inputs\.|github\.actor|github\.triggering_actor)/;

export function checkInjection(file: string, wf: Workflow): string[] {
  const out: string[] = [];
  for (const [job, j] of Object.entries(wf.jobs ?? {})) {
    for (const [i, s] of (j.steps ?? []).entries()) {
      if (s.run && UNTRUSTED.test(s.run)) {
        out.push(`${file}: job ${job} 第 ${i + 1} 步（${s.name ?? s.id ?? '?'}）的 run 直接內插了不受信任的上下文，改成經由 env 傳入`);
      }
    }
  }
  return out;
}

export const postbuildVerifies = (postbuild: string): string[] =>
  [...postbuild.matchAll(/scripts\/(verify-[a-z-]+)\.mjs/g)].map((m) => m[1]!);

export function checkPublish(wf: Workflow, postbuild: string, eventType: string): string[] {
  const out: string[] = [];
  const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
  const ids = new Set(steps.map((s) => s.id).filter(Boolean));
  for (const id of STEPS) if (!ids.has(id)) out.push(`publish.yml 缺少 step id「${id}」（回報失敗原因要靠它）`);

  const want = postbuildVerifies(postbuild);
  const have = steps.map((s) => s.id).filter((id): id is string => !!id && id.startsWith('verify-'));
  if (JSON.stringify(want) !== JSON.stringify(have)) {
    out.push(`publish.yml 的 verify 步驟 [${have.join(', ')}] 與 package.json postbuild [${want.join(', ')}] 不一致（順序也要一樣）`);
  }

  const on = wf.on as { repository_dispatch?: { types?: string[] } } | undefined;
  if (!on?.repository_dispatch?.types?.includes(eventType)) out.push(`publish.yml 沒有監聽 repository_dispatch「${eventType}」`);
  if (wf.concurrency?.['cancel-in-progress'] !== false) out.push('publish.yml 的 concurrency.cancel-in-progress 必須是 false（部署不能在半途取消）');
  if (!wf.concurrency?.group) out.push('publish.yml 必須有 concurrency.group（序列化）');

  // 結果回報必須是 always()，否則失敗時後台永遠等不到
  const cb = steps.find((s) => s.run?.includes('ci-callback'));
  if (!cb) out.push('publish.yml 沒有回報步驟（ci-callback）');
  else if (!/\balways\(\)/.test(cb.if ?? '')) out.push('回報步驟必須是 if: always()');

  // promote 必須在 deploy 之前（頁面上線時它引用的檔案要已經在）
  const idx = (id: string) => steps.findIndex((s) => s.id === id);
  if (idx('promote') < 0 || idx('deploy') < 0 || idx('promote') > idx('deploy')) out.push('promote 必須在 deploy 之前');
  if (idx('smoke') < idx('deploy')) out.push('smoke 必須在 deploy 之後');
  return out;
}

export function checkDeployNoCancel(file: string, wf: Workflow): string[] {
  // 只有會動到正式流量的 `wrangler deploy` 不可半途取消；`versions upload`（PR 預覽）不接管流量，可以取消
  const deploys = Object.values(wf.jobs ?? {}).some((j) => (j.steps ?? []).some((s) => /wrangler deploy/.test(s.run ?? '')));
  if (deploys && wf.concurrency?.['cancel-in-progress'] === true) return [`${file}: 會部署的 workflow 不可設 cancel-in-progress: true`];
  return [];
}
