/**
 * 發佈佇列的狀態機。純函式、不碰 I/O：Payload 與 GitHub 只是它的輸入與輸出。
 *
 * 不變量（測試逐條守著）：
 *  1. 任何時刻最多一筆請求處於 dispatched/building。
 *  2. 一筆失敗的請求永遠不擋住其他請求。
 *  3. 回呼重送是冪等的：同一個結果送兩次，狀態不變、不重複發佈。
 *  4. GitHub 取消 run（concurrency 會取消排隊中的）不算失敗，自動重送，最多 MAX_ATTEMPTS 次。
 */
export const MAX_ATTEMPTS = 3;
/** 送出之後多久還找不到這一次的 run，就當作沒送到（GitHub 建 run 通常只要幾秒） */
export const NO_RUN_MS = 15 * 60 * 1000;
/**
 * run 還在跑（或在 concurrency 群組裡排隊）時不判失敗：它之後仍可能部署成功，判失敗只會讓網站與後台不一致。
 * 只有超過這個硬上限才收掉，避免佇列永遠不動。job 本身的 timeout 是 20 分鐘，這裡涵蓋的是排隊等待。
 */
export const HARD_MS = 6 * 60 * 60 * 1000;

export type Kind = 'publish' | 'unpublish' | 'delete';
export type Status = 'queued' | 'dispatched' | 'deployed' | 'failed';

export interface PublishRequest {
  id: string;
  kind: Kind;
  collection: string;
  docId: string;
  /** 綁定送出那一刻的版本；之後的編輯不影響這一筆 */
  versionId: string;
  status: Status;
  attempts: number;
  createdAt: number;
  dispatchedAt?: number;
  finishedAt?: number;
  failure?: { check: string; summary: string; runUrl?: string };
  /** 先被判失敗、之後才確認已上線（遲到的回呼，或線上 manifest 證明） */
  late?: boolean;
}

export type RunConclusion = 'success' | 'failure' | 'cancelled' | 'timed_out' | 'in_progress' | 'unknown';
export type Result =
  | { ok: true }
  | { ok: false; check: string; summary: string; runUrl?: string };

const busy = (r: PublishRequest) => r.status === 'dispatched';

export function enqueue(
  queue: readonly PublishRequest[],
  input: Pick<PublishRequest, 'id' | 'kind' | 'collection' | 'docId' | 'versionId'>,
  now: number,
): PublishRequest[] {
  // 同一文件同一版本同一動作還在排隊或進行中：直接用既有那筆（連按兩次發佈）
  const dup = queue.find(
    (r) =>
      r.collection === input.collection &&
      r.docId === input.docId &&
      r.versionId === input.versionId &&
      r.kind === input.kind &&
      (r.status === 'queued' || r.status === 'dispatched'),
  );
  if (dup) return [...queue];
  if (queue.some((r) => r.id === input.id)) throw new Error(`請求 id 重複：${input.id}`);
  return [...queue, { ...input, status: 'queued', attempts: 0, createdAt: now }];
}

/** 下一筆該送出的請求；已有進行中的就回 null。 */
export function nextToDispatch(queue: readonly PublishRequest[]): PublishRequest | null {
  if (queue.some(busy)) return null;
  return [...queue].filter((r) => r.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}

export function markDispatched(queue: readonly PublishRequest[], id: string, now: number): PublishRequest[] {
  if (queue.some((r) => busy(r) && r.id !== id)) {
    throw new Error('已經有另一筆請求在進行中，不能同時送出');
  }
  return update(queue, id, (r) => {
    if (r.status !== 'queued') throw new Error(`只有 queued 能送出，目前是 ${r.status}`);
    return { ...r, status: 'dispatched', attempts: r.attempts + 1, dispatchedAt: now };
  });
}

/** 回呼。冪等：已經定案的請求再收到結果，原樣忽略。 */
export function applyResult(
  queue: readonly PublishRequest[],
  id: string,
  result: Result,
  now: number,
): PublishRequest[] {
  return update(queue, id, (r) => {
    // 已判失敗（或因找不到 run 而重新排隊）卻收到成功：網站確實上線了。這必須被採納，否則網站有這篇、後台說沒有
    if ((r.status === 'failed' || r.status === 'queued') && result.ok) return { ...r, status: 'deployed', finishedAt: now, late: true };
    // 已定案、或重新排隊後才收到的失敗：忽略（排隊中的會再跑一次）
    if (r.status !== 'dispatched') return r;
    return result.ok
      ? { ...r, status: 'deployed', finishedAt: now }
      : {
          ...r,
          status: 'failed',
          finishedAt: now,
          failure: { check: result.check, summary: result.summary, runUrl: result.runUrl },
        };
  });
}

/**
 * 看門狗。runs 是 GitHub Actions 對「這一次嘗試」的 run 的結論（以請求 id 為鍵）。
 * liveRequestId 是線上 content-manifest.json 記的請求 id：run 結束卻沒有回呼時，用它判斷是否其實已經上線。
 *  · 被取消 → 重新排隊（不算失敗），最多 MAX_ATTEMPTS 次
 *  · 還在跑 → 不動（超過 HARD_MS 才收掉）
 *  · 找不到 run，超過 NO_RUN_MS → 當作沒送到，重新排隊
 *  · 結束了但沒有回呼 → 線上就是這一筆則判已上線，否則判失敗
 */
export function watchdog(
  queue: readonly PublishRequest[],
  runs: Readonly<Record<string, RunConclusion>>,
  now: number,
  liveRequestId?: string | null,
): PublishRequest[] {
  return queue.map((r) => {
    if (r.status !== 'dispatched') return r;
    const c = runs[r.id] ?? 'unknown';
    const age = r.dispatchedAt === undefined ? Infinity : now - r.dispatchedAt;
    const requeue = (why: string) => (r.attempts >= MAX_ATTEMPTS
      ? fail(r, now, 'github-actions', `${why} ${r.attempts} 次，已放棄`)
      : { ...r, status: 'queued' as const, dispatchedAt: undefined });
    if (c === 'cancelled') return requeue('run 被取消');
    if (c === 'in_progress') return age > HARD_MS ? fail(r, now, 'watchdog', 'run 超過 6 小時仍沒有結束，已收掉') : r;
    if (c === 'unknown') return age > NO_RUN_MS ? requeue('送出後找不到 run') : r;
    if (liveRequestId && liveRequestId === r.id) return { ...r, status: 'deployed' as const, finishedAt: now, late: true };
    if (c === 'success') {
      return fail(r, now, 'callback-missing', 'workflow 已成功，但沒有收到回呼，線上的版本也不是這一筆，請重新發佈');
    }
    return fail(r, now, 'github-actions', 'workflow 在回報結果之前就結束了，線上維持上一版');
  });
}

function fail(r: PublishRequest, now: number, check: string, summary: string): PublishRequest {
  return { ...r, status: 'failed', finishedAt: now, failure: { check, summary } };
}

function update(
  queue: readonly PublishRequest[],
  id: string,
  fn: (r: PublishRequest) => PublishRequest,
): PublishRequest[] {
  if (!queue.some((r) => r.id === id)) throw new Error(`找不到請求 ${id}`);
  return queue.map((r) => (r.id === id ? fn(r) : r));
}

/* ───────── 依賴閉包 ───────── */

export interface TaleRefs {
  id: string;
  route?: string | null;
  video?: string | null;
  media: string[];
}

/**
 * 發佈一篇文章時，它引用到但還沒上線的東西必須一起送。
 * 否則文章上線、路線不存在，<Route of> 會讓整個建置失敗。
 */
export function dependencyClosure(
  tale: TaleRefs,
  published: ReadonlySet<string>,
): { routes: string[]; reels: string[]; media: string[] } {
  const miss = (id?: string | null) => (id && !published.has(id) ? [id] : []);
  return {
    routes: miss(tale.route),
    reels: miss(tale.video),
    media: tale.media.filter((m) => !published.has(m)),
  };
}

/* ───────── 完整性護欄 ───────── */

/**
 * fetch-content 拉到的已上線文章數，若比上次成功部署少了超過「這筆請求合理撤下的數量」，
 * 就拒絕建置。防止 API 回了半截資料時，把整站內容清空。
 */
export function checkIntegrity(args: {
  lastDeployedCount: number;
  fetchedCount: number;
  expectedRemovals: number;
}): { ok: true } | { ok: false; reason: string } {
  const floor = args.lastDeployedCount - args.expectedRemovals;
  return args.fetchedCount >= floor
    ? { ok: true }
    : {
        ok: false,
        reason: `只拉到 ${args.fetchedCount} 篇，上次部署是 ${args.lastDeployedCount} 篇、這次只該撤下 ${args.expectedRemovals} 篇（下限 ${floor}）`,
      };
}

// 撤回公開媒體的規劃在 packages/content-sync/promote.ts（前台部署腳本與後台共用同一份）
