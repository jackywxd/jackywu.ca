/** 影片轉碼工作的狀態機。純函式；Payload 的 reels.transcode 群組只是它的儲存。 */
export const MAX_ATTEMPTS = 3;
export const STALE_MS = 30 * 60 * 1000; // 轉碼進行中超過這麼久沒有回報，視為卡死

export type JobStatus = 'none' | 'uploading' | 'queued' | 'running' | 'done' | 'failed';
export interface Job { status: JobStatus; attempts: number; error?: string | null; startedAt?: number | null; finishedAt?: number | null }

export const fresh = (): Job => ({ status: 'uploading', attempts: 0 });

export function uploaded(j: Job): Job {
  if (j.status !== 'uploading') throw new Error(`只有上傳中的影片能標成已上傳（目前 ${j.status}）`);
  return { ...j, status: 'queued', error: null };
}

export function start(j: Job, now: number): Job {
  if (j.status !== 'queued') throw new Error(`只有排隊中的工作能開始（目前 ${j.status}）`);
  // 不清掉 error：重試時使用者仍要看得到上一次為什麼失敗；成功（finish）才清
  return { ...j, status: 'running', attempts: j.attempts + 1, startedAt: now };
}

export function finish(j: Job, now: number): Job {
  if (j.status !== 'running') return j; // 冪等：重複回報成功、或先被看門狗收掉之後才回報，都不改變狀態
  return { ...j, status: 'done', finishedAt: now, error: null };
}

/** 失敗：次數沒用完就回到排隊（自動重試），用完才真的失敗並要人按「重新轉碼」 */
export function fail(j: Job, error: string, now: number): Job {
  if (j.status !== 'running') return j;
  return j.attempts >= MAX_ATTEMPTS
    ? { ...j, status: 'failed', finishedAt: now, error }
    : { ...j, status: 'queued', error };
}

/** 看門狗：進行中太久沒有回報 → 當成失敗處理 */
export function sweep(j: Job, now: number): Job {
  return j.status === 'running' && j.startedAt != null && now - j.startedAt > STALE_MS ? fail(j, '轉碼逾時沒有回報', now) : j;
}

/** 使用者按「重新轉碼」：只有失敗的能重來，次數歸零 */
export function retry(j: Job): Job {
  if (j.status !== 'failed') throw new Error(`只有失敗的工作能重新轉碼（目前 ${j.status}）`);
  return { ...j, status: 'queued', attempts: 0, error: null };
}

/** 發佈前的檢查：影片還沒轉好就不能發佈 */
export const publishable = (j: Job): boolean => j.status === 'done';
