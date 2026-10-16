/**
 * E2E 用的假轉碼器：模擬「容器」的外部行為——用簽章網址下載原檔、上傳兩個成品、回報完成。
 * 不跑 ffmpeg（那由 test/transcoder.test.ts 用真的 ffmpeg 驗證）；這裡驗證的是整條管線的 HTTP 契約：
 * 簽章網址、狀態轉移、poster 進媒體庫、畫面上的狀態變化。
 */
const POSTER_B64 = '/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAJABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAA//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAIN//Z';

interface Job { SRC_URL: string; OUT_URL: string; DONE_URL: string; HEADERS?: string }

async function work(env: Job) {
  const headers = env.HEADERS ? (JSON.parse(env.HEADERS) as Record<string, string>) : {};
  const done = (body: unknown) => fetch(env.DONE_URL, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const src = await fetch(env.SRC_URL, { headers });
    if (!src.ok) throw new Error('下載原檔失敗 ' + src.status);
    const bytes = new Uint8Array(await src.arrayBuffer());
    const mp4 = new Uint8Array(bytes.length + 8).fill(1);          // 假的成品：長度與原檔不同，才驗得出是新寫的
    const put = (name: string, body: Uint8Array, type: string) =>
      fetch(env.OUT_URL.replace('{name}', name), { method: 'PUT', headers: { ...headers, 'content-type': type, 'content-length': String(body.length) }, body: body as unknown as BodyInit });
    const poster = Uint8Array.from(atob(POSTER_B64), (c) => c.charCodeAt(0));
    for (const [r, label] of [[await put('1080p.mp4', mp4, 'video/mp4'), '1080p.mp4'], [await put('poster.jpg', poster, 'image/jpeg'), 'poster.jpg']] as const) {
      if (!r.ok) throw new Error('上傳 ' + label + ' 失敗 ' + r.status);
    }
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
