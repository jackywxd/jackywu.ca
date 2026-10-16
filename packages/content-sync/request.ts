/**
 * 把「一筆發佈請求」套到「目前已上線的內容」上，得到這次要建置的語料。
 * 純函式：讀取 API 的事由 scripts/fetch-content.mjs 負責。
 *
 * 規則：部署只用兩樣東西——目前已上線的版本，加上這一筆請求的版本。
 * 一次只處理一筆，失敗時就一定知道是哪一篇。
 */
import type { Corpus } from './files.ts';

export type CollectionName = 'tales' | 'pages' | 'routes' | 'reels';
export interface Request { kind: 'publish' | 'unpublish' | 'delete'; collection: CollectionName; docId: string }
type Doc = { id: number | string } & Record<string, unknown>;

const same = (a: unknown, b: unknown) => String(a) === String(b);

export function applyRequest(corpus: Corpus, req: Request, version?: Doc): Corpus {
  const list = corpus[req.collection] as unknown as Doc[];
  const without = list.filter((d) => !same(d.id, req.docId));
  if (req.kind === 'unpublish' || req.kind === 'delete') {
    if (version) throw new Error('撤下／刪除不該帶版本內容');
    if (without.length === list.length) throw new Error(`要撤下的 ${req.collection}/${req.docId} 本來就不在已上線的內容裡`);
    return { ...corpus, [req.collection]: without };
  }
  if (!version) throw new Error('發佈請求必須帶版本內容');
  if (!same(version.id, req.docId)) throw new Error(`版本屬於 ${version.id}，請求卻是 ${req.docId}`);
  return { ...corpus, [req.collection]: [...without, version] } as Corpus;
}

const refId = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : typeof v === 'object' ? String((v as { id: unknown }).id) : String(v);

/** 正文區塊（Lexical block）引用的 id，遞迴找 */
function blockRefs(node: unknown, out: { media: Set<string>; routes: Set<string>; reels: Set<string> }) {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'block' && n.fields && typeof n.fields === 'object') {
    const f = n.fields as Record<string, unknown>;
    if (f.blockType === 'figure' && refId(f.media)) out.media.add(refId(f.media)!);
    if (f.blockType === 'gallery') for (const it of (f.items as Record<string, unknown>[] | undefined) ?? []) if (refId(it.media)) out.media.add(refId(it.media)!);
    if (f.blockType === 'video' && refId(f.reel)) out.reels.add(refId(f.reel)!);
    if (f.blockType === 'route' && refId(f.route)) out.routes.add(refId(f.route)!);
  }
  for (const c of (n.children as unknown[] | undefined) ?? []) blockRefs(c, out);
  if (n.root) blockRefs(n.root, out);
}

/** 語料裡被引用、卻不在語料中的東西。依賴閉包：這些要連同這筆請求一起拉進來。 */
export function missingDeps(c: Corpus): { media: string[]; routes: string[]; reels: string[] } {
  const want = { media: new Set<string>(), routes: new Set<string>(), reels: new Set<string>() };
  const add = (set: Set<string>, v: unknown) => { const i = refId(v); if (i) set.add(i); };
  for (const t of c.tales) {
    add(want.media, t.hero); add(want.reels, t.video); add(want.routes, t.route);
    blockRefs(t.content, want);
  }
  for (const p of c.pages) { add(want.media, p.hero); blockRefs(p.content, want); }
  for (const r of c.routes) add(want.media, r.cover);
  for (const v of c.reels) add(want.media, v.poster);
  const have = {
    media: new Set(c.media.map((m) => String(m.id))),
    routes: new Set(c.routes.map((r) => String(r.id))),
    reels: new Set(c.reels.map((r) => String(r.id))),
  };
  const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();
  return { media: diff(want.media, have.media), routes: diff(want.routes, have.routes), reels: diff(want.reels, have.reels) };
}

/** 撤下一篇後，只被它引用的媒體不會再出現在 manifest；是否撤回由 planRevoke 決定 */
export function integrity(args: { lastCount: number; fetchedCount: number; expectedRemovals: number }) {
  const floor = args.lastCount - args.expectedRemovals;
  return args.fetchedCount >= floor
    ? { ok: true as const }
    : { ok: false as const, reason: `只拉到 ${args.fetchedCount} 篇，上次部署是 ${args.lastCount} 篇、這次只該撤下 ${args.expectedRemovals} 篇（下限 ${floor}）` };
}
