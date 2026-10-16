/**
 * 把 git 裡現有的內容（src/content）讀成 Payload 語料（Corpus）。
 * 用於 M4：遷移既有文章，並產出「切換前後建置結果對照」所需的資料。純讀取，不寫任何東西。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Corpus, MediaDoc, ReelDoc, RouteDoc, TaleDoc } from '../../../../packages/content-sync/files';
import { mdxToLexical, parseFrontmatter, type Problem } from '../mdx-import';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir).sort()) {
    const p = path.join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

export interface GitCorpus {
  corpus: Corpus;
  /** media id → 來源檔案的絕對路徑（遷移時由它上傳） */
  mediaFiles: Map<string, string>;
  problems: { file: string; problem: Problem }[];
  drafts: Set<string>;
}

export function readGitCorpus(contentDir: string): GitCorpus {
  const mediaFiles = new Map<string, string>();
  const mediaDocs: MediaDoc[] = [];
  const problems: { file: string; problem: Problem }[] = [];
  const drafts = new Set<string>();
  let nextMedia = 1;

  const mediaFor = (abs: string, alt: string): number => {
    for (const [id, p] of mediaFiles) if (p === abs) return Number(id);
    if (!existsSync(abs)) throw new Error(`圖片不存在：${abs}`);
    const id = nextMedia++;
    mediaFiles.set(String(id), abs);
    mediaDocs.push({ id, filename: path.basename(abs), alt, kind: 'img' });
    return id;
  };

  const reelIds = new Map<string, number>();
  const routeIds = new Map<string, number>();
  const reels: ReelDoc[] = [];
  const routes: RouteDoc[] = [];

  // 影片
  const reelDir = path.join(contentDir, 'reel');
  if (existsSync(reelDir)) {
    for (const f of walk(reelDir).filter((p) => p.endsWith('.yaml'))) {
      const y = YAML.parse(readFileSync(f, 'utf8'), { schema: 'core' }) as Record<string, string>;
      const rel = path.relative(reelDir, f).replace(/\.yaml$/, '');
      const id = reels.length + 1;
      reelIds.set(rel, id);
      reels.push({
        id, title: y.title!, videoId: y.id!, poster: mediaFor(path.resolve(path.dirname(f), y.poster!), y.posterAlt ?? ''),
        posterAlt: y.posterAlt!, duration: Number(y.duration), bytes: Number(y.bytes), ratio: y.ratio ?? '16/9', realm: y.realm!, date: y.date!, caption: y.caption ?? null,
      });
    }
  }

  // 路線（含三張 SVG）
  const routeDir = path.join(contentDir, 'routes');
  if (existsSync(routeDir)) {
    for (const f of walk(routeDir).filter((p) => p.endsWith('.yaml'))) {
      const y = YAML.parse(readFileSync(f, 'utf8'), { schema: 'core' }) as Record<string, string>;
      const base = f.replace(/\.yaml$/, '');
      const rel = path.relative(routeDir, base);
      const id = routes.length + 1;
      routeIds.set(rel, id);
      const svg = (suffix: string) => (existsSync(base + suffix) ? readFileSync(base + suffix, 'utf8') : null);
      routes.push({
        id, slug: path.basename(base), name: y.name!, nameEn: y.nameEn ?? null, realm: y.realm!, date: y.date!, region: y.region!,
        distanceKm: y.distanceKm ? Number(y.distanceKm) : null, gainM: y.gainM ? Number(y.gainM) : null, elapsed: y.elapsed ?? null,
        result: y.result ?? null, badge: y.badge ?? null, note: y.note ?? null, coverAlt: y.coverAlt ?? null,
        downloadable: y.downloadable === undefined ? true : String(y.downloadable) !== 'false',
        svgTrack: svg('.svg'), svgThumb: svg('.thumb.svg'), svgProfile: svg('.profile.svg'),
      });
    }
  }

  // 文章
  const tales: TaleDoc[] = [];
  const taleDir = path.join(contentDir, 'tales');
  for (const f of walk(taleDir).filter((p) => /\/index\.mdx?$/.test(p))) {
    const src = readFileSync(f, 'utf8');
    const dir = path.dirname(f);
    const { frontmatter: fm } = parseFrontmatter(src);
    const rel = path.relative(taleDir, dir);
    const r = mdxToLexical(src, {
      resolveImage: ({ src: s, alt }) => {
        const abs = path.resolve(dir, s);
        return existsSync(abs) ? mediaFor(abs, alt) : null;
      },
      resolveReel: (e) => reelIds.get(e) ?? null,
      resolveRoute: (s) => routeIds.get(s) ?? [...routeIds].find(([k]) => k.endsWith(`/${s}`))?.[1] ?? null,
    });
    for (const p of r.problems) problems.push({ file: rel, problem: p });
    if (fm.draft === true || fm.draft === 'true') drafts.add(rel);
    const hero = typeof fm.hero === 'string' ? mediaFor(path.resolve(dir, fm.hero), String(fm.heroAlt ?? '')) : null;
    const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    tales.push({
      id: tales.length + 1, title: String(fm.title), slug: path.basename(dir), date: String(fm.date), updated: fm.updated ? String(fm.updated) : null,
      lang: String(fm.lang ?? 'zh-Hant'), realm: String(fm.realm), tags: listOf(fm.tags), featured: fm.featured === true || fm.featured === 'true',
      excerpt: String(fm.excerpt), verse: fm.verse ? String(fm.verse) : null, shareable: fm.shareable === undefined ? true : String(fm.shareable) !== 'false',
      xhsTags: fm.xhsTags ? listOf(fm.xhsTags) : null, hero, heroAlt: fm.heroAlt ? String(fm.heroAlt) : null,
      video: typeof fm.video === 'string' ? (reelIds.get(fm.video) ?? null) : null,
      route: typeof fm.route === 'string' ? (routeIds.get(fm.route) ?? [...routeIds].find(([k]) => k.endsWith(`/${fm.route}`))?.[1] ?? null) : null,
      legacy: fm.legacy && typeof fm.legacy === 'object' ? { url: String((fm.legacy as Record<string, unknown>).url), brokenImages: listOf((fm.legacy as Record<string, unknown>).brokenImages) } : null,
      content: r.state,
    });
  }

  // 轉址（public/_redirects）
  const redirects: { from: string; to: string }[] = [];
  const rf = path.resolve(contentDir, '../../public/_redirects');
  if (existsSync(rf)) {
    for (const line of readFileSync(rf, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const [from, to] = t.split(/\s+/);
      if (from && to) redirects.push({ from, to });
    }
  }

  return { corpus: { tales, pages: [], routes, reels, media: mediaDocs, redirects }, mediaFiles, problems, drafts };
}
