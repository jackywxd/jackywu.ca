/**
 * Payload 的已發佈文件 → 前台 content loader 吃的檔案樹。純函式。
 *
 * 輸出的目錄結構刻意和 git 模式一致（<collection>/<year>/<slug>…），
 * 這樣前台元件（Route 讀 svg、Video 讀 reel）幾乎不用知道資料從哪來。
 */
import { lexicalToTree, collectMedia, type Block } from './lexical.ts';

export interface MediaDoc { id: number | string; filename: string; kind?: string; mimeType?: string; width?: number; height?: number; alt?: string }
export interface TaleDoc {
  id: number | string; title: string; slug: string; date: string; updated?: string | null; lang?: string | null;
  realm: string; tags?: string[] | null; featured?: boolean | null; excerpt: string; verse?: string | null;
  shareable?: boolean | null; xhsTags?: string[] | null; hero?: number | string | { id: number | string } | null;
  heroAlt?: string | null; video?: number | string | { id: number | string } | null;
  route?: number | string | { id: number | string } | null;
  legacy?: { url?: string | null; brokenImages?: string[] | null } | null; content?: unknown;
}
export interface PageDoc { id: number | string; slug: string; title: string; subtitle?: string | null; excerpt: string; updated?: string | null; hero?: number | string | { id: number | string } | null; heroAlt?: string | null; content?: unknown }
export interface RouteDoc {
  id: number | string; slug: string; name: string; nameEn?: string | null; realm: string; date: string; region: string;
  distanceKm?: number | null; gainM?: number | null; elapsed?: string | null; result?: string | null; badge?: string | null;
  note?: string | null; cover?: number | string | { id: number | string } | null; coverAlt?: string | null; downloadable?: boolean | null;
  /** GPX 原檔在 gpx/<slug>.gpx；有檔案才會 promote */
  hasGpx?: boolean | null;
  svgTrack?: string | null; svgThumb?: string | null; svgProfile?: string | null;
}
export interface ReelDoc {
  id: number | string; title: string; videoId: string; poster?: number | string | { id: number | string } | null; posterAlt: string;
  duration?: number | null; bytes?: number | null; ratio?: string | null; realm: string; date: string; caption?: string | null;
}
export interface RedirectDoc { from: string; to: string }

export interface Corpus { tales: TaleDoc[]; pages: PageDoc[]; routes: RouteDoc[]; reels: ReelDoc[]; media: MediaDoc[]; redirects: RedirectDoc[] }

/** 輸出：文字檔直接給內容；媒體檔只給「從哪個媒體 id 複製」，由執行端去取 */
export type OutFile = { text: string } | { media: string };
export interface BuildResult {
  files: Map<string, OutFile>;
  /** 發佈後必須存在於公開位置的 key（影片、GPX）。圖片編進 dist，不在此列 */
  promoteKeys: string[];
  counts: { tales: number; pages: number; routes: number; reels: number; redirects: number };
}

const idOf = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : typeof v === 'object' ? String((v as { id: unknown }).id) : String(v);
const year = (d: string) => d.slice(0, 4);
const ext = (f: string) => (f.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
const json = (o: unknown) => ({ text: JSON.stringify(o, null, 2) + '\n' });
const clean = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

export function buildFiles(c: Corpus): BuildResult {
  const files = new Map<string, OutFile>();
  const media = new Map(c.media.map((m) => [String(m.id), m]));
  const routeIds = new Map(c.routes.map((r) => [String(r.id), `${year(r.date)}/${r.slug}`]));
  const reelIds = new Map(c.reels.map((r) => [String(r.id), `${year(r.date)}/${r.videoId}`]));
  const promote = new Set<string>();

  const need = (id: string | undefined, what: string) => {
    const m = id ? media.get(id) : undefined;
    if (!m) throw new Error(`${what} 引用的媒體 ${id} 不在已發佈的資料裡（依賴沒有一起發佈？）`);
    return m;
  };
  const put = (dir: string, id: string, what: string) => {
    const m = need(id, what);
    const name = `${m.id}${ext(m.filename)}`;
    files.set(`${dir}/${name}`, { media: String(m.id) });
    return { name, alt: m.alt ?? '' };
  };

  const seen = new Set<string>();
  const unique = (path: string) => {
    if (seen.has(path)) throw new Error(`內容路徑重複：${path}（slug 在同一年內必須唯一）`);
    seen.add(path);
  };

  for (const t of c.tales) {
    const base = `tales/${year(t.date)}/${t.slug}`;
    unique(base);
    const tree: Block[] = lexicalToTree(t.content ?? { root: { type: 'root', children: [] } }, `${year(t.date)}/${t.slug}`);
    const mediaMap: Record<string, string> = {};
    for (const mid of collectMedia(tree)) mediaMap[mid] = `./media/${put(`${base}/media`, mid, `文章 ${t.slug}`).name}`;
    const heroId = idOf(t.hero);
    const hero = heroId ? put(base, heroId, `文章 ${t.slug} 的 hero`) : undefined;
    const video = idOf(t.video), route = idOf(t.route);
    if (video && !reelIds.has(video)) throw new Error(`文章 ${t.slug} 引用的影片 ${video} 不在已發佈的資料裡`);
    if (route && !routeIds.has(route)) throw new Error(`文章 ${t.slug} 引用的路線 ${route} 不在已發佈的資料裡`);
    // 正文裡的 video / route 區塊把 Payload id 換成內容 id，前台元件吃的是內容 id
    const altOf = (id: string) => media.get(id)?.alt ?? '';
    const body = tree.map((b) => {
      // 圖片的替代文字以媒體庫為準（必填），區塊上沒寫就繼承
      if (b.t === 'figure') return { ...b, alt: altOf(b.media) };
      if (b.t === 'gallery') return { ...b, items: b.items.map((i) => ({ ...i, alt: i.alt || altOf(i.media) })) };
      if (b.t === 'video') {
        const r = reelIds.get(b.reel); if (!r) throw new Error(`文章 ${t.slug} 的影片區塊引用 ${b.reel}，不在已發佈的資料裡`);
        return { ...b, reel: r };
      }
      if (b.t === 'route') {
        const r = routeIds.get(b.route); if (!r) throw new Error(`文章 ${t.slug} 的路線區塊引用 ${b.route}，不在已發佈的資料裡`);
        return { ...b, route: r };
      }
      return b;
    });
    files.set(`${base}/index.json`, json(clean({
      title: t.title, date: t.date, updated: t.updated ?? undefined, lang: t.lang ?? 'zh-Hant', draft: false,
      realm: t.realm, tags: t.tags ?? [], featured: t.featured ?? false, excerpt: t.excerpt, verse: t.verse ?? undefined,
      shareable: t.shareable ?? true, xhsTags: t.xhsTags?.length ? t.xhsTags : undefined,
      hero: hero ? `./${hero.name}` : undefined, heroAlt: t.heroAlt ?? undefined,
      video: video ? reelIds.get(video) : undefined, route: route ? routeIds.get(route) : undefined,
      legacy: t.legacy?.url ? { url: t.legacy.url, brokenImages: t.legacy.brokenImages ?? [] } : undefined,
      body, media: mediaMap,
    })));
  }

  for (const p of c.pages) {
    const base = `pages/${p.slug}`;
    unique(base);
    const tree = lexicalToTree(p.content ?? { root: { type: 'root', children: [] } }, `pages/${p.slug}`);
    const mediaMap: Record<string, string> = {};
    for (const mid of collectMedia(tree)) mediaMap[mid] = `./${p.slug}.media/${put(`pages/${p.slug}.media`, mid, `單頁 ${p.slug}`).name}`;
    const heroId = idOf(p.hero);
    const hero = heroId ? put(`pages/${p.slug}.media`, heroId, `單頁 ${p.slug} 的 hero`) : undefined;
    files.set(`pages/${p.slug}.json`, json(clean({
      title: p.title, subtitle: p.subtitle ?? undefined, excerpt: p.excerpt, updated: p.updated ?? undefined,
      hero: hero ? `./${p.slug}.media/${hero.name}` : undefined, heroAlt: p.heroAlt ?? undefined, body: tree, media: mediaMap,
    })));
  }

  for (const r of c.routes) {
    const base = `routes/${year(r.date)}/${r.slug}`;
    unique(base);
    const coverId = idOf(r.cover);
    const cover = coverId ? put(`routes/${year(r.date)}`, coverId, `路線 ${r.slug} 的封面`) : undefined;
    if (r.hasGpx) promote.add(`gpx/${r.slug}.gpx`);
    files.set(`${base}.json`, json(clean({
      name: r.name, nameEn: r.nameEn ?? undefined, realm: r.realm, date: r.date, region: r.region,
      gpx: r.hasGpx ? `${r.slug}.gpx` : undefined, distanceKm: r.distanceKm ?? undefined, gainM: r.gainM ?? undefined,
      elapsed: r.elapsed ?? undefined, result: r.result ?? undefined, badge: r.badge ?? undefined, note: r.note ?? undefined,
      cover: cover ? `./${cover.name}` : undefined, coverAlt: r.coverAlt ?? undefined, downloadable: r.downloadable ?? true,
    })));
    if (r.svgTrack) files.set(`${base}.svg`, { text: r.svgTrack });
    if (r.svgThumb) files.set(`${base}.thumb.svg`, { text: r.svgThumb });
    if (r.svgProfile) files.set(`${base}.profile.svg`, { text: r.svgProfile });
  }

  for (const v of c.reels) {
    const base = `reel/${year(v.date)}/${v.videoId}`;
    unique(base);
    const posterId = idOf(v.poster);
    if (!posterId) throw new Error(`影片 ${v.videoId} 沒有 poster`);
    const poster = put(`reel/${year(v.date)}`, posterId, `影片 ${v.videoId} 的 poster`);
    if (!v.duration || !v.bytes) throw new Error(`影片 ${v.videoId} 還沒轉碼完成（缺 duration/bytes），不能發佈`);
    promote.add(`video/${v.videoId}/1080p.mp4`);
    promote.add(`video/${v.videoId}/poster.jpg`);
    files.set(`${base}.json`, json(clean({
      title: v.title, id: v.videoId, poster: `./${poster.name}`, posterAlt: v.posterAlt, duration: v.duration, bytes: v.bytes,
      ratio: v.ratio ?? '16/9', realm: v.realm, date: v.date, caption: v.caption ?? undefined,
    })));
  }

  for (const r of c.redirects) {
    if (/\s/.test(r.from) || /\s/.test(r.to)) throw new Error(`轉址含空白：「${r.from}」→「${r.to}」（_redirects 以空白分欄，必須 %20）`);
  }
  files.set('redirects.json', json(c.redirects.map(({ from, to }) => ({ from, to })).sort((a, b) => a.from.localeCompare(b.from))));

  return {
    files, promoteKeys: [...promote].sort(),
    counts: { tales: c.tales.length, pages: c.pages.length, routes: c.routes.length, reels: c.reels.length, redirects: c.redirects.length },
  };
}
