import type { Endpoint, PayloadRequest } from 'payload';
import { bindings } from '../lib/bindings';
import { MAX_GPX_BYTES, prepareRoute, validateMeta, type RouteMeta } from '../lib/route-ingest';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const isOwner = (req: PayloadRequest) => (req.user as { role?: string } | null)?.role === 'owner';
const FIELDS = ['slug', 'name', 'nameEn', 'realm', 'region', 'date', 'badge', 'elapsed', 'result', 'note', 'movingTime', 'startedAt'] as const;

export const routeEndpoints: Endpoint[] = [
  {
    // 上傳 GPX 建立一條路線草稿（路徑不能以集合名稱開頭：/routes/* 會被 Payload 當成 routes 集合的 REST 路由，回 404）：算距離與爬升、產三張 SVG，原檔放進私有 bucket
    path: '/ingest/gpx', method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return json({ error: '需要登入' }, 401);
      if (Number(req.headers.get('content-length') ?? 0) > MAX_GPX_BYTES + 64 * 1024) return json({ errors: [{ field: 'gpx', message: 'GPX 檔案太大（上限 20 MB）' }] }, 413);
      let fd: FormData;
      try { fd = await req.formData!(); } catch { return json({ error: '需要 multipart 表單' }, 400); }
      const file = fd.get('gpx');
      const meta: Partial<RouteMeta> = {};
      for (const k of FIELDS) { const v = fd.get(k); if (typeof v === 'string') meta[k] = v; }
      // 沒附 GPX 也要把其他欄位的問題一次列完，使用者才不必改一個、送一次、再看下一個
      if (!(file instanceof File)) return json({ errors: [...validateMeta(meta), { field: 'gpx', message: '請選擇 GPX 檔案' }] }, 422);
      const text = await file.text();
      const p = prepareRoute(meta, text);
      if (!p.ok) return json({ errors: p.errors }, 422);

      const slug = String(p.data.slug);
      const dup = await req.payload.count({ collection: 'routes', where: { slug: { equals: slug } }, overrideAccess: true });
      if (dup.totalDocs) return json({ errors: [{ field: 'slug', message: `網址代稱「${slug}」已經有另一條路線在用，請換一個` }] }, 422);

      const key = `gpx/${slug}.gpx`;
      await bindings().R2.put(key, text, { httpMetadata: { contentType: 'application/gpx+xml', cacheControl: 'public, max-age=3600' } });
      try {
        const doc = await req.payload.create({ collection: 'routes', draft: true, overrideAccess: true, data: { ...p.data, hasGpx: true } as never });
        return json({ id: doc.id, stats: p.stats }, 201);
      } catch (e) {
        await bindings().R2.delete(key); // 建文件失敗，不留下沒人認領的檔案（只刪我們剛寫的這一個 key）
        return json({ error: `建立路線失敗：${(e as Error).message}` }, 500);
      }
    },
  },
];
