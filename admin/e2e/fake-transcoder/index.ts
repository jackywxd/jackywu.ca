/**
 * E2E 用的假轉碼器：模擬「容器」的外部行為——用簽章網址下載原檔、上傳兩個成品、回報完成。
 * 不跑 ffmpeg（那由 test/transcoder.test.ts 用真的 ffmpeg 驗證）；這裡驗證的是整條管線的 HTTP 契約：
 * 簽章網址、狀態轉移、poster 進媒體庫、畫面上的狀態變化。
 */
const POSTER_B64 = '/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAJABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAA//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAIN//Z';

interface Job { SRC_URL: string; OUT_URL: string; OUT_MP_URL: string; BEAT_URL: string; DONE_URL: string; HEADERS?: string }

async function work(env: Job) {
  const headers = env.HEADERS ? (JSON.parse(env.HEADERS) as Record<string, string>) : {};
  const done = (body: unknown) => fetch(env.DONE_URL, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const src = await fetch(env.SRC_URL, { headers });
    if (!src.ok) throw new Error('下載原檔失敗 ' + src.status);
    const bytes = new Uint8Array(await src.arrayBuffer());
    const mp4 = new Uint8Array(bytes.length + 8).fill(1);          // 假的成品：長度與原檔不同，才驗得出是新寫的
    // 與真的容器一樣：先送一次心跳；mp4 分段寫（開始 → 一段 → 完成），poster 單次寫
    const beat = await fetch(env.BEAT_URL, { method: 'POST', headers });
    if (!beat.ok) throw new Error('心跳失敗 ' + beat.status);
    const mp = (op: string, extra = '') => env.OUT_MP_URL.replace('{op}', op).replace('{name}', '1080p.mp4') + extra;
    const st = await fetch(mp('out-start'), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
    if (!st.ok) throw new Error('開始分段上傳失敗 ' + st.status);
    const { uploadId } = (await st.json()) as { uploadId: string };
    const pt = await fetch(mp('out-part', `&uploadId=${encodeURIComponent(uploadId)}&part=1`), { method: 'PUT', headers: { ...headers, 'content-length': String(mp4.length) }, body: mp4 as unknown as BodyInit });
    if (!pt.ok) throw new Error('上傳分段失敗 ' + pt.status);
    const cp = await fetch(mp('out-complete', `&uploadId=${encodeURIComponent(uploadId)}`), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ parts: [await pt.json()] }) });
    if (!cp.ok) throw new Error('完成分段上傳失敗 ' + cp.status);
    const poster = Uint8Array.from(atob(POSTER_B64), (c) => c.charCodeAt(0));
    const r = await fetch(env.OUT_URL.replace('{name}', 'poster.jpg'), { method: 'PUT', headers: { ...headers, 'content-type': 'image/jpeg', 'content-length': String(poster.length) }, body: poster as unknown as BodyInit });
    if (!r.ok) throw new Error('上傳 poster.jpg 失敗 ' + r.status);
    await done({ ok: true, duration: 3, bytes: mp4.length, width: 1920, height: 1080, mode: 'fake' });
  } catch (e) {
    await done({ ok: false, error: String((e as Error).message) });
  }
}

export default {
  async fetch(req: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/start') return new Response('not found', { status: 404 });
    const { env } = (await req.json()) as { jobId: string; env: Job };
    ctx.waitUntil(work(env)); // 立刻回 202，之後自己做完回報，跟真的容器一樣
    return new Response('started', { status: 202 });
  },
};
