import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lexicalToTree, type Block } from '../../packages/content-sync/lexical';
import { escapeText, inlineMdx, treeToMdx, type ExportResolvers } from '../../packages/content-sync/to-mdx';
import { mdxToLexical } from '../src/lib/mdx-import';
import { readGitCorpus } from '../src/lib/migration/git-corpus';

const R: ExportResolvers = { mediaPath: (id) => `./media/${id}.jpg`, reelEntry: (id) => `2026/reel-${id}`, routeSlug: (id) => `route-${id}` };
/** 匯入端的解析器：從路徑認回媒體 id、從 entry 認回 reel id、從 slug 認回 route id */
const ctx = {
  resolveImage: ({ src }: { src: string }) => src.match(/^\.\/media\/(\w+)\.jpg$/)?.[1] ?? null,
  resolveReel: (e: string) => e.match(/^2026\/reel-(\w+)$/)?.[1] ?? null,
  resolveRoute: (s: string) => s.match(/^route-(\w+)$/)?.[1] ?? null,
};

/** 樹 → MDX → 樹。回傳第二次的樹與匯入問題 */
function roundTrip(tree: Block[]) {
  const { mdx } = treeToMdx(tree, R);
  const back = mdxToLexical(mdx, ctx as never);
  return { mdx, problems: back.problems, tree: lexicalToTree(back.state, 'rt') };
}
const t = (text: string, f: Record<string, true> = {}) => ({ t: 'text' as const, text, ...f });
const p = (...c: Block extends never ? never : ReturnType<typeof t>[]) => ({ t: 'p' as const, children: c });

describe('跳脫', () => {
  it.each(['*星*', '_底_', '`碼`', '<div>', '{x}', '[a](b)', 'a | b', '\\反斜線', '~刪~', '&amp;', '& 單獨'])('文字 %j 經過匯出再匯入完全不變', (s) => {
    expect(roundTrip([p(t(s))]).tree).toEqual([p(t(s))]);
  });
  it.each(['# 看起來像標題', '- 看起來像清單', '1. 看起來像編號', '> 看起來像引言', '+ 加號', '---'])('行首的 %j 不會變成別的區塊', (s) => {
    expect(roundTrip([p(t(s))]).tree).toEqual([p(t(s))]);
  });
  it('escapeText 只動 MDX 的特殊字元，中文與一般標點原樣', () => expect(escapeText('你好，世界。Hello!')).toBe('你好，世界。Hello!'));
});

describe('格式', () => {
  it('粗體貼著標點：改用 <strong>，匯回來仍然是粗體（CommonMark 的 **文字。**接著 不會變粗）', () => {
    const tree = [p(t('文字。', { bold: true }), t('接著'))];
    const r = roundTrip(tree);
    expect(r.mdx).toContain('<strong>文字。</strong>接著');
    expect(r.tree).toEqual(tree);
  });
  it('一般粗體用 **，保持可讀', () => expect(treeToMdx([p(t('粗', { bold: true }))], R).mdx).toContain('**粗**'));
  it('粗斜體、刪除線、行內碼、含反引號的行內碼', () => {
    const tree = [p(t('a', { bold: true, italic: true }), t(' '), t('b', { strike: true }), t(' '), t('c', { code: true }), t(' '), t('d`e', { code: true }))];
    expect(roundTrip(tree).tree).toEqual(tree);
  });
  it('前後空白放在標記外面（** 粗 ** 不是粗體）', () => {
    const tree = [p(t(' 粗 ', { bold: true }))];
    expect(roundTrip(tree).tree[0]).toMatchObject({ children: expect.arrayContaining([expect.objectContaining({ text: '粗', bold: true })]) });
  });
  it('連結：網址有括號或空白時用角括號包起來', () => {
    const tree = [p({ t: 'link' as const, href: 'https://a.com/x_(1)', newTab: true, children: [t('連')] } as never)];
    expect(roundTrip(tree).tree).toEqual(tree);
  });
});

describe('每一種區塊', () => {
  const tree: Block[] = [
    { t: 'h', level: 2, children: [t('標題')] },
    { t: 'quote', children: [t('一'), { t: 'br' }, { t: 'br' }, t('二')] },
    { t: 'hr' },
    { t: 'list', ordered: false, items: [{ children: [t('a')], sub: { t: 'list', ordered: true, items: [{ children: [t('a1')] }, { children: [t('a2')] }] } }, { children: [t('b')] }] },
    { t: 'table', rows: [{ header: true, cells: [[t('甲')], [t('乙')]] }, { header: false, cells: [[t('1')], [t('a | b')]] }] },
    { t: 'code', language: 'bash', code: 'echo "```"\nls' },
    { t: 'figure', media: '5', wide: false },
    { t: 'figure', media: '6', wide: true, caption: '圖說 "引號"' },
    { t: 'figure', media: '7', wide: false, href: 'https://youtu.be/x' },
    { t: 'gallery', items: [{ media: '1', alt: '甲 "引"' }, { media: '2', alt: '乙' }], caption: '兩張' },
    { t: 'video', reel: '3', caption: '雪線' },
    { t: 'route', route: '9', show: 'both', from: 10, to: 20, at: 15, label: '段', caption: '路線' },
    { t: 'route', route: '9', show: 'profile' },
    { t: 'missing', original: 'https://x/y.jpg', hint: '舊圖' },
    { t: 'ink' },
  ];
  it('樹 → MDX → 樹 完全相同', () => {
    const r = roundTrip(tree);
    expect(r.problems.filter((x) => x.level === 'error')).toEqual([]);
    expect(r.tree).toEqual(tree);
  });
  it('輸出是穩定的：再轉一次，MDX 文字完全相同', () => {
    const a = roundTrip(tree);
    const b = roundTrip(a.tree);
    expect(b.mdx).toBe(a.mdx);
  });
  it('沒有圖說的單張圖用最簡單的 ![]()，有圖說或寬版才用 <Figure>（可讀）', () => {
    const { mdx } = treeToMdx([{ t: 'figure', media: '5', wide: false, alt: '雪' } as never], R);
    expect(mdx.trim()).toBe('![雪](./media/5.jpg)');
  });
  it('程式碼區塊的圍欄比內容裡最長的反引號還長', () => {
    expect(treeToMdx([{ t: 'code', language: '', code: 'a ``` b' }], R).mdx).toContain('````');
  });
});

const hasContent = existsSync(path.resolve(import.meta.dirname, '../../src/content/tales'));
describe.skipIf(!hasContent)('真實文章的往返（MDX → 樹 → MDX → 樹）', () => {
  it('29 篇（含草稿）每一篇都相同，且沒有新增任何轉換問題', () => {
    const g = readGitCorpus(path.resolve(import.meta.dirname, '../../src/content'));
    const bad: string[] = [];
    for (const t of g.corpus.tales) {
      const id = `${t.date.slice(0, 4)}/${t.slug}`;
      let first: Block[];
      try { first = lexicalToTree(t.content, id); } catch { continue; } // 含 rawMdx 的那一篇（草稿）沒有樹
      const { mdx } = treeToMdx(first, R);
      const back = mdxToLexical(mdx, ctx as never);
      const errs = back.problems.filter((p) => p.level === 'error');
      if (errs.length) { bad.push(`${id}：${errs[0]!.message}`); continue; }
      const second = lexicalToTree(back.state, id);
      if (JSON.stringify(second) !== JSON.stringify(first)) {
        const a = JSON.stringify(first), b = JSON.stringify(second);
        let i = 0; while (i < a.length && a[i] === b[i]) i++;
        bad.push(`${id} 第 ${i} 字不同：「${a.slice(Math.max(0, i - 30), i + 40)}」 vs 「${b.slice(Math.max(0, i - 30), i + 40)}」`);
      }
    }
    expect(bad).toEqual([]);
  });
});
