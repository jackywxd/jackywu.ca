/**
 * 把「一筆發佈請求」套到「目前已上線的內容」上，得到這次要建置的語料。
 * 純函式：讀取 API 的事由 scripts/fetch-content.mjs 負責。
 *
 * 規則：部署只用兩樣東西——目前已上線的版本，加上這一筆請求的版本。
 * 一次只處理一筆，失敗時就一定知道是哪一篇。
 */
import type { Corpus } from './files.ts';
import { planTaleRedirects, taleUrl } from './redirects.ts';

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

export interface Refs { media: Set<string>; routes: Set<string>; reels: Set<string> }

/**
 * 一份文件引用了哪些東西：frontmatter 欄位加上正文的區塊。
 * 送出前的檢查、建置時的依賴閉包、定案時標成 published，三處都只用這一個函式——
 * 先前三處各算各的，正文區塊引用的影片會被拉進建置，卻沒被檢查、也沒被標成已發佈。
 */
export function referencesOf(collection: CollectionName, d: Record<string, unknown>): Refs {
  const out: Refs = { media: new Set(), routes: new Set(), reels: new Set() };
  const add = (set: Set<string>, v: unknown) => { const i = refId(v); if (i) set.add(i); };
  if (collection === 'tales') { add(out.media, d.hero); add(out.reels, d.video); add(out.routes, d.route); blockRefs(d.content, out); }
  if (collection === 'pages') { add(out.media, d.hero); blockRefs(d.content, out); }
  if (collection === 'routes') add(out.media, d.cover);
  if (collection === 'reels') add(out.media, d.poster);
  return out;
}

export type IdMap = { media: Map<string, string | number>; routes: Map<string, string | number>; reels: Map<string, string | number> };

/**
 * 把一份文件的引用換成另一組 id（遷移：語料裡的本機 id → 後台實際的 id）。
 * 和 referencesOf 是同一個模型：referencesOf 看得到的每一個引用都會被換掉；找不到對應就丟錯，不留下指向別處的 id。
 */
export function remapRefs(collection: CollectionName, d: Record<string, unknown>, map: IdMap): Record<string, unknown> {
  const swap = (kind: keyof IdMap, v: unknown) => {
    const i = refId(v);
    if (!i) return v;
    const to = map[kind].get(i);
    if (to === undefined) throw new Error(`${collection}「${String(d.slug ?? d.title ?? d.id)}」引用的 ${kind} ${i} 沒有對應的新 id`);
    return to;
  };
  const block = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const n = { ...(node as Record<string, unknown>) };
    if (n.type === 'block' && n.fields && typeof n.fields === 'object') {
      const f = { ...(n.fields as Record<string, unknown>) };
      if (f.blockType === 'figure') f.media = swap('media', f.media);
      if (f.blockType === 'gallery') f.items = ((f.items as Record<string, unknown>[] | undefined) ?? []).map((it) => ({ ...it, media: swap('media', it.media) }));
      if (f.blockType === 'video') f.reel = swap('reels', f.reel);
      if (f.blockType === 'route') f.route = swap('routes', f.route);
      n.fields = f;
    }
    if (Array.isArray(n.children)) n.children = n.children.map(block);
    if (n.root) n.root = block(n.root);
    return n;
  };
  const out = { ...d };
  if (collection === 'tales') { out.hero = swap('media', d.hero); out.video = swap('reels', d.video); out.route = swap('routes', d.route); out.content = block(d.content); }
  if (collection === 'pages') { out.hero = swap('media', d.hero); out.content = block(d.content); }
  if (collection === 'routes') out.cover = swap('media', d.cover);
  if (collection === 'reels') out.poster = swap('media', d.poster);
  return out;
}

/** 語料裡被引用、卻不在語料中的東西。 */
export function missingDeps(c: Corpus): { media: string[]; routes: string[]; reels: string[] } {
  const want: Refs = { media: new Set(), routes: new Set(), reels: new Set() };
  const merge = (r: Refs) => { for (const k of ['media', 'routes', 'reels'] as const) for (const x of r[k]) want[k].add(x); };
  for (const t of c.tales) merge(referencesOf('tales', t as never));
  for (const p of c.pages) merge(referencesOf('pages', p as never));
  for (const r of c.routes) merge(referencesOf('routes', r as never));
  for (const v of c.reels) merge(referencesOf('reels', v as never));
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

type Counts = Partial<Record<'tales' | 'routes' | 'reels' | 'redirects', number>>;
/**
 * 完整性護欄（每一類）：拉到的數量比上次部署少了「這次不該少」的份，就是 API 回了半截資料，拒絕建置。
 * 文章、路線、影片：少的數量不能超過這一筆請求要撤下的。轉址可以被本人刪掉，所以只擋「整批不見」。
 * 上次的 manifest 沒有某一類的數字（舊格式）就不檢查那一類。
 */
export function integrityAll(args: { last: Counts; fetched: Required<Counts>; expectedRemovals: Counts }): { ok: true } | { ok: false; reason: string } {
  for (const c of ['tales', 'routes', 'reels'] as const) {
    const last = args.last[c];
    if (last === undefined) continue;
    const floor = last - (args.expectedRemovals[c] ?? 0);
    if (args.fetched[c] < floor) return { ok: false, reason: `${c}：只拉到 ${args.fetched[c]}，上次部署是 ${last}、這次只該少 ${args.expectedRemovals[c] ?? 0}（下限 ${floor}）` };
  }
  if ((args.last.redirects ?? 0) > 0 && args.fetched.redirects === 0) {
    return { ok: false, reason: `redirects：上次部署有 ${args.last.redirects} 條，這次一條都沒拉到` };
  }
  return { ok: true };
}

/** 送出發佈那一刻的快照：文件本身，加上它引用、但還沒上線的路線與影片。建置與定案都只用它 */
export interface Snapshot {
  doc: { collection: CollectionName; id: number | string; versionId: string; data: Doc };
  deps: { collection: 'routes' | 'reels'; id: number | string; versionId: string; data: Doc }[];
  /** 拍快照的時間：定案時，比這更晚的草稿要重新蓋回最上面（送出之後的編輯不能被埋掉） */
  takenAt: string;
}

/**
 * 把快照套到已上線的語料上。已上線的依賴維持已上線的版本；快照只補上還沒上線的。
 * 套完之後語料裡不能有缺的依賴：快照是送出時算好的，缺了就是送出與建置之間有東西被刪掉了。
 */
export function applySnapshot(corpus: Corpus, req: Request, snap: Snapshot): Corpus {
  if (snap.doc.collection !== req.collection || !same(snap.doc.id, req.docId)) {
    throw new Error(`快照屬於 ${snap.doc.collection}/${snap.doc.id}，請求卻是 ${req.collection}/${req.docId}`);
  }
  let c = applyRequest(corpus, req, { ...snap.doc.data, id: snap.doc.id });
  for (const d of snap.deps) {
    const list = c[d.collection] as unknown as Doc[];
    if (list.some((x) => same(x.id, d.id))) continue;
    c = { ...c, [d.collection]: [...list, { ...d.data, id: d.id }] } as Corpus;
  }
  const miss = missingDeps(c);
  const lack = [...miss.routes.map((x) => `routes/${x}`), ...miss.reels.map((x) => `reels/${x}`)];
  if (lack.length) throw new Error(`缺少依賴：${lack.join('、')}（送出之後被刪除或撤下了？）`);
  return c;
}

/**
 * 這一筆請求造成的網址變化，建置時就要反映：定案（寫進 redirects 集合）是部署成功之後的事，
 * 但 verify-links 在部署前就檢查 _redirects。
 *  · 已上線的文章改了 slug／日期：舊網址 301 到新網址，指向舊網址的轉址改指新網址
 *  · 撤下或刪除文章：拿掉指向它的轉址（否則轉址指向不存在的頁面，這一筆永遠過不了 verify-links）
 */
export function planRequestRedirects(corpus: Corpus, req: Request, newDoc?: Record<string, unknown>): Corpus {
  if (req.collection !== 'tales') return corpus;
  const before = corpus.tales.find((t) => same(t.id, req.docId));
  if (!before) return corpus;
  if (req.kind !== 'publish') {
    const url = taleUrl(before.date, before.slug);
    return { ...corpus, redirects: corpus.redirects.filter((r) => r.to !== url) };
  }
  if (!newDoc) throw new Error('發佈請求必須帶新版本');
  const plan = planTaleRedirects({ before, after: { date: String(newDoc.date), slug: String(newDoc.slug) }, existing: corpus.redirects });
  const retarget = new Map(plan.retarget.map((r) => [r.from, r.to]));
  const kept = corpus.redirects.filter((r) => !plan.remove.includes(r.from)).map((r) => (retarget.has(r.from) ? { ...r, to: retarget.get(r.from)! } : r));
  return { ...corpus, redirects: [...kept, ...plan.create] };
}
