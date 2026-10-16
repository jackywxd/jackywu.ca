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

type ReelRow = { id: number | string; title: string; videoId: string; posterAlt?: string | null; transcode?: { status?: J.JobStatus; attempts?: number; error?: string | null; sourceKey?: string | null; uploadId?: string | null; startedAt?: number | null; finishedAt?: number | null; heartbeatAt?: number | null; uploadStartedAt?: number | null } | null };
const jobOf = (r: ReelRow): J.Job => ({ status: r.transcode?.status ?? 'none', attempts: r.transcode?.attempts ?? 0, error: r.transcode?.error, startedAt: r.transcode?.startedAt, finishedAt: r.transcode?.finishedAt, heartbeatAt: r.transcode?.heartbeatAt });
const load = async (d: VideoDeps, id: string) => (await d.payload.findByID({ collection: 'reels', id, draft: true, depth: 0, overrideAccess: true })) as unknown as ReelRow;
const save = (d: VideoDeps, id: string | number, job: J.Job, extra: Record<string, unknown> = {}, tc: Record<string, unknown> = {}) =>
  d.payload.update({ collection: 'reels', id, draft: true, overrideAccess: true, data: { ...extra, transcode: { status: job.status, attempts: job.attempts, error: job.error ?? null, startedAt: job.startedAt ?? null, finishedAt: job.finishedAt ?? null, heartbeatAt: job.heartbeatAt ?? null, ...tc } } as never });

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
    data: { title: a.title?.trim() || a.filename.replace(/\.[^.]+$/, ''), videoId, transcode: { status: 'uploading', attempts: 0, sourceKey: key, uploadId: mp.uploadId, uploadStartedAt: d.now() } } as never,
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
  const obj = await up.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
  // 分段數沒有上限檢查的話，宣告 1GB 的上傳可以實際送進遠超過上限的東西
  if (obj.size > MAX_VIDEO_BYTES) {
    await d.b.R2.delete(r.transcode!.sourceKey!);
    await save(d, reelId, { ...jobOf(r), status: 'failed', error: `檔案超過 4 GB 上限（${obj.size} 位元組）` }, {}, { sourceKey: r.transcode!.sourceKey, uploadId: null });
    return { error: '檔案超過 4 GB 上限' as const };
  }
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

const url = (d: VideoDeps, path: string, reel: string | number, attempt: number, sig: { exp: number; sig: string }, extra = '') =>
  `${d.adminUrl}/api/video/internal/${path}?reel=${reel}&a=${attempt}&exp=${sig.exp}&sig=${sig.sig}${extra}`;

export async function kick(d: VideoDeps, reelId: string | number): Promise<'started' | 'not-ready' | 'no-transcoder' | 'failed'> {
  const r = await load(d, String(reelId));
  const job = jobOf(r);
  if (job.status !== 'queued') return 'not-ready';
  const t = d.b.TRANSCODER;
  if (!t) { d.log?.('沒有 TRANSCODER 綁定，轉碼工作維持排隊'); return 'no-transcoder'; }
  // 先標成進行中、再叫容器：容器一收到就可能開始回寫成品，狀態不能落後於它（寫成品的端點只收「進行中」）
  const running = J.start(job, d.now());
  const attempt = running.attempts;
  const sig = (scope: Scope) => signToken(d.secret, String(reelId), scope, attempt, Math.floor(d.now() / 1000));
  const [src, out, done, beat] = await Promise.all([sig('src'), sig('out'), sig('done'), sig('beat')]);
  const env = {
    SRC_URL: url(d, 'src', reelId, attempt, src),
    // poster 單次寫入；mp4 分段寫入（{op} 由容器填 out-start／out-part／out-complete）。簽章只涵蓋這支影片、這一次嘗試
    OUT_URL: url(d, 'out', reelId, attempt, out, '&name={name}'),
    OUT_MP_URL: url(d, '{op}', reelId, attempt, out, '&name={name}'),
    BEAT_URL: url(d, 'beat', reelId, attempt, beat),
    DONE_URL: url(d, 'done', reelId, attempt, done),
    HEADERS: JSON.stringify(d.accessHeaders()),
  };
  await save(d, reelId, running, {}, { sourceKey: r.transcode?.sourceKey });
  try {
    const res = await t.fetch(new Request('https://transcoder/start', { method: 'POST', body: JSON.stringify({ jobId: String(reelId), env }), headers: { 'content-type': 'application/json' } }));
    if (!res.ok) throw new Error(`轉碼服務回 ${res.status}`);
  } catch (e) {
    d.log?.(`轉碼服務叫不動：${(e as Error).message}`);
    // 叫不動不算一次嘗試：回到排隊（次數不變），看門狗稍後再試。上一次失敗的真正原因要留著，不能被這個蓋掉
    const why = `叫不動轉碼服務：${(e as Error).message}`;
    await save(d, reelId, { ...job, error: job.error ? `${job.error}（重試時${why}）` : why }, {}, { sourceKey: r.transcode?.sourceKey });
    return 'failed';
  }
  return 'started';
}

/* ───────── 容器 → 後台 ───────── */

export async function checkToken(d: VideoDeps, reel: string | null, scope: Scope, attempt: string | null, exp: string | null, sig: string | null) {
  if (!reel || !/^\d+$/.test(reel)) return { ok: false as const, reason: '影片 id 不對' };
  if (!attempt || !/^[1-9]\d{0,2}$/.test(attempt)) return { ok: false as const, reason: '嘗試次數不對' };
  return verifyToken(d.secret, reel, scope, Number(attempt), exp, sig, Math.floor(d.now() / 1000));
}

/** 寫入類的請求只收「這一次嘗試、而且還在進行中」：重試之後，舊容器的回寫一律拒收 */
async function current(d: VideoDeps, reelId: string, attempt: number) {
  const r = await load(d, reelId);
  const job = jobOf(r);
  if (job.status !== 'running') return { error: '這支影片現在不在轉碼中' as const, r, job };
  if (job.attempts !== attempt) return { error: '這一次的轉碼已經結束（已經重試）' as const, r, job };
  return { r, job };
}

/** 原檔整個回傳。容器不做斷點續傳；先前的 Range 支援回 206 卻沒有 Content-Range，是錯的 */
export async function internalSource(d: VideoDeps, reelId: string) {
  const r = await load(d, reelId);
  const key = r.transcode?.sourceKey;
  return key ? d.b.R2.get(key) : null;
}

export const OUT_NAMES = new Set(['1080p.mp4', 'poster.jpg']);
/** 單次寫入的上限：Workers 的請求本文上限約 100MB，大的成品要走分段 */
export const SINGLE_PUT_MAX = 90 * 1024 * 1024;
const outKey = (r: ReelRow, name: string) => `video/${r.videoId}/${name}`;
const outMeta = (name: string) => ({ httpMetadata: { contentType: name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });

export async function internalOut(d: VideoDeps, reelId: string, attempt: number, name: string, body: ReadableStream | ArrayBuffer | null, size: number) {
  if (!OUT_NAMES.has(name)) return { error: `不允許的檔名：${name}` as const };
  if (!body) return { error: '沒有內容' as const };
  if (name === 'poster.jpg' && size > 5 * 1024 * 1024) return { error: 'poster 太大' as const };
  const c = await current(d, reelId, attempt);
  if (c.error) return { error: c.error };
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
  await d.b.R2.put(outKey(c.r, name), payload as never, outMeta(name));
  return { ok: true as const };
}

/* 成品的分段寫入（mp4）：開始 → 各段 → 完成。每一步都檢查這一次嘗試還在進行中 */
export async function internalOutStart(d: VideoDeps, reelId: string, attempt: number, name: string) {
  if (name !== '1080p.mp4') return { error: `不允許分段寫入：${name}` as const };
  const c = await current(d, reelId, attempt);
  if (c.error) return { error: c.error };
  const mp = await d.b.R2.createMultipartUpload(outKey(c.r, name), outMeta(name));
  return { uploadId: mp.uploadId };
}
export async function internalOutPart(d: VideoDeps, reelId: string, attempt: number, name: string, uploadId: string, part: number, body: ReadableStream | ArrayBuffer) {
  if (name !== '1080p.mp4') return { error: `不允許分段寫入：${name}` as const };
  if (!Number.isInteger(part) || part < 1 || part > 10_000) return { error: '分段編號不對' as const };
  const c = await current(d, reelId, attempt);
  if (c.error) return { error: c.error };
  const p = await d.b.R2.resumeMultipartUpload(outKey(c.r, name), uploadId).uploadPart(part, body as never);
  return { partNumber: part, etag: p.etag };
}
export async function internalOutComplete(d: VideoDeps, reelId: string, attempt: number, name: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
  if (name !== '1080p.mp4') return { error: `不允許分段寫入：${name}` as const };
  if (!parts.length) return { error: '沒有任何分段' as const };
  const c = await current(d, reelId, attempt);
  if (c.error) return { error: c.error };
  await d.b.R2.resumeMultipartUpload(outKey(c.r, name), uploadId).complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
  return { ok: true as const };
}

/** 容器的心跳 */
export async function internalBeat(d: VideoDeps, reelId: string, attempt: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const c = await current(d, reelId, attempt);
  if (c.error) return { ok: false, reason: c.error };
  await save(d, reelId, J.beat(c.job, d.now()), {}, { sourceKey: c.r.transcode?.sourceKey });
  return { ok: true };
}

export interface DoneBody { ok: boolean; error?: string; duration?: number; bytes?: number; width?: number; height?: number; mode?: string }

/**
 * 結果回報。失敗時回到排隊，由看門狗（排程每 5 分鐘）重派——不在這個請求裡同步重叫：
 * 這個請求是容器發的，容器那時還沒空，同步重叫只會拿到 409，還把真正的錯誤訊息蓋掉。
 */
export async function internalDone(d: VideoDeps, reelId: string, attempt: number, b: DoneBody): Promise<{ status: J.JobStatus }> {
  const c = await current(d, reelId, attempt);
  if (c.error) return { status: c.job.status }; // 冪等：重複回報、已被看門狗收掉、或已經是下一次嘗試
  const { r, job } = c;
  const now = d.now();

  if (b.ok) {
    // 光回報成功不算數：成品必須真的在 R2 上，大小對得上
    const mp4 = await d.b.R2.head(outKey(r, '1080p.mp4'));
    const poster = await d.b.R2.get(outKey(r, 'poster.jpg'));
    if (!mp4 || !poster || (b.bytes && mp4.size !== b.bytes)) {
      const next = J.fail(job, '回報成功，但成品不在儲存空間裡或大小不符', now);
      await save(d, reelId, next, {}, { sourceKey: r.transcode?.sourceKey });
      return { status: next.status };
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
  return { status: next.status };
}

/* ───────── 看門狗與重試 ───────── */

/** 上傳到一半就沒下文（分頁關了）多久之後收掉 */
export const UPLOAD_STALE_MS = 24 * 60 * 60 * 1000;

export async function sweepVideos(d: VideoDeps) {
  const rows = (await d.payload.find({ collection: 'reels', draft: true, where: { 'transcode.status': { in: ['uploading', 'queued', 'running'] } }, limit: 200, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as ReelRow[];
  let changed = 0;
  for (const r of rows) {
    const job = jobOf(r);
    if (job.status === 'uploading') {
      const since = r.transcode?.uploadStartedAt;
      if (since != null && d.now() - since > UPLOAD_STALE_MS) {
        // 收掉 R2 上沒完成的分段（不收的話 R2 會保留到它自己的期限）；reel 留著，讓人看得到發生什麼事
        if (r.transcode?.sourceKey && r.transcode.uploadId) await d.b.R2.resumeMultipartUpload(r.transcode.sourceKey, r.transcode.uploadId).abort().catch(() => {});
        await save(d, r.id, { ...job, status: 'failed', error: '上傳沒有完成（超過一天沒有下文），請重新上傳' }, {}, { sourceKey: r.transcode?.sourceKey, uploadId: null });
        changed++;
      }
      continue;
    }
    const next = J.sweep(job, d.now());
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
