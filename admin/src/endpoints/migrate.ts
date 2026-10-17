import type { Endpoint, PayloadRequest } from 'payload';
import { applyCorpus, type ApplyInput } from '../lib/migration/apply-corpus';

/**
 * M4：把 git 內容搬進後台（admin/scripts/migrate-push.ts 呼叫）。只有本人：
 * 身分來自 Access（CLI 用 cloudflared access token 取得本人的 JWT），沒有另外的憑證或後門。
 * 兩個端點都是冪等的：重跑只補缺的，不覆蓋已存在的。
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const isOwner = (req: PayloadRequest) => (req.user as { role?: string } | null)?.role === 'owner';
const SHA256 = /^[0-9a-f]{64}$/;

export const migrateEndpoints: Endpoint[] = [
  {
    // 一個媒體檔：已有同一個 sha256 就回傳既有的 id
    path: '/migrate/media', method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return json({ error: '需要登入' }, 401);
      let fd: FormData;
      try { fd = await req.formData!(); } catch { return json({ error: '需要 multipart 表單' }, 400); }
      const file = fd.get('file'), alt = String(fd.get('alt') ?? ''), kind = String(fd.get('kind') ?? 'img'), sha256 = String(fd.get('sha256') ?? '');
      if (!(file instanceof File)) return json({ error: '缺少 file' }, 400);
      if (!SHA256.test(sha256)) return json({ error: 'sha256 格式不對' }, 400);
      if (!['img', 'video', 'gpx'].includes(kind)) return json({ error: 'kind 不對' }, 400);
      const data = Buffer.from(await file.arrayBuffer());
      const { createHash } = await import('node:crypto');
      if (createHash('sha256').update(data).digest('hex') !== sha256) return json({ error: '內容與 sha256 不符（傳輸中損壞？）' }, 422);

      const hit = (await req.payload.find({ collection: 'media', where: { sha256: { equals: sha256 } }, limit: 1, depth: 0, overrideAccess: true })).docs[0];
      if (hit) return json({ id: hit.id, existed: true });
      try {
        const doc = await req.payload.create({
          collection: 'media', overrideAccess: true, req,
          data: { alt, kind, sha256 } as never,
          file: { data, mimetype: file.type || 'application/octet-stream', name: file.name, size: data.byteLength },
        });
        return json({ id: doc.id, existed: false }, 201);
      } catch (e) {
        return json({ error: (e as Error).message }, (e as { status?: number }).status ?? 500);
      }
    },
  },
  {
    // 語料（媒體 id 已換成後台的）→ 影片、路線、文章、轉址
    path: '/migrate/apply', method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return json({ error: '需要登入' }, 401);
      let body: ApplyInput;
      try { body = JSON.parse(await req.text!()) as ApplyInput; } catch { return json({ error: '需要 JSON' }, 400); }
      const c = body?.corpus;
      if (!c || !Array.isArray(c.tales) || !Array.isArray(c.routes) || !Array.isArray(c.reels) || !Array.isArray(c.redirects) || typeof body.mediaIds !== 'object' || !Array.isArray(body.drafts)) {
        return json({ error: '語料格式不對' }, 400);
      }
      const report = await applyCorpus(req.payload, body);
      return json(report, report.errors.length ? 207 : 200);
    },
  },
];
