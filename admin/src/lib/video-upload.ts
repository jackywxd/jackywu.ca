/** 影片的瀏覽器端分段上傳。8 MB 一段、每段最多重試 3 次；整個上傳失敗就通知後台收掉（不留下半個影片）。 */
export const PART_SIZE = 8 * 1024 * 1024;

export interface Part { number: number; start: number; end: number }

export function planParts(size: number, partSize = PART_SIZE): Part[] {
  if (!(size > 0)) throw new Error('檔案是空的');
  const out: Part[] = [];
  for (let start = 0, n = 1; start < size; start += partSize, n++) out.push({ number: n, start, end: Math.min(size, start + partSize) });
  if (out.length > 10_000) throw new Error('檔案太大，分段超過 10,000 段');
  return out;
}

export interface UploadOpts { fetchFn?: typeof fetch; onProgress?: (done: number, total: number) => void; sleep?: (ms: number) => Promise<void>; title?: string }

export async function uploadVideo(file: Blob & { name: string; type: string }, o: UploadOpts = {}): Promise<{ reelId: number | string; videoId: string }> {
  const f = o.fetchFn ?? fetch, sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const post = async (path: string, body: unknown) => {
    const r = await f(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(j.error ?? `${path} 回 ${r.status}`));
    return j;
  };
  const init = await post('/api/video/init', { filename: file.name, size: file.size, contentType: file.type, title: o.title }) as { reelId: number | string; videoId: string; uploadId: string };
  const parts = planParts(file.size);
  const etags: { partNumber: number; etag: string }[] = [];
  let sent = 0;
  try {
    for (const p of parts) {
      const body = await file.slice(p.start, p.end).arrayBuffer();
      let last: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await f(`/api/video/part?reel=${init.reelId}&uploadId=${encodeURIComponent(init.uploadId)}&part=${p.number}`, { method: 'PUT', body });
          if (!r.ok) throw new Error(`第 ${p.number} 段回 ${r.status}`);
          etags.push({ partNumber: p.number, etag: ((await r.json()) as { etag: string }).etag });
          last = null; break;
        } catch (e) { last = e as Error; if (attempt < 2) await sleep(1000 * 2 ** attempt); }
      }
      if (last) throw last;
      sent += p.end - p.start;
      o.onProgress?.(sent, file.size);
    }
    await post('/api/video/complete', { reel: String(init.reelId), uploadId: init.uploadId, parts: etags });
  } catch (e) {
    // 失敗就收掉：R2 上的半成品與還沒用的 reel；收不掉也不要蓋過真正的錯誤
    await post('/api/video/abort', { reel: String(init.reelId), uploadId: init.uploadId }).catch(() => {});
    throw e;
  }
  return { reelId: init.reelId, videoId: init.videoId };
}
