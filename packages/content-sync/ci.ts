/**
 * publish.yml 用的純邏輯：驗請求、判定哪個步驟擋下、組回呼內容。
 * 放在這裡是為了能單元測試——workflow 本身沒辦法在本機跑。
 */
export const REQUEST_ID_RE = /^[a-z0-9]{20,32}$/;
const COLLECTIONS = ['tales', 'pages', 'routes', 'reels'];
const KINDS = ['publish', 'unpublish', 'delete'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface PublishRequestInput { requestId: string; kind: string; collection: string; docId: string; versionId: string }

/** client_payload 是外來輸入，絕不直接內插進 shell；這裡逐欄驗格式。 */
export function parseRequest(raw: unknown): { id: string; kind: string; collection: string; docId: string; versionId: string } {
  if (!raw || typeof raw !== 'object') throw new Error('client_payload 不是物件');
  const p = raw as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? String(p[k]) : '');
  if (!REQUEST_ID_RE.test(s('requestId'))) throw new Error('requestId 格式不對');
  if (!KINDS.includes(s('kind'))) throw new Error(`kind 不對：${s('kind')}`);
  if (!COLLECTIONS.includes(s('collection'))) throw new Error(`collection 不對：${s('collection')}`);
  if (!ID_RE.test(s('docId'))) throw new Error('docId 格式不對');
  if (!(s('versionId') === 'none' || ID_RE.test(s('versionId')))) throw new Error('versionId 格式不對');
  if (s('kind') === 'publish' && s('versionId') === 'none') throw new Error('發佈請求必須帶 versionId');
  return { id: s('requestId'), kind: s('kind'), collection: s('collection'), docId: s('docId'), versionId: s('versionId') };
}

/** 依序的建置步驟（與 publish.yml 的 step id 一一對應）。順序就是「誰先壞就算誰」。 */
export const STEPS = [
  'request', 'content-source', 'prev-manifest', 'fetch-content', 'fonts', 'astro-build', 'emit-redirects',
  'verify-fonts', 'verify-links', 'verify-wechat', 'verify-og-crop', 'verify-docs',
  'promote', 'deploy', 'smoke',
] as const;
export type StepId = (typeof STEPS)[number];

export interface StepOutcome { outcome?: string; conclusion?: string }

/** 找出第一個失敗的步驟與它的 log 尾巴；沒有失敗回 null */
export function describeFailure(
  steps: Record<string, StepOutcome | undefined>,
  readLog: (id: string) => string,
): { check: string; summary: string } | null {
  for (const id of STEPS) {
    const o = steps[id]?.outcome;
    if (o === 'failure' || o === 'cancelled') {
      const log = readLog(id).trim();
      const lines = log.split('\n').filter((l) => l.trim());
      // 優先挑 ✗／Error／錯誤 開頭的行，沒有就取最後幾行
      const marked = lines.filter((l) => /^(✗|.*\bError\b|.*錯誤|.*失敗)/.test(l)).slice(-6);
      const tail = (marked.length ? marked : lines.slice(-6)).join('\n');
      return { check: id, summary: (tail || `${id} 失敗（沒有 log）`).slice(-1500) };
    }
  }
  return null;
}

export function buildCallback(args: {
  requestId: string; steps: Record<string, StepOutcome | undefined>; readLog: (id: string) => string;
  runUrl: string; promoteKeys: string[]; revoked: string[];
}) {
  const failure = describeFailure(args.steps, args.readLog);
  // 部署與 smoke 都沒有失敗，才算成功。任何一步被略過（skipped）也不算成功：
  // 少了「deploy 成功」這個正面證據就不能宣告已上線。
  const deployed = args.steps.deploy?.outcome === 'success' && args.steps.smoke?.outcome === 'success';
  if (failure || !deployed) {
    return {
      requestId: args.requestId, ok: false,
      check: failure?.check ?? 'incomplete',
      summary: failure?.summary ?? '流程沒有走完（部署或 smoke 沒有成功），沒有任何內容被發佈',
      runUrl: args.runUrl,
    };
  }
  return { requestId: args.requestId, ok: true, runUrl: args.runUrl, promoteKeys: args.promoteKeys, revoked: args.revoked };
}

/**
 * 目前線上的版本 id（回滾用）。`wrangler deployments list --json` 由舊到新排列，
 * 最後一筆就是現行部署；只有「單一版本 100%」才是確定的現況，漸進式部署中不回滾。
 */
export function currentVersionId(deployments: unknown): string {
  if (!Array.isArray(deployments) || !deployments.length) throw new Error('沒有任何部署紀錄，無法決定回滾目標');
  const latest = deployments.reduce((a, b) => (String(b?.created_on) > String(a?.created_on) ? b : a));
  const vs = (latest as { versions?: { version_id?: string; percentage?: number }[] }).versions ?? [];
  if (vs.length !== 1 || vs[0]!.percentage !== 100 || !vs[0]!.version_id) {
    throw new Error('最新部署不是「單一版本 100%」（可能正在漸進式部署），不自動回滾');
  }
  return vs[0]!.version_id;
}

/**
 * 網站內容的來源只由 repo 變數 CONTENT_SOURCE 決定。還沒切換（git）時，後台送來的發佈一律拒絕：
 * 否則會用「後台裡有的內容」整站重建，把 git 裡的文章全部撤下。
 */
export function sourceGate(siteSource: string | undefined): void {
  if (siteSource !== 'payload') {
    throw new Error(`repo 變數 CONTENT_SOURCE 是「${siteSource ?? ''}」，不是 payload：網站還沒切換到後台內容，不能用後台內容部署`);
  }
}

/**
 * 上一次部署的 manifest（完整性護欄的基準）。拿不到基準時不能默默跳過護欄：
 * 只有明確宣告「這是第一次用 payload 內容部署」時，404 才是正常的。
 */
export function prevManifestDecision(httpCode: number, firstPayloadDeploy: boolean): 'use' | 'none' {
  if (httpCode === 200) {
    if (firstPayloadDeploy) throw new Error('線上已經有 payload 版的 manifest，這不是第一次切換；拿掉 first_payload_deploy 再跑');
    return 'use';
  }
  if (httpCode === 404) {
    if (firstPayloadDeploy) return 'none';
    throw new Error('線上沒有 content-manifest.json：上一次部署不是由後台內容建置的（例如有人用 git 內容部署過），完整性護欄沒有基準。查明原因；確定是第一次切換時，手動執行並勾選 first_payload_deploy');
  }
  throw new Error(`取得上次 manifest 回 ${httpCode}`);
}

/** 請求本身不合格時仍取出 requestId（只在格式合格時），讓回呼能告訴後台是哪一筆失敗 */
export function requestIdFrom(raw: string | undefined): string | null {
  try {
    const id = (JSON.parse(raw ?? '') as { requestId?: unknown } | null)?.requestId;
    return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null;
  } catch { return null; }
}
