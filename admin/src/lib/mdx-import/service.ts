/**
 * 導入外部 MDX：解析、上傳隨附的圖片、建立文章草稿。
 *
 * 兩階段：converter 的 resolveImage 是同步的，建媒體是非同步的，所以第一遍只「收集」要用到哪些圖，
 * 上傳完拿到 id 之後再轉一遍。本機路徑的圖一併上傳；外站圖片不轉存（converter 已改成「待補圖」）。
 */
import type { Payload } from 'payload';
import { unzipSync } from 'fflate';
import { imageGps } from '../exif';
import { sha256Hex } from '../media-client';
import { frontmatterToTale } from './frontmatter';
import { mdxToLexical, parseFrontmatter, type Problem } from './index';

export const LIMITS = { totalBytes: 80 * 1024 * 1024, files: 300, mdxBytes: 2 * 1024 * 1024 } as const;
export const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export interface InFile { path: string; data: Uint8Array }

/** 路徑一律正規化成不含 ./ 的相對路徑，且擋掉往上跳與絕對路徑 */
export function normalizePath(p: string): string | null {
  const s = decodeURIComponent(p).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || s.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(s) || /^[a-z]:/i.test(s) || s.includes('\0')) return null;
  return s;
}

/** zip → 檔案清單。拒絕路徑穿越、太多檔案、解壓後太大（zip 炸彈） */
export function readZip(data: Uint8Array): InFile[] {
  const out: InFile[] = [];
  let total = 0;
  const files = unzipSync(data, { filter: (f) => { if (f.originalSize > LIMITS.totalBytes) throw new Error('壓縮檔裡有單一檔案太大'); return !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/'); } });
  for (const [name, bytes] of Object.entries(files)) {
    const p = normalizePath(name);
    if (!p) throw new Error(`壓縮檔裡有不合法的路徑：${name}`);
    total += bytes.length;
    if (total > LIMITS.totalBytes) throw new Error('壓縮檔解開後太大（上限 80 MB）');
    out.push({ path: p, data: bytes });
    if (out.length > LIMITS.files) throw new Error(`壓縮檔裡的檔案太多（上限 ${LIMITS.files}）`);
  }
  return out;
}

const extOf = (p: string) => p.split('.').pop()?.toLowerCase() ?? '';

export interface ImportOutcome {
  id: number | string; problems: Problem[]; missing: string[]; issues: { field: string; message: string }[]; unknown: string[];
  images: { uploaded: number; reused: number };
}

export async function importMdx(payload: Payload, files: InFile[]): Promise<ImportOutcome | { error: string; problems?: Problem[] }> {
  const mdxFiles = files.filter((f) => /\.mdx?$/i.test(f.path));
  if (mdxFiles.length !== 1) return { error: mdxFiles.length === 0 ? '找不到 .md 或 .mdx 檔' : `一次只能導入一篇，但收到 ${mdxFiles.length} 個 .md/.mdx 檔` };
  const main = mdxFiles[0]!;
  if (main.data.length > LIMITS.mdxBytes) return { error: '文章檔案太大（上限 2 MB）' };
  const source = new TextDecoder('utf-8', { fatal: true }).decode(main.data);
  const dir = main.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';

  const byPath = new Map(files.map((f) => [f.path, f]));
  const byBase = new Map<string, InFile[]>();
  for (const f of files) { const b = f.path.split('/').pop()!; byBase.set(b, [...(byBase.get(b) ?? []), f]); }
  const find = (src: string): InFile | null => {
    const n = normalizePath(src);
    if (!n) return null;
    const hit = byPath.get(dir + n) ?? byPath.get(n);
    if (hit) return hit;
    const cands = byBase.get(n.split('/').pop()!) ?? [];
    return cands.length === 1 ? cands[0]! : null; // 同名不只一個就不猜
  };

  // 第一遍：收集要用到的圖
  const wanted = new Map<string, { file: InFile; alt: string }>();
  mdxToLexical(source, {
    resolveImage: ({ src, alt }) => { const f = find(src); if (!f || !IMAGE_TYPES[extOf(f.path)]) return null; if (!wanted.has(f.path)) wanted.set(f.path, { file: f, alt }); return `@@${f.path}`; },
  });

  // 上傳（依內容雜湊去重；伺服器端的 GPS 檢查在 Media 的 hook 裡）
  const ids = new Map<string, number | string>();
  let uploaded = 0, reused = 0;
  const errors: Problem[] = [];
  for (const [path, { file, alt }] of wanted) {
    const type = IMAGE_TYPES[extOf(path)]!;
    const sha = await sha256Hex(file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer);
    const dup = await payload.find({ collection: 'media', where: { sha256: { equals: sha } }, limit: 1, depth: 0, overrideAccess: true });
    if (dup.docs[0]) { ids.set(path, dup.docs[0].id); reused++; continue; }
    const gps = imageGps(file.data, type);
    if (gps !== 'none') { errors.push({ level: 'error', where: path, message: gps === 'gps' ? `圖片 ${path} 含有 GPS 位置資訊，沒有匯入` : `圖片 ${path} 無法讀取，沒有匯入` }); continue; }
    try {
      const doc = await payload.create({
        collection: 'media', overrideAccess: true,
        data: { alt: alt || path.split('/').pop()!.replace(/\.[^.]+$/, ''), sha256: sha, kind: 'img' },
        file: { data: Buffer.from(file.data), mimetype: type, name: path.split('/').pop()!, size: file.data.length },
      });
      ids.set(path, doc.id); uploaded++;
    } catch (e) { errors.push({ level: 'error', where: path, message: `圖片 ${path} 上傳失敗：${(e as Error).message}` }); }
  }

  // 影片與路線：用既有的（內容 id → 文件 id）
  const reels = (await payload.find({ collection: 'reels', limit: 500, depth: 0, pagination: false, draft: true, overrideAccess: true })).docs as unknown as { id: number; videoId: string; date: string }[];
  const routes = (await payload.find({ collection: 'routes', limit: 500, depth: 0, pagination: false, draft: true, overrideAccess: true })).docs as unknown as { id: number; slug: string }[];

  // 第二遍：真的轉
  const r = mdxToLexical(source, {
    resolveImage: ({ src }) => { const f = find(src); return f ? (ids.get(f.path) ?? null) : null; },
    resolveReel: (entry) => reels.find((x) => `${x.date.slice(0, 4)}/${x.videoId}` === entry)?.id ?? null,
    resolveRoute: (slug) => routes.find((x) => x.slug === slug || slug.endsWith(`/${x.slug}`))?.id ?? null,
  });
  // 圖片上傳失敗已另外回報；converter 對同一張圖的「找不到」是重複訊息，保留一份即可
  const problems = [...errors, ...r.problems.filter((p) => !errors.some((e) => p.message.includes(e.where)))];

  const fallback = (dir ? dir.replace(/\/$/, '').split('/').pop()! : main.path.replace(/\.mdx?$/i, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const t = frontmatterToTale(r.frontmatter, fallback || undefined);
  const fm = r.frontmatter as Record<string, unknown>;
  const heroPath = typeof fm.hero === 'string' ? find(fm.hero) : null;
  const doc = await payload.create({
    collection: 'tales', draft: true, overrideAccess: true,
    data: {
      ...t.data, content: r.state,
      hero: heroPath ? (ids.get(heroPath.path) ?? null) : null,
      video: typeof fm.video === 'string' ? (reels.find((x) => `${x.date.slice(0, 4)}/${x.videoId}` === fm.video)?.id ?? null) : null,
      route: typeof fm.route === 'string' ? (routes.find((x) => x.slug === fm.route || String(fm.route).endsWith(`/${x.slug}`))?.id ?? null) : null,
    } as never,
  });
  return { id: doc.id, problems, missing: t.missing, issues: t.issues, unknown: t.unknown, images: { uploaded, reused } };
}
