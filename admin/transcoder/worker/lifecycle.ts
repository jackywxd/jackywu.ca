/**
 * 容器閒置到期（sleepAfter）時要不要停。純函式，給 Transcoder.onActivityExpired 用。
 *
 * @cloudflare/containers 只在「有請求進到容器」時延長閒置計時；/run 回 202 之後就沒有請求了，
 * 預設行為（直接停）會在第 10 分鐘把還在轉的 ffmpeg 殺掉，而且不會有任何回報。
 * 所以到期時先問容器還在不在轉：在轉就不停（函式庫隨後會重新計時），沒在轉、問不到、或轉太久才停。
 */
export const MAX_RUN_MS = 4 * 60 * 60 * 1000; // 與簽章網址的有效期一致：超過之後也寫不回去了

export type ContainerStatus = { busy: boolean; since: number | null } | null;

export function onExpiry(status: ContainerStatus, now: number): 'keep' | 'stop' {
  if (!status || !status.busy) return 'stop';
  if (status.since != null && now - status.since > MAX_RUN_MS) return 'stop';
  return 'keep';
}
