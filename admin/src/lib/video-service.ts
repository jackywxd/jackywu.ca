/**
 * 影片：分段上傳原檔到私有 bucket、交給轉碼容器、收回成品。
 * 判斷全在 video-job.ts（狀態機）與 internal-token.ts（簽章）；這裡只負責接 R2 與 Payload。
 */
import type { Payload } from 'payload';
import { signToken, verifyToken, type Scope } from './internal-token';
import type { Bindings } from './bindings';
import * as J from './video-job';

export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
export const ALLOWED: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v' };
export const RATIOS = ['16/9', '9/16', '4/3', '1/1'] as const;

export interface VideoDeps {
  payload: Payload; b: Bindings; now: () => number; secret: string; adminUrl: string;
  /** 給容器的 Access 服務憑證（讓它的請求通過 Cloudflare Access） */
  accessHeaders: () => Record<string, string>;
  log?: (m: string) => void;
}

type ReelRow = { id: number | string; title: string; videoId: string; posterAlt?: string | null; transcode?: { status?: J.JobStatus; attempts?: number; error?: string | null; sourceKey?: string | null; uploadId?: string | null; startedAt?: number | null; finishedAt?: number | null } | null };
const jobOf = (r: ReelRow): J.Job => ({ status: r.transcode?.status ?? 'none', attempts: r.transcode?.attempts ?? 0, error: r.transcode?.error, startedAt: r.transcode?.startedAt, finishedAt: r.transcode?.finishedAt });
const load = async (d: VideoDeps, id: string) => (await d.payload.findByID({ collection: 'reels', id, draft: true, depth: 0, overrideAccess: true })) as unknown as ReelRow;
const save = (d: VideoDeps, id: string | number, job: J.Job, extra: Record<string, unknown> = {}, tc: Record<string, unknown> = {}) =>
  d.payload.update({ collection: 'reels', id, draft: true, overrideAccess: true, data: { ...extra, transcode: { status: job.status, attempts: job.attempts, error: job.error ?? null, startedAt: job.startedAt ?? null, finishedAt: job.finishedAt ?? null, ...tc } } as never });

/** 近似比例：取最接近的一個（影片可能是 1920×1080、1080×1920、1440×1080…） */
export function ratioOf(w: number, h: number): (typeof RATIOS)[number] {
  const v = Math.log(w / h);
  return [...RATIOS].sort((a, b) => Math.abs(v - Math.log(eval2(a))) - Math.abs(v - Math.log(eval2(b))))[0]!;
}
const eval2 = (r: string) => { const [a, b] = r.split('/').map(Number); return a! / b!; };

const slugify = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

/* ───────── 上傳 ───────── */

export async function initUpload(d: VideoDeps, a: { filename: string; size: number; contentType: string; title?: string }) {
  const ext = ALLOWED[a.contentType];
  if (!ext) return { error: `不支援的影片格式：${a.contentType || '未知'}（支援 mp4、mov、m4v）` };
  if (!(a.size > 0) || a.size > MAX_VIDEO_BYTES) return { error: `檔案大小不合理（上限 4 GB）：${a.size}` };
  // videoId 是公開網址的一部分（media.jackywu.ca/video/<id>/…）：小寫英數連字號，加 4 碼隨機避免撞名
  const rnd = [...crypto.getRandomValues(new Uint8Array(3))].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 4);
  const videoId = `${slugify(a.filename)}-${rnd}`;
  const key = `video-src/${videoId}/original.${ext}`;
  const mp = await d.b.R2.createMultipartUpload(key, { httpMetadata: { contentType: a.contentType } });
  const reel = await d.payload.create({
    collection: 'reels', draft: true, overrideAccess: true,
    data: { title: a.title?.trim() || a.filename.replace(/\.[^.]+$/, ''), videoId, transcode: { status: 'uploading', attempts: 0, sourceKey: key, uploadId: mp.uploadId } } as never,
  });
  return { reelId: reel.id, videoId, uploadId: mp.uploadId, key, partSize: PART_SIZE };
}

export async function uploadPart(d: VideoDeps, reelId: string, uploadId: string, part: number, body: ReadableStream | ArrayBuffer) {
  const r = await load(d, reelId);
  if (jobOf(r).status !== 'uploading' || r.transcode?.uploadId !== uploadId) return { error: '這個上傳已經結束或不存在' as const };
  if (!Number.isInteger(part) || part < 1 || part > 10_000) return { error: '分段編號不對' as const };
  const up = d.b.R2.resumeMultipartUpload(r.transcode!.sourceKey!, uploadId);
  const p = await up.uploadPart(part, body as never);
  return { etag: p.etag, partNumber: part };
}

export async function completeUpload(d: VideoDeps, reelId: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
  const r = await load(d, reelId);
  if (jobOf(r).status !== 'uploading' || r.transcode?.uploadId !== uploadId) return { error: '這個上傳已經結束或不存在' as const };
  if (!parts.length) return { error: '沒有任何分段' as const };
  const up = d.b.R2.resumeMultipartUpload(r.transcode!.sourceKey!, uploadId);
  await up.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
  await save(d, reelId, J.uploaded(jobOf(r)), {}, { sourceKey: r.transcode!.sourceKey, uploadId: null });
  await kick(d, reelId);
  return { ok: true as const };
}

/** 放棄上傳：收掉 R2 上沒完成的分段與這個還沒用的 reel（只動這一個上傳自己建的） */
export async function abortUpload(d: VideoDeps, reelId: string, uploadId: string) {
  const r = await load(d, reelId);
  if (jobOf(r).status !== 'uploading' || r.transcode?.uploadId !== uploadId) return { error: '這個上傳已經結束或不存在' as const };
  await d.b.R2.resumeMultipartUpload(r.transcode!.sourceKey!, uploadId).abort();
  await d.payload.delete({ collection: 'reels', id: reelId, overrideAccess: true });
  return { ok: true as const };
}

/* ───────── 交給轉碼容器 ───────── */

const url = (d: VideoDeps, path: string, reel: string | number, scope: Scope, sig: { exp: number; sig: string }, extra = '') =>
  `${d.adminUrl}/api/video/internal/${path}?reel=${reel}&exp=${sig.exp}&sig=${sig.sig}${extra}`;

export async function kick(d: VideoDeps, reelId: string | number): Promise<'started' | 'not-ready' | 'no-transcoder' | 'failed'> {
  const r = await load(d, String(reelId));
  const job = jobOf(r);
  if (job.status !== 'queued') return 'not-ready';
  const t = d.b.TRANSCODER;
  if (!t) { d.log?.('沒有 TRANSCODER 綁定，轉碼工作維持排隊'); return 'no-transcoder'; }
  const sig = (scope: Scope) => signToken(d.secret, String(reelId), scope, Math.floor(d.now() / 1000));
  const [src, out, done] = await Promise.all([sig('src'), sig('out'), sig('done')]);
  const env = {
    SRC_URL: url(d, 'src', reelId, 'src', src),
    // {name} 由容器填入（1080p.mp4 或 poster.jpg）；簽章涵蓋整個 out 範圍，容器只能寫這支影片的這兩個檔名
    OUT_URL: url(d, 'out', reelId, 'out', out, '&name={name}'),
    DONE_URL: url(d, 'done', reelId, 'done', done),
    HEADERS: JSON.stringify(d.accessHeaders()),
  };
  // 先標成進行中、再叫容器：容器一收到就可能開始回寫成品，狀態不能落後於它（寫成品的端點只收「進行中」）
  const running = J.start(job, d.now());
  await save(d, reelId, running, {}, { sourceKey: r.transcode?.sourceKey });
  try {
    const res = await t.fetch(new Request('https://transcoder/start', { method: 'POST', body: JSON.stringify({ jobId: String(reelId), env }), headers: { 'content-type': 'application/json' } }));
    if (!res.ok) throw new Error(`轉碼服務回 ${res.status}`);
  } catch (e) {
    d.log?.(`轉碼服務叫不動：${(e as Error).message}`);
    // 叫不動不算一次嘗試：回到排隊（次數不變），看門狗稍後再試；原因留在 error 讓人看得到
    await save(d, reelId, { ...job, error: `叫不動轉碼服務：${(e as Error).message}` }, {}, { sourceKey: r.transcode?.sourceKey });
    return 'failed';
  }
  return 'started';
}

/* ───────── 容器 → 後台 ───────── */

export async function checkToken(d: VideoDeps, reel: string | null, scope: Scope, exp: string | null, sig: string | null) {
  if (!reel || !/^\d+$/.test(reel)) return { ok: false as const, reason: '影片 id 不對' };
  return verifyToken(d.secret, reel, scope, exp, sig, Math.floor(d.now() / 1000));
}

export async function internalSource(d: VideoDeps, reelId: string, range: string | null) {
  const r = await load(d, reelId);
  const key = r.transcode?.sourceKey;
  if (!key) return null;
  // R2 的 get 不吃 Range 標頭字串，要拆成 offset/length；只支援 bytes=a-b 與 bytes=a-
  const m = range?.match(/^bytes=(\d+)-(\d*)$/);
  const obj = await d.b.R2.get(key, m ? { range: { offset: Number(m[1]), ...(m[2] ? { length: Number(m[2]) - Number(m[1]) + 1 } : {}) } } : undefined);
  return obj;
}

export const OUT_NAMES = new Set(['1080p.mp4', 'poster.jpg']);

export async function internalOut(d: VideoDeps, reelId: string, name: string, body: ReadableStream | ArrayBuffer | null, size: number) {
  if (!OUT_NAMES.has(name)) return { error: `不允許的檔名：${name}` as const };
  if (!body) return { error: '沒有內容' as const };
  if (name === 'poster.jpg' && size > 5 * 1024 * 1024) return { error: 'poster 太大' as const };
  const r = await load(d, reelId);
  if (jobOf(r).status !== 'running') return { error: '這支影片現在不在轉碼中' as const };
  const type = name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  // R2 的串流寫入要事先知道長度：用 FixedLengthStream 把進來的請求本文接上去（不必整個吃進記憶體）
  let payload: ReadableStream | ArrayBuffer = body;
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => { readable: ReadableStream; writable: WritableStream } }).FixedLengthStream;
  if (body instanceof ReadableStream) {
    if (FLS) {
      const f = new FLS(size);
      void body.pipeTo(f.writable);
      payload = f.readable;
    } else {
      // 不是 workerd（本機測試／CLI）：沒有 FixedLengthStream，成品很小，直接讀進記憶體
      payload = await new Response(body).arrayBuffer();
    }
  }
  await d.b.R2.put(`video/${r.videoId}/${name}`, payload as never, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  return { ok: true as const };
}

export interface DoneBody { ok: boolean; error?: string; duration?: number; bytes?: number; width?: number; height?: number; mode?: string }

export async function internalDone(d: VideoDeps, reelId: string, b: DoneBody): Promise<{ status: J.JobStatus }> {
  const r = await load(d, reelId);
  const job = jobOf(r);
  if (job.status !== 'running') return { status: job.status }; // 冪等：重複回報、或已被看門狗收掉
  const now = d.now();

  if (b.ok) {
    // 光回報成功不算數：成品必須真的在 R2 上，大小對得上
    const mp4 = await d.b.R2.head(`video/${r.videoId}/1080p.mp4`);
    const poster = await d.b.R2.get(`video/${r.videoId}/poster.jpg`);
    if (!mp4 || !poster || (b.bytes && mp4.size !== b.bytes)) {
      await save(d, reelId, J.fail(job, '回報成功，但成品不在儲存空間裡或大小不符', now), {}, { sourceKey: r.transcode?.sourceKey });
      await kick(d, reelId);
      return { status: 'queued' };
    }
    // poster 要進媒體庫（前台建置時由 astro:assets 處理）。內容是從影片抽出的畫面，沒有 EXIF
    const media = await d.payload.create({
      collection: 'media', overrideAccess: true,
      data: { alt: r.posterAlt || r.title, kind: 'img' },
      file: { data: Buffer.from(await poster.arrayBuffer()), mimetype: 'image/jpeg', name: `${r.videoId}-poster.jpg`, size: poster.size },
    });
    await save(d, reelId, J.finish(job, now), {
      poster: media.id, posterAlt: r.posterAlt || r.title, duration: Math.max(1, Math.round(b.duration ?? 0)), bytes: mp4.size, ratio: b.width && b.height ? ratioOf(b.width, b.height) : '16/9',
    }, { sourceKey: r.transcode?.sourceKey });
    return { status: 'done' };
  }

  const next = J.fail(job, b.error ?? '轉碼失敗', now);
  await save(d, reelId, next, {}, { sourceKey: r.transcode?.sourceKey });
  if (next.status === 'queued') await kick(d, reelId); // 自動重試
  return { status: next.status };
}

/* ───────── 看門狗與重試 ───────── */

export async function sweepVideos(d: VideoDeps) {
  const rows = (await d.payload.find({ collection: 'reels', draft: true, where: { 'transcode.status': { in: ['queued', 'running'] } }, limit: 200, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as ReelRow[];
  let changed = 0;
  for (const r of rows) {
    const job = jobOf(r), next = J.sweep(job, d.now());
    if (next !== job) { await save(d, r.id, next, {}, { sourceKey: r.transcode?.sourceKey }); changed++; }
    if (next.status === 'queued') await kick(d, r.id);
  }
  return { changed };
}

export async function retryVideo(d: VideoDeps, reelId: string) {
  const r = await load(d, reelId);
  await save(d, reelId, J.retry(jobOf(r)), {}, { sourceKey: r.transcode?.sourceKey });
  return kick(d, reelId);
}
