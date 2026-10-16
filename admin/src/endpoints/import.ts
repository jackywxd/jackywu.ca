import type { Endpoint, PayloadRequest } from 'payload';
import { importMdx, LIMITS, normalizePath, readZip, type InFile } from '../lib/mdx-import/service';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const isOwner = (req: PayloadRequest) => (req.user as { role?: string } | null)?.role === 'owner';

export const importEndpoints: Endpoint[] = [
  {
    // 導入外部 MDX：一個 .md/.mdx（可附圖片），或一個 zip。建立成新的草稿，不碰任何既有文章
    path: '/ingest/mdx', method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return json({ error: '需要登入' }, 401);
      if (Number(req.headers.get('content-length') ?? 0) > LIMITS.totalBytes + 1024 * 1024) return json({ error: '檔案太大（上限 80 MB）' }, 413);
      let fd: FormData;
      try { fd = await req.formData!(); } catch { return json({ error: '需要 multipart 表單' }, 400); }

      let files: InFile[] = [];
      try {
        for (const v of fd.getAll('files')) {
          if (!(v instanceof File)) continue;
          const data = new Uint8Array(await v.arrayBuffer());
          if (/\.zip$/i.test(v.name)) files.push(...readZip(data));
          else {
            // 資料夾上傳時瀏覽器會把相對路徑放在 name（由前端送 webkitRelativePath）
            const p = normalizePath(v.name);
            if (!p) return json({ error: `不合法的檔名：${v.name}` }, 400);
            files.push({ path: p, data });
          }
        }
      } catch (e) { return json({ error: (e as Error).message }, 422); }
      if (!files.length) return json({ error: '沒有收到檔案' }, 400);
      if (files.length > LIMITS.files) return json({ error: `檔案太多（上限 ${LIMITS.files}）` }, 422);
      // 資料夾上傳會多帶一層資料夾名；統一把共同的最上層資料夾拿掉，路徑才對得上文章裡的相對路徑
      const top = files[0]!.path.split('/')[0]!;
      if (files.length > 1 && files.every((f) => f.path.startsWith(`${top}/`))) files = files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) })).concat([]);

      try {
        const r = await importMdx(req.payload, files);
        return 'error' in r ? json(r, 422) : json(r, 201);
      } catch (e) {
        return json({ error: `導入失敗：${(e as Error).message}` }, 500);
      }
    },
  },
];
