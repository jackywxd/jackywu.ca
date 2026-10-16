import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpus as fixture } from '../../e2e/fixtures/payload/corpus.mjs';
import { exportCorpus, frontmatterYaml } from '../../packages/content-sync/export';
import type { Corpus } from '../../packages/content-sync/files';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { mdxToLexical, parseFrontmatter } from '../src/lib/mdx-import';
import { frontmatterToTale } from '../src/lib/mdx-import/frontmatter';
import { readGitCorpus } from '../src/lib/migration/git-corpus';

/** 備份出來的 index.mdx，用匯入器讀回來，與原本的文章（欄位與內容樹）比對 */
function readBack(c: Corpus, taleIdx: number) {
  const { files } = exportCorpus(c);
  const t = c.tales[taleIdx]!;
  const f = files.get(`tales/${t.date.slice(0, 4)}/${t.slug}/index.mdx`) as { text: string };
  const idByPath = (s: string) => s.match(/^\.\/media\/(\w+)\./)?.[1] ?? null;
  const reels = new Map(c.reels.map((r) => [`${r.date.slice(0, 4)}/${r.videoId}`, String(r.id)]));
  const routes = new Map(c.routes.map((r) => [r.slug, String(r.id)]));
  const r = mdxToLexical(f.text, { resolveImage: ({ src }) => idByPath(src), resolveReel: (e) => reels.get(e) ?? null, resolveRoute: (s) => routes.get(s) ?? null });
  return { ...r, text: f.text, files };
}

describe('備份格式', () => {
  const c = fixture as unknown as Corpus;
  it('合成語料：frontmatter 與內文樹都能被匯入器原樣讀回', () => {
    const t = c.tales[0]!;
    const back = readBack(c, 0);
    expect(back.problems.filter((p) => p.level === 'error')).toEqual([]);
    const fm = frontmatterToTale(back.frontmatter);
    expect(fm.missing).toEqual([]); expect(fm.issues).toEqual([]); expect(fm.unknown).toEqual([]);
    expect(fm.data).toMatchObject({ title: t.title, slug: t.slug, date: t.date, realm: t.realm, tags: t.tags, featured: true, excerpt: t.excerpt, verse: t.verse, heroAlt: t.heroAlt });
    // 圖組的格子沒寫 alt 時，渲染會繼承媒體庫的；備份把繼承後的值寫出來（讀回來的畫面完全一樣）
    const alts = new Map(c.media.map((m) => [String(m.id), m.alt ?? '']));
    const original = lexicalToTree(t.content, 'x').map((b) => (b.t === 'gallery' ? { ...b, items: b.items.map((i) => ({ ...i, alt: i.alt || alts.get(i.media) || '' })) } : b));
    expect(lexicalToTree(back.state, 'x')).toEqual(original);
  });
  it('每個內文引用的圖都有對應的媒體檔（備份不能有斷掉的引用）', () => {
    const { files } = exportCorpus(c);
    const mdx = (files.get('tales/2026/ridge-day/index.mdx') as { text: string }).text;
    for (const m of mdx.matchAll(/\.\/media\/([\w.]+)/g)) expect(files.has(`tales/2026/ridge-day/media/${m[1]}`), m[1]).toBe(true);
  });
  it('每一種內容型別都有檔案：文章、路線（含三張 SVG）、影片（含 poster）、轉址', () => {
    const { files } = exportCorpus(c);
    for (const p of ['tales/2026/ridge-day/index.mdx', 'tales/2025/forge-note/index.mdx', 'routes/2026/whistler-utmb-100k-2026.yaml', 'routes/2026/whistler-utmb-100k-2026.profile.svg', 'reel/2026/metal-dome.yaml', 'redirects.json']) expect(files.has(p), p).toBe(true);
  });
  it('YAML：冒號、井字號、引號、換行、中文都安全；空陣列與 undefined 不輸出', () => {
    const y = frontmatterYaml({ title: '標題：有 # 與 "引號"', tags: [], none: undefined, nested: { url: '/blog/x/', list: ['a: b'] }, n: 0, b: false });
    expect(y).toContain('title: "標題：有 # 與 \\"引號\\""');
    expect(y).not.toContain('tags'); expect(y).not.toContain('none');
    expect(y).toContain('n: 0'); expect(y).toContain('b: false'); expect(y).toContain('    - "a: b"');
  });
  it('引用不存在的媒體 → 備份直接失敗，不是產出一份斷掉的備份', () => {
    const bad = JSON.parse(JSON.stringify(c)) as Corpus; bad.media = [];
    expect(() => exportCorpus(bad)).toThrow(/不在語料裡/);
  });
  it('路線的 YAML 與 git 的 schema 一致：gpx 寫成「<slug>.gpx」（不是 hasGpx），封面與替代文字也在、封面圖有檔案', () => {
    const route = { ...c.routes[0]!, hasGpx: true, cover: 3, coverAlt: '稜線封面' };
    const { files } = exportCorpus({ ...c, routes: [route, ...c.routes.slice(1)] });
    const y = (files.get(`routes/${route.date.slice(0, 4)}/${route.slug}.yaml`) as { text: string }).text;
    expect(y).toContain(`gpx: "${route.slug}.gpx"`);
    expect(y).not.toContain('hasGpx');
    expect(y).toContain('coverAlt: "稜線封面"');
    const cover = y.match(/^cover: "\.\/(.+)"$/m)?.[1];
    expect(cover).toBeTruthy();
    expect(files.has(`routes/${route.date.slice(0, 4)}/${cover}`)).toBe(true);
  });
  it('輸出是確定的', () => expect([...exportCorpus(c).files.entries()]).toEqual([...exportCorpus(c).files.entries()]));
});

const hasContent = existsSync(path.resolve(import.meta.dirname, '../../src/content/tales'));
describe.skipIf(!hasContent)('真實文章：匯出 → 讀回，內容樹與欄位完全相同', () => {
  it('25 篇已發佈的', () => {
    const g = readGitCorpus(path.resolve(import.meta.dirname, '../../src/content'));
    const published = { ...g.corpus, tales: g.corpus.tales.filter((t) => !g.drafts.has(`${t.date.slice(0, 4)}/${t.slug}`)) };
    const bad: string[] = [];
    published.tales.forEach((t, i) => {
      const back = readBack(published, i);
      const errs = back.problems.filter((p) => p.level === 'error');
      if (errs.length) return void bad.push(`${t.slug}：${errs[0]!.message}`);
      const a = JSON.stringify(lexicalToTree(back.state, t.slug)), b = JSON.stringify(lexicalToTree(t.content, t.slug));
      if (a !== b) { let k = 0; while (k < a.length && a[k] === b[k]) k++; bad.push(`${t.slug} 第 ${k} 字不同：「${a.slice(Math.max(0, k - 20), k + 30)}」 vs 「${b.slice(Math.max(0, k - 20), k + 30)}」`); }
      const fm = frontmatterToTale(parseFrontmatter(back.text).frontmatter);
      if (fm.missing.length || fm.issues.length) bad.push(`${t.slug} frontmatter 讀回有問題：${JSON.stringify([...fm.missing, ...fm.issues])}`);
    });
    expect(bad).toEqual([]);
  });
});
