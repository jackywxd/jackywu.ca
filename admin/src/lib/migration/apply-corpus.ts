/**
 * M4：把 git 語料（readGitCorpus 的輸出）寫進後台。跑在後台 Worker 裡（/api/migrate/apply），用真的 D1。
 *
 * 規則：
 *  · 冪等：以自然鍵找既有的（影片 videoId、路線與文章 slug、轉址 from）。已存在的一律略過，不覆蓋——
 *    遷移之後在後台改過的內容，重跑也不會被蓋回 git 的版本。
 *  · 媒體先由 /api/migrate/media 逐一上傳，這裡只拿到「語料 id → 後台 id」的對照；正文裡的引用用 remapRefs 換掉，
 *    換不到就丟錯（不會留下指向別張圖的 id）。
 *  · git 裡已上線的文章直接寫成已發佈（線上本來就有，不需要再經過發佈佇列）；草稿維持草稿。
 *  · 影片在公開 bucket 早就有成品，所以轉碼狀態直接是 done（否則之後重新發佈會被「還沒轉碼完成」擋下）。
 */
import type { Payload } from 'payload';
import type { Corpus } from '../../../../packages/content-sync/files';
import { remapRefs, type IdMap } from '../../../../packages/content-sync/request';

export interface ApplyInput {
  corpus: Corpus;
  /** 語料的媒體 id → 後台的媒體 id */
  mediaIds: Record<string, string | number>;
  /** 「年/slug」：git 裡標成草稿的文章 */
  drafts: string[];
}

export interface ApplyReport {
  created: { reels: string[]; routes: string[]; tales: string[]; redirects: number };
  skipped: { reels: string[]; routes: string[]; tales: string[]; redirects: number };
  errors: string[];
}

type Doc = Record<string, unknown>;
const strip = (d: Doc, keys: string[]) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k)));

export async function applyCorpus(payload: Payload, input: ApplyInput): Promise<ApplyReport> {
  const report: ApplyReport = {
    created: { reels: [], routes: [], tales: [], redirects: 0 },
    skipped: { reels: [], routes: [], tales: [], redirects: 0 },
    errors: [],
  };
  const map: IdMap = {
    media: new Map(Object.entries(input.mediaIds).map(([k, v]) => [String(k), v])),
    reels: new Map(),
    routes: new Map(),
  };
  const find = async (collection: 'reels' | 'routes' | 'tales', field: string, value: string) =>
    (await payload.find({ collection, where: { [field]: { equals: value } }, limit: 1, depth: 0, draft: true, overrideAccess: true })).docs[0] as unknown as Doc | undefined;

  // 影片：poster 引用媒體
  for (const r of input.corpus.reels) {
    try {
      const hit = await find('reels', 'videoId', r.videoId);
      if (hit) { map.reels.set(String(r.id), hit.id as string | number); report.skipped.reels.push(r.videoId); continue; }
      const data = remapRefs('reels', strip(r as unknown as Doc, ['id']), map);
      const doc = await payload.create({ collection: 'reels', overrideAccess: true, data: { ...data, transcode: { status: 'done' }, _status: 'published' } as never });
      map.reels.set(String(r.id), doc.id);
      report.created.reels.push(r.videoId);
    } catch (e) { report.errors.push(`影片 ${r.videoId}：${(e as Error).message}`); }
  }

  // 路線：三張 SVG 的欄位對 API 唯讀，overrideAccess 才寫得進去
  for (const r of input.corpus.routes) {
    try {
      const hit = await find('routes', 'slug', r.slug);
      if (hit) { map.routes.set(String(r.id), hit.id as string | number); report.skipped.routes.push(r.slug); continue; }
      const data = remapRefs('routes', strip(r as unknown as Doc, ['id']), map);
      const doc = await payload.create({ collection: 'routes', overrideAccess: true, data: { ...data, _status: 'published' } as never });
      map.routes.set(String(r.id), doc.id);
      report.created.routes.push(r.slug);
    } catch (e) { report.errors.push(`路線 ${r.slug}：${(e as Error).message}`); }
  }

  // 文章：引用的影片與路線都必須已經有後台 id（上面兩段失敗的話，這裡會在 remapRefs 丟錯並記下來）
  const drafts = new Set(input.drafts);
  for (const t of input.corpus.tales) {
    const key = `${t.date.slice(0, 4)}/${t.slug}`;
    try {
      const hit = await find('tales', 'slug', t.slug);
      if (hit) { report.skipped.tales.push(key); continue; }
      const data = remapRefs('tales', strip(t as unknown as Doc, ['id']), map);
      // legacy 是 group 欄位：值是 null 時 Payload 的 beforeValidate 會去讀 null.url 而當掉（typeof null === 'object'），沒有就不送
      if (data.legacy == null) delete data.legacy;
      await payload.create({ collection: 'tales', overrideAccess: true, data: { ...data, _status: drafts.has(key) ? 'draft' : 'published' } as never });
      report.created.tales.push(key);
    } catch (e) { report.errors.push(`文章 ${key}：${(e as Error).message}`); }
  }

  // 轉址：public/_redirects 裡的舊網址
  for (const r of input.corpus.redirects) {
    try {
      const hit = (await payload.find({ collection: 'redirects', where: { from: { equals: r.from } }, limit: 1, depth: 0, overrideAccess: true })).docs[0];
      if (hit) { report.skipped.redirects++; continue; }
      await payload.create({ collection: 'redirects', overrideAccess: true, data: { from: r.from, to: r.to, status: String(r.status ?? '301'), reason: '遷移：git 的 public/_redirects' } as never });
      report.created.redirects++;
    } catch (e) { report.errors.push(`轉址 ${r.from}：${(e as Error).message}`); }
  }

  return report;
}
