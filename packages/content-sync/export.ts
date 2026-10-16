/**
 * 已發佈內容 → 可以放進 git 的備份（MDX + frontmatter + 媒體檔）。純函式。
 * 與 admin/src/lib/mdx-import 互為反向：備份出來的東西，匯入器必須能原樣讀回
 *（admin/test/export-roundtrip.test.ts 對合成語料與真實文章都驗過）。
 * 草稿永遠不會被匯出：repo 是公開的。
 */
import { lexicalToTree, collectMedia, type Block } from './lexical.ts';
import { treeToMdx } from './to-mdx.ts';
import type { Corpus, MediaDoc, OutFile } from './files.ts';

const ext = (f: string) => (f.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
const year = (d: string) => d.slice(0, 4);

/** 夠用的 YAML 輸出：只處理純量與字串陣列（我們的 frontmatter 只有這些） */
function yamlScalar(v: unknown): string {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // 一律用雙引號 JSON 字串：YAML 的雙引號字串是 JSON 的超集，中文、冒號、井字號都安全
  return JSON.stringify(s);
}
export function frontmatterYaml(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { if (v.length) lines.push(`${k}:`, ...v.map((x) => `  - ${yamlScalar(x)}`)); }
    else if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      lines.push(`${k}:`);
      for (const [kk, vv] of Object.entries(o)) {
        if (vv === undefined || vv === null) continue;
        if (Array.isArray(vv)) { if (vv.length) lines.push(`  ${kk}:`, ...vv.map((x) => `    - ${yamlScalar(x)}`)); }
        else lines.push(`  ${kk}: ${yamlScalar(vv)}`);
      }
    } else lines.push(`${k}: ${yamlScalar(v)}`);
  }
  return lines.join('\n');
}

export interface ExportResult { files: Map<string, OutFile>; counts: { tales: number; routes: number; reels: number } }

export function exportCorpus(c: Corpus): ExportResult {
  const files = new Map<string, OutFile>();
  const media = new Map<string, MediaDoc>(c.media.map((m) => [String(m.id), m]));
  const routeIds = new Map(c.routes.map((r) => [String(r.id), { slug: r.slug, id: `${year(r.date)}/${r.slug}` }]));
  const reelIds = new Map(c.reels.map((r) => [String(r.id), `${year(r.date)}/${r.videoId}`]));
  const idOf = (v: unknown) => (v == null ? null : typeof v === 'object' ? String((v as { id: unknown }).id) : String(v));
  const mediaName = (id: string) => { const m = media.get(id); if (!m) throw new Error(`備份：媒體 ${id} 不在語料裡`); return `${id}${ext(m.filename)}`; };

  for (const t of c.tales) {
    const base = `tales/${year(t.date)}/${t.slug}`;
    const tree = lexicalToTree(t.content ?? { root: { type: 'root', children: [] } }, `${year(t.date)}/${t.slug}`);
    const withAlt: Block[] = tree.map((b) => {
      if (b.t === 'figure') return { ...b, alt: media.get(b.media)?.alt ?? '' } as Block;
      if (b.t === 'gallery') return { ...b, items: b.items.map((i) => ({ ...i, alt: i.alt || media.get(i.media)?.alt || '' })) };
      return b;
    });
    const { mdx } = treeToMdx(withAlt, {
      mediaPath: (id) => `./media/${mediaName(id)}`,
      reelEntry: (id) => reelIds.get(id) ?? (() => { throw new Error(`備份：影片 ${id} 不在語料裡`); })(),
      routeSlug: (id) => routeIds.get(id)?.id.split('/').pop() ?? (() => { throw new Error(`備份：路線 ${id} 不在語料裡`); })(),
    });
    for (const id of collectMedia(tree)) files.set(`${base}/media/${mediaName(id)}`, { media: id });
    const hero = idOf(t.hero);
    if (hero) files.set(`${base}/media/${mediaName(hero)}`, { media: hero });
    const fm = frontmatterYaml({
      title: t.title, slug: t.slug, date: t.date, updated: t.updated, lang: t.lang ?? 'zh-Hant', realm: t.realm, tags: t.tags ?? [], featured: t.featured ?? false,
      excerpt: t.excerpt, verse: t.verse, shareable: t.shareable ?? true, xhsTags: t.xhsTags ?? [], hero: hero ? `./media/${mediaName(hero)}` : undefined, heroAlt: t.heroAlt,
      video: idOf(t.video) ? reelIds.get(idOf(t.video)!) : undefined, route: idOf(t.route) ? routeIds.get(idOf(t.route)!)?.id : undefined,
      legacy: t.legacy?.url ? { url: t.legacy.url, brokenImages: t.legacy.brokenImages ?? [] } : undefined,
    });
    files.set(`${base}/index.mdx`, { text: `---\n${fm}\n---\n\n${mdx}` });
  }

  for (const r of c.routes) {
    // 與 git 的 routes schema 一致（src/content.config.ts）：gpx 是檔名、cover 是相對路徑。
    // GPX 原檔本身在私有 R2，不在這份備份裡（D1 匯出也不含 R2 物件）
    const cover = idOf(r.cover);
    const coverName = cover ? `${r.slug}-cover${ext(media.get(cover)?.filename ?? '.jpg')}` : undefined;
    const fm = frontmatterYaml({
      name: r.name, slug: r.slug, nameEn: r.nameEn, realm: r.realm, date: r.date, region: r.region, gpx: r.hasGpx ? `${r.slug}.gpx` : undefined,
      distanceKm: r.distanceKm, gainM: r.gainM, elapsed: r.elapsed, result: r.result, badge: r.badge, note: r.note,
      cover: coverName ? `./${coverName}` : undefined, coverAlt: r.coverAlt, downloadable: r.downloadable ?? true,
    });
    files.set(`routes/${year(r.date)}/${r.slug}.yaml`, { text: fm + '\n' });
    if (cover && coverName) files.set(`routes/${year(r.date)}/${coverName}`, { media: cover });
    for (const [suffix, svg] of [['.svg', r.svgTrack], ['.thumb.svg', r.svgThumb], ['.profile.svg', r.svgProfile]] as const) if (svg) files.set(`routes/${year(r.date)}/${r.slug}${suffix}`, { text: svg });
  }
  for (const v of c.reels) {
    const poster = idOf(v.poster);
    files.set(`reel/${year(v.date)}/${v.videoId}.yaml`, { text: frontmatterYaml({ title: v.title, id: v.videoId, poster: poster ? `./${v.videoId}-poster${ext(media.get(poster)?.filename ?? '.jpg')}` : undefined, posterAlt: v.posterAlt, duration: v.duration, bytes: v.bytes, ratio: v.ratio, realm: v.realm, date: v.date, caption: v.caption }) + '\n' });
    if (poster) files.set(`reel/${year(v.date)}/${v.videoId}-poster${ext(media.get(poster)?.filename ?? '.jpg')}`, { media: poster });
  }
  files.set('redirects.json', { text: JSON.stringify([...c.redirects].sort((a, b) => a.from.localeCompare(b.from)), null, 2) + '\n' });
  return { files, counts: { tales: c.tales.length, routes: c.routes.length, reels: c.reels.length } };
}
