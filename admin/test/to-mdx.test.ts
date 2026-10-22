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

describe('審查時找到的往返遺失（每一條：樹 → MDX → 樹 必須相同，而且沒有錯誤）', () => {
  const same = (tree: Block[]) => {
    const r = roundTrip(tree);
    expect(r.problems.filter((x) => x.level === 'error')).toEqual([]);
    expect(r.tree).toEqual(tree);
  };
  it('有圖說的圖也帶連結：連結不能不見', () => same([{ t: 'figure', media: '6', wide: false, caption: '看影片', href: 'https://youtu.be/x' }]));
  it('寬版的圖帶連結', () => same([{ t: 'figure', media: '6', wide: true, href: 'https://youtu.be/x' }]));
  it('從 5 開始的有序清單', () => same([{ t: 'list', ordered: true, start: 5, items: [{ children: [t('五')] }, { children: [t('六')] }] }]));
  it.each(['- 不是清單', '1. 不是編號', '# 不是標題'])('引言的開頭是 %j：不能在引言裡變成別的區塊', (s) => same([{ t: 'quote', children: [t(s)] }]));
  it('引言換行之後接 # ：同上', () => same([{ t: 'quote', children: [t('第一行'), { t: 'br' }, t('# 第二行')] }]));
  it.each(['- 第二行', '# 第二行', '> 第二行', '1. 第二行'])('段落裡的換行後面接 %j：不能拆成兩個區塊', (s) => same([p(t(`第一行\n${s}`))]));
  it('表格儲存格裡含 | 的行內程式碼：不能把儲存格切開', () => same([{ t: 'table', rows: [{ header: true, cells: [[t('指令')], [t('說明')]] }, { header: false, cells: [[t('a|b', { code: true })], [t('管線')]] }] }]));
  it('粗體的行內程式碼：粗體不能不見', () => same([p(t('npm', { bold: true, code: true }))]));
  it('圖說裡的 & ：不能被當成 HTML 實體（A &copy; B 不能變成 A © B）', () => same([{ t: 'figure', media: '6', wide: false, caption: 'A &copy; B' }]));
});

describe('內嵌 HTML 的往返（樹 → MDX → 樹 必須相同，而且沒有錯誤）', () => {
  const same = (nodes: unknown[]) => {
    const r = roundTrip([{ t: 'html', nodes } as Block]);
    expect(r.problems).toEqual([]);
    expect(r.tree).toEqual([{ t: 'html', nodes }]);
    return r.mdx;
  };
  it('樣式：縮排、反引號、反斜線、${ 都原樣（MDX 讀樣板字串會吃掉兩格縮排）', () => {
    const mdx = same([{ tag: 'style', children: ['\n.a { content: "\\201C"; }\n  .b::after { content: "`${x}`"; }\n\t.c{}\n'] }]);
    expect(mdx).toContain('<style>{`');
  });
  it('圖表：class 寫成 className，其餘寫真名（textAnchor 在 git 模式不生效），子元素一層一行', () => {
    const mdx = same([{ tag: 'figure', attrs: { class: 'viz-root' }, children: [
      { tag: 'svg', attrs: { viewBox: '0 0 720 352', width: '100%', role: 'img', 'aria-label': '負荷' }, children: [
        { tag: 'title', children: ['每趟負荷'] },
        { tag: 'line', attrs: { x1: '46', 'stroke-width': '1', class: 'viz-grid' } },
        { tag: 'text', attrs: { x: '36', 'text-anchor': 'end' }, children: ['0'] },
        { tag: 'text', attrs: { x: '79', 'text-anchor': 'middle' }, children: ['76'] },
        { tag: 'linearGradient', attrs: { id: 'g' }, children: [{ tag: 'stop', attrs: { offset: '0', 'stop-color': '#fff' } }] },
        { tag: 'rect', attrs: { fill: 'url(#g)' } },
      ] },
      { tag: 'figcaption', children: [{ tag: 'p', children: ['十趟的負荷。\n', { tag: 'strong', children: ['兩組不重疊。'] }, '完'] }] },
    ] }]);
    expect(mdx).toContain('<figure className="viz-root">\n  <svg');
    expect(mdx).toContain('<text x="36" text-anchor="end">0</text>');
    expect(mdx).toContain('stroke-width="1"');
    expect(mdx).not.toMatch(/textAnchor|strokeWidth/);
  });
  it.each(['*星* _底_ `碼`', '{x} <div>', '[a](b) | c', 'A &copy; B', '前 後 ', '第一行\n- 第二行'])('文字 %j 原樣', (text) => {
    same([{ tag: 'div', children: [{ tag: 'span', children: [text] }] }]);
  });
  it('屬性含引號、& 與換行', () => { same([{ tag: 'div', attrs: { title: '他說 "好" & 走\n吧', 'data-x': '' }, children: ['x'] }]); });
});

describe('匯入端：不能默默接受或丟掉', () => {
  const imp = (src: string) => { const r = mdxToLexical(src, ctx as never); return { problems: r.problems, tree: lexicalToTree(r.state, 'i', { allowRaw: true }) }; };
  it('wide={false} 不是寬版', () => expect(imp("import m1 from './media/5.jpg';\n\n<Figure src={m1} wide={false} />\n").tree[0]).toMatchObject({ t: 'figure', wide: false }));
  it('圖組的項目屬性順序不同也認得（先 alt 後 src）', () => {
    const r = imp("import m1 from './media/1.jpg';\nimport m2 from './media/2.jpg';\n\n<Gallery images={[{ alt: '甲', src: m1 }, { src: m2, alt: '乙' }]} />\n");
    expect(r.tree[0]).toMatchObject({ t: 'gallery', items: [{ media: '1', alt: '甲' }, { media: '2', alt: '乙' }] });
  });
  it('圖組裡有一張認不出來：要報出來，不能默默少一張', () => {
    const r = imp("import m1 from './media/1.jpg';\nimport m2 from './media/2.jpg';\n\n<Gallery images={[{ src: m1 }, { src: m2, alt: '乙' }]} />\n");
    expect(r.problems.some((x) => /圖組/.test(x.message) && /第 1 張/.test(x.message))).toBe(true);
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', '../2025/x/'])('連結 %j：匯入時就報錯，不等到建置', (href) => {
    expect(imp(`[點我](${href})\n`).problems.some((x) => x.level === 'error' && /連結/.test(x.message))).toBe(true);
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
      // 每一篇都要有樹：先前含 <style>／<svg> 的草稿導不進來，這裡就默默跳過它，往返從來沒驗到那篇
      try { first = lexicalToTree(t.content, id); } catch (e) { bad.push(`${id}：${(e as Error).message}`); continue; }
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
