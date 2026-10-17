/**
 * workflow 的靜態檢查。workflow 沒辦法在本機跑，所以把「容易默默壞掉」的約束寫成可測的規則：
 *  1. run 區塊不可直接內插不受信任的上下文（命令注入）
 *  2. publish.yml 的 verify 步驟與 package.json 的 postbuild 一致（不會少跑一個檢查）
 *  3. describeFailure 依賴的 step id 都真的存在
 *  4. 部署類 workflow 不可在半途取消；觸發事件名與後台送出的一致
 *  5. 內容來源只由 repo 變數 CONTENT_SOURCE 決定：git 時 deploy.yml 部署，payload 時 publish.yml 部署
 */
import { STEPS } from './ci.ts';

export interface Step { id?: string; name?: string; run?: string; uses?: string; if?: string; env?: Record<string, unknown>; with?: Record<string, unknown> }
export interface Workflow { name?: string; 'run-name'?: string; on?: unknown; env?: Record<string, unknown>; concurrency?: { group?: string; 'cancel-in-progress'?: boolean }; jobs?: Record<string, { if?: string; env?: Record<string, unknown>; environment?: unknown; steps?: Step[] }> }

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

export function checkPublish(wf: Workflow, postbuild: string, dispatchInputs: readonly string[]): string[] {
  const out: string[] = [];
  const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
  const ids = new Set(steps.map((s) => s.id).filter(Boolean));
  for (const id of STEPS) if (!ids.has(id)) out.push(`publish.yml 缺少 step id「${id}」（回報失敗原因要靠它）`);

  const want = postbuildVerifies(postbuild);
  const have = steps.map((s) => s.id).filter((id): id is string => !!id && id.startsWith('verify-'));
  if (JSON.stringify(want) !== JSON.stringify(have)) {
    out.push(`publish.yml 的 verify 步驟 [${have.join(', ')}] 與 package.json postbuild [${want.join(', ')}] 不一致（順序也要一樣）`);
  }

  // 後台用 workflow_dispatch 觸發：少了任何一個 input，GitHub 會以 422 拒絕整個 dispatch
  const on = wf.on as { workflow_dispatch?: { inputs?: Record<string, unknown> } } | undefined;
  for (const k of dispatchInputs) if (!on?.workflow_dispatch?.inputs?.[k]) out.push(`publish.yml 的 workflow_dispatch 缺少 input「${k}」（後台送的就是這幾欄）`);
  // 看門狗靠 run-name 找到這一次嘗試的 run（github-app.ts 的 runTitle）
  const runName = String(wf['run-name'] ?? '');
  if (!/^publish \$\{\{ inputs\.request_id \|\| github\.event_name \}\} #\$\{\{ inputs\.attempt \|\| 0 \}\}$/.test(runName)) {
    out.push(`publish.yml 的 run-name 必須是「publish \${{ inputs.request_id || github.event_name }} #\${{ inputs.attempt || 0 }}」，目前是「${runName}」`);
  }
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

/**
 * 切換到後台內容之後，任何一次用 git 內容建置的部署都會把後台發佈的文章整批撤下。
 * 所以：deploy.yml 只在 CONTENT_SOURCE 不是 payload 時部署；publish.yml 接手 push，
 * 並在拉內容之前確認來源。兩者不能共用 concurrency 群組，否則排隊中的 run 會被對方取消。
 */
export function checkContentSource(files: Record<string, Workflow>): string[] {
  const out: string[] = [];
  const deploy = files['deploy.yml'], publish = files['publish.yml'];
  if (!deploy || !publish) return ['找不到 deploy.yml 或 publish.yml'];
  for (const [name, j] of Object.entries(deploy.jobs ?? {})) {
    const deploys = (j.steps ?? []).some((s) => /wrangler deploy/.test(s.run ?? ''));
    if (deploys && !/vars\.CONTENT_SOURCE\s*!=\s*'payload'/.test(j.if ?? '')) {
      out.push(`deploy.yml 的 job ${name} 會部署，但沒有 if: vars.CONTENT_SOURCE != 'payload'（切換後會用 git 內容蓋掉線上）`);
    }
  }
  const on = publish.on as { push?: { branches?: string[] } } | undefined;
  if (!on?.push?.branches?.includes('main')) out.push('publish.yml 必須處理 push main（切換後程式碼的變更由它部署）');
  const steps = Object.values(publish.jobs ?? {}).flatMap((j) => j.steps ?? []);
  const gate = steps.findIndex((s) => s.id === 'content-source'), fetch = steps.findIndex((s) => s.id === 'fetch-content');
  if (gate < 0) out.push('publish.yml 缺少 content-source 把關步驟');
  else if (fetch >= 0 && gate > fetch) out.push('content-source 把關必須在 fetch-content 之前');
  if (deploy.concurrency?.group && deploy.concurrency.group === publish.concurrency?.group) {
    out.push(`deploy.yml 與 publish.yml 共用 concurrency 群組「${deploy.concurrency.group}」：排隊中的 run 會互相取消`);
  }
  return out;
}

/** workflow 或 job 層級的 env 對每一步都可見，包含 pnpm install 的 lifecycle script 與所有建置工具。secret 只放在用到它的 step。 */
export function checkSecretScope(file: string, wf: Workflow): string[] {
  const out: string[] = [];
  const has = (env?: Record<string, unknown>) => Object.entries(env ?? {}).filter(([, v]) => /\bsecrets\./.test(String(v))).map(([k]) => k);
  for (const k of has(wf.env)) out.push(`${file}: workflow 層級的 env ${k} 帶了 secret，移到用到它的 step`);
  for (const [job, j] of Object.entries(wf.jobs ?? {})) for (const k of has(j.env)) out.push(`${file}: job ${job} 的 env ${k} 帶了 secret，移到用到它的 step`);
  return out;
}

/**
 * infra-*.yml：repo 是公開的，Actions 的 log 誰都看得到，而 tofu 的輸出、plan JSON、tofu output 都含明文的秘密。
 * 這幾條把「只印位址與動作」變成可檢查的規則。
 */
export function checkInfra(file: string, wf: Workflow): string[] {
  if (!/^infra-.*\.ya?ml$/.test(file)) return [];
  const out: string[] = [];
  for (const [job, j] of Object.entries(wf.jobs ?? {})) {
    const steps = j.steps ?? [];
    const usesSecrets = steps.some((s) => Object.values(s.env ?? {}).some((v) => /\bsecrets\./.test(String(v)) && !/secrets\.GITHUB_TOKEN|github\.token/.test(String(v))));
    if (usesSecrets && !(steps[0]?.if?.includes('runner.debug') && /\bexit 1\b/.test(steps[0]?.run ?? ''))) {
      out.push(`${file}: job ${job} 用到 secret，第一步必須是「runner.debug 時 exit 1」（debug 模式會把 provider 的請求印進 log）`);
    }
    for (const s of steps) {
      if (s.uses?.startsWith('opentofu/setup-opentofu') && String(s.with?.tofu_wrapper) !== 'false') {
        out.push(`${file}: job ${job} 的 setup-opentofu 必須 tofu_wrapper: false（wrapper 會把 stdout 放進 log 與 outputs）`);
      }
      for (const line of (s.run ?? '').split('\n')) {
        if (/\btofu\s+(-chdir=\S+\s+)?(plan|apply)\b/.test(line) && !/>\s*\/dev\/null/.test(line)) out.push(`${file}: job ${job} 的「${line.trim()}」沒有把 stdout 導到 /dev/null`);
        if (/\btofu\s+(-chdir=\S+\s+)?show\b/.test(line) && !/\|\s*node\s+\S*plan-summary\.mjs/.test(line)) out.push(`${file}: job ${job} 的 tofu show 只能直接接 plan-summary.mjs`);
        if (/\btofu\s+(-chdir=\S+\s+)?output\b/.test(line)) out.push(`${file}: job ${job} 不能在 run 裡用 tofu output（只能由 sync-worker-secrets.mjs 在記憶體裡讀）`);
      }
    }
    if (steps.some((s) => /\btofu\s+(-chdir=\S+\s+)?apply\b/.test(s.run ?? '')) && j.environment !== 'infra') {
      out.push(`${file}: job ${job} 會 tofu apply，必須在 environment: infra（要你核准、只允許 main）`);
    }
  }
  return out;
}
