import type { Endpoint, PayloadRequest } from 'payload';
import { bindings } from '../lib/bindings';
import { verify } from '../lib/hmac';
import * as V from '../lib/video-service';
import type { Scope } from '../lib/internal-token';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const isOwner = (req: PayloadRequest) => (req.user as { role?: string } | null)?.role === 'owner';
const err = (e: { error?: unknown }, status = 400) => json({ error: e.error }, status);

export function videoDepsFromEnv(req: PayloadRequest): V.VideoDeps {
  return {
    payload: req.payload, b: bindings(), now: () => Date.now(),
    secret: process.env.VIDEO_INTERNAL_SECRET ?? '', adminUrl: process.env.ADMIN_URL ?? '',
    // 給容器用的 Access 服務憑證。容器只拿得到這組（還有只對單一影片有效的簽章網址），其他憑證一律不給
    accessHeaders: () => ({ 'CF-Access-Client-Id': process.env.TRANSCODER_ACCESS_ID ?? '', 'CF-Access-Client-Secret': process.env.TRANSCODER_ACCESS_SECRET ?? '' }),
    log: (m) => console.log(JSON.stringify({ level: 'info', msg: `video: ${m}` })),
  };
}

type Deps = (req: PayloadRequest) => V.VideoDeps;

export function videoEndpoints(mk: Deps = videoDepsFromEnv, hmacSecret: () => string = () => process.env.PUBLISH_HMAC_SECRET ?? ''): Endpoint[] {
  const owner = (fn: (req: PayloadRequest, d: V.VideoDeps) => Promise<Response>) => async (req: PayloadRequest) => {
    if (!isOwner(req)) return json({ error: '需要登入' }, 401);
    return fn(req, mk(req));
  };
  const body = async (req: PayloadRequest) => { try { return JSON.parse(await req.text!()) as Record<string, unknown>; } catch { return null; } };

  /** 容器的請求：簽章網址是唯一的授權，影片 id、動作、期限都在簽章裡 */
  const internal = (scope: Scope, fn: (req: PayloadRequest, d: V.VideoDeps, reel: string, q: URLSearchParams) => Promise<Response>) => async (req: PayloadRequest) => {
    const q = new URL(req.url!).searchParams;
    const d = mk(req);
    const v = await V.checkToken(d, q.get('reel'), scope, q.get('exp'), q.get('sig'));
    if (!v.ok) return json({ error: v.reason }, 401);
    try { return await fn(req, d, q.get('reel')!, q); }
    catch (e) {
      // 簽章是對的，但這支影片已經不存在（例如被刪掉）：404，不是 500
      if ((e as { status?: number }).status === 404) return json({ error: '找不到這支影片' }, 404);
      throw e;
    }
  };

  return [
    { path: '/video/init', method: 'post', handler: owner(async (req, d) => {
      const b = await body(req);
      if (!b || typeof b.filename !== 'string' || typeof b.contentType !== 'string' || typeof b.size !== 'number') return json({ error: '參數不對' }, 400);
      const r = await V.initUpload(d, { filename: b.filename, size: b.size, contentType: b.contentType, title: typeof b.title === 'string' ? b.title : undefined });
      return r.error ? err(r, 422) : json(r, 201);
    }) },
    { path: '/video/part', method: 'put', handler: owner(async (req, d) => {
      const q = new URL(req.url!).searchParams;
      const buf = await req.arrayBuffer!();
      if (buf.byteLength === 0 || buf.byteLength > 100 * 1024 * 1024) return json({ error: '分段大小不對' }, 400);
      const r = await V.uploadPart(d, q.get('reel') ?? '', q.get('uploadId') ?? '', Number(q.get('part')), buf);
      return r.error ? err(r, 409) : json(r);
    }) },
    { path: '/video/complete', method: 'post', handler: owner(async (req, d) => {
      const b = await body(req);
      const parts = b?.parts;
      if (!b || typeof b.reel !== 'string' || typeof b.uploadId !== 'string' || !Array.isArray(parts)
        || !parts.every((p) => p && typeof p.partNumber === 'number' && typeof p.etag === 'string')) return json({ error: '參數不對' }, 400);
      const r = await V.completeUpload(d, b.reel, b.uploadId, parts);
      return r.error ? err(r, 409) : json(r);
    }) },
    { path: '/video/abort', method: 'post', handler: owner(async (req, d) => {
      const b = await body(req);
      if (!b || typeof b.reel !== 'string' || typeof b.uploadId !== 'string') return json({ error: '參數不對' }, 400);
      const r = await V.abortUpload(d, b.reel, b.uploadId);
      return r.error ? err(r, 409) : json(r);
    }) },
    { path: '/video/retry', method: 'post', handler: owner(async (req, d) => {
      const b = await body(req);
      if (!b || typeof b.reel !== 'string') return json({ error: '參數不對' }, 400);
      try { return json({ result: await V.retryVideo(d, b.reel) }); } catch (e) { return json({ error: (e as Error).message }, 409); }
    }) },

    { path: '/video/internal/src', method: 'get', handler: internal('src', async (req, d, reel) => {
      const obj = await V.internalSource(d, reel, req.headers.get('range'));
      if (!obj) return json({ error: '找不到原檔' }, 404);
      const range = req.headers.get('range');
      return new Response(obj.body, { status: range ? 206 : 200, headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'content-length': String(obj.size), 'accept-ranges': 'bytes' } });
    }) },
    { path: '/video/internal/out', method: 'put', handler: internal('out', async (req, d, reel, q) => {
      const size = Number(req.headers.get('content-length'));
      if (!(size > 0)) return json({ error: '需要 content-length' }, 411);
      const r = await V.internalOut(d, reel, q.get('name') ?? '', req.body as ReadableStream | null, size);
      return r.error ? err(r, 409) : json(r);
    }) },
    { path: '/video/internal/done', method: 'post', handler: internal('done', async (req, d, reel) => {
      const b = (await body(req)) as unknown as V.DoneBody | null;
      if (!b || typeof b.ok !== 'boolean') return json({ error: '參數不對' }, 400);
      return json(await V.internalDone(d, reel, b));
    }) },

    // 排程：與發佈的看門狗同一種簽章
    { path: '/video/sweep', method: 'post', handler: async (req) => {
      const text = await req.text!();
      const v = await verify(hmacSecret(), text, req.headers.get('x-signature'));
      if (!v.ok && !isOwner(req)) return json({ error: v.reason }, 401);
      return json(await V.sweepVideos(mk(req)));
    } },
  ];
}
