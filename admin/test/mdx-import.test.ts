import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { markupHtml } from '../../packages/content-sync/html';
import { mdxToLexical, parseFrontmatter, type ImportContext } from '../src/lib/mdx-import';
import { readGitCorpus } from '../src/lib/migration/git-corpus';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  resolveImage: ({ src }) => (src.startsWith('./') ? `img:${src}` : null),
  resolveReel: (e) => (e === '2026/metal-dome' ? 7 : null),
  resolveRoute: (s) => (s === 'whistler' ? 9 : null),
  ...over,
});
const conv = (src: string, c = ctx()) => {
  const r = mdxToLexical(src, c);
  return { ...r, tree: lexicalToTree(r.state, 'test') };
};

describe('frontmatter', () => {
  it('日期保持字串，不被 YAML 解析成 Date', () => {
    expect(parseFrontmatter('---\ndate: 2026-02-08\ntitle: x\n---\nbody').frontmatter.date).toBe('2026-02-08');
  });
  it('沒有 frontmatter 也行', () => expect(parseFrontmatter('hello').body).toBe('hello'));
  it('問題的行號是檔案裡的行號（算進 frontmatter），使用者才找得到', () => {
    // 實際發生過：frontmatter 12 行，<style> 在檔案第 14 行，導入卻說「行 2」
    const src = '---\ntitle: x\ndate: 2026-02-08\n---\n\n<Chart data={rows} />\n';
    expect(mdxToLexical(src, ctx()).problems.map((p) => p.where)).toEqual(['行 6']);
    expect(mdxToLexical('\n<Chart data={rows} />\n', ctx()).problems.map((p) => p.where)).toEqual(['行 2']);
  });
});

describe('文字', () => {
  it('段落、粗斜體、刪除線、行內碼、連結', () => {
    const { tree, problems } = conv('我 **粗** *斜* ~~刪~~ `碼` [連結](https://a.com)\n');
    expect(problems).toEqual([]);
    const p = tree[0] as { t: 'p'; children: { t: string; text?: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; href?: string }[] };
    expect(p.children.find((c) => c.text === '粗')).toMatchObject({ bold: true });
    expect(p.children.find((c) => c.text === '斜')).toMatchObject({ italic: true });
    expect(p.children.find((c) => c.text === '刪')).toMatchObject({ strike: true });
    expect(p.children.find((c) => c.text === '碼')).toMatchObject({ code: true });
    expect(p.children.find((c) => c.t === 'link')).toMatchObject({ href: 'https://a.com' });
  });
  it('H1 降為 H2 並警告；H5 升為 H4', () => {
    const { tree, problems } = conv('# a\n\n##### b\n');
    expect(tree).toMatchObject([{ t: 'h', level: 2 }, { t: 'h', level: 4 }]);
    expect(problems.map((p) => p.level)).toEqual(['warn', 'warn']);
  });
  it('引言、分隔線、巢狀清單、表格', () => {
    const { tree, problems } = conv('> 引言\n\n---\n\n- a\n  - a1\n- b\n\n| h1 | h2 |\n|---|---|\n| 1 | 2 |\n');
    expect(problems).toEqual([]);
    expect(tree.map((b) => b.t)).toEqual(['quote', 'hr', 'list', 'table']);
  });
  it('MDX 註解 {/* */} 被丟棄，不輸出也不報錯', () => {
    const { tree, problems } = conv('前\n\n{/* 給自己看的 */}\n\n後\n');
    expect(problems).toEqual([]);
    expect(tree).toHaveLength(2);
  });
  it('程式碼區塊保留語言與內容', () => {
    expect(conv('```bash\necho 1\n```\n').tree[0]).toEqual({ t: 'code', language: 'bash', code: 'echo 1' });
  });
});

describe('圖片', () => {
  it('本機圖片 → figure 區塊，用 resolveImage 換成媒體 id', () => {
    const { tree } = conv('![雪山](./a.jpg)\n');
    expect(tree[0]).toMatchObject({ t: 'figure', media: 'img:./a.jpg' });
  });
  it('段落中間的圖：拆成 文字 / 圖 / 文字，順序不變', () => {
    expect(conv('前面 ![x](./a.jpg) 後面\n').tree.map((b) => b.t)).toEqual(['p', 'figure', 'p']);
  });
  it('外站圖片不轉存 → 待補圖區塊，並保留原網址', () => {
    expect(conv('![x](https://lh3.googleusercontent.com/x)\n').tree[0]).toMatchObject({ t: 'missing', original: 'https://lh3.googleusercontent.com/x' });
  });
  it('本機圖片找不到 → 報錯並以待補圖頂替，不是消失', () => {
    const r = conv('![x](./gone.jpg)\n', ctx({ resolveImage: () => null }));
    expect(r.problems.some((p) => p.level === 'error' && /gone\.jpg/.test(p.message))).toBe(true);
    expect(r.tree[0]!.t).toBe('missing');
  });
});

describe('站內元件', () => {
  it('Figure／Gallery 透過 import 對照找到檔案', () => {
    const { tree, problems } = conv([
      "import a from './a.jpg';", "import b from './b.jpg';", '',
      '<Figure src={a} alt="甲" caption="圖說" wide />', '',
      '<Gallery images={[{ src: a, alt: "甲" }, { src: b, alt: "乙" }]} caption="兩張" />', '',
    ].join('\n'));
    expect(problems).toEqual([]);
    expect(tree[0]).toMatchObject({ t: 'figure', media: 'img:./a.jpg', caption: '圖說', wide: true });
    expect(tree[1]).toMatchObject({ t: 'gallery', caption: '兩張', items: [{ alt: '甲' }, { alt: '乙' }] });
  });
  it('Video／Route／MissingImage／InkRule', () => {
    const { tree, problems } = conv([
      '<Video entry="2026/metal-dome" caption="下滑" />', '',
      '<Route of="whistler" show="both" from={40} to={55} label="段" />', '',
      '<MissingImage original="https://x/y.jpg" hint="舊圖" />', '', '<InkRule />', '',
    ].join('\n'));
    expect(problems).toEqual([]);
    expect(tree).toMatchObject([{ t: 'video', reel: '7' }, { t: 'route', route: '9', show: 'both', from: 40, to: 55 }, { t: 'missing' }, { t: 'ink' }]);
  });
  it('引用不存在的影片／路線 → 報錯，不是靜默略過', () => {
    const r = conv('<Video entry="nope" />\n\n<Route of="nope" />\n');
    expect(r.problems.filter((p) => p.level === 'error')).toHaveLength(2);
    expect(r.tree).toEqual([]);
  });
  it('Figure 的 src 找不到 import → 報錯', () => {
    expect(mdxToLexical('<Figure src={ghost} alt="x" />\n', ctx()).problems[0]).toMatchObject({ level: 'error' });
  });
});

describe('轉不了的東西絕不默默丟掉', () => {
  it('未知的 JSX 保留成 rawMdx 區塊並報錯', () => {
    const r = mdxToLexical('<Chart data={rows} />\n', ctx());
    expect(r.problems[0]).toMatchObject({ level: 'error' });
    const b = (r.state.root as { children: { fields?: { blockType: string; source: string } }[] }).children[0]!;
    expect(b.fields).toMatchObject({ blockType: 'rawMdx', source: '<Chart data={rows} />' });
    // 渲染端會拒絕它（發佈前必須處理）
    expect(() => lexicalToTree(r.state, 'x')).toThrow(/rawMdx/);
  });
  it('一般表達式 → 報錯', () => {
    expect(mdxToLexical('{1 + 1}\n', ctx()).problems[0]).toMatchObject({ level: 'error' });
  });
  it('MDX 語法錯誤 → 回報行號，不丟例外', () => {
    const r = mdxToLexical('正常\n\n<Open>\n', ctx());
    expect(r.problems[0]).toMatchObject({ level: 'error' });
    expect(r.problems[0]!.message).toMatch(/解析失敗/);
  });
  it('行內未知元件：保留文字內容並報錯', () => {
    const r = mdxToLexical('前 <Weird>內容</Weird> 後\n', ctx());
    expect(r.problems.some((p) => /Weird/.test(p.message))).toBe(true);
  });
});

type Html = { t: 'html'; nodes: unknown[] };
const fieldsOf = (state: Record<string, unknown>) => (state.root as { children: { fields?: Record<string, unknown> }[] }).children.map((c) => c.fields);

describe('內嵌 HTML（自帶樣式的圖表）', () => {
  const chart = [
    '<style>{`',
    '  .viz-root { --viz-bare:#2a78d6; }',
    '  .viz-bare { fill:var(--viz-bare); }',
    '`}</style>', '',
    '<figure className="viz-root">',
    '  <svg viewBox="0 0 720 352" width="100%" role="img" aria-label="每趟的負荷">',
    '    <title>每趟負荷</title>',
    '    <line x1="46" y1="268.0" x2="706" y2="268.0" className="viz-grid" />',
    '    <text x="36" y="272.0" textAnchor="end" className="viz-axis">0</text>',
    '    <text x="79.0" y="76.1" textAnchor="middle" className="viz-val">76</text>',
    '    <path d="M 47.0 268 L 47.0 88.1 Z" className="viz-bare" />',
    '  </svg>',
    '  <figcaption>',
    '    十趟的負荷。',
    '    <strong>帶杖組最差的一趟，仍然低於徒手組最好的一趟。</strong>兩組毫無重疊。',
    '  </figcaption>',
    '</figure>', '',
  ].join('\n');

  it('<style> 與 <figure><svg> 變成內嵌 HTML 區塊，沒有任何問題', () => {
    const { tree, problems } = conv(chart);
    expect(problems).toEqual([]);
    expect(tree.map((b) => b.t)).toEqual(['html', 'html']);
  });
  it('屬性存成瀏覽器認得的真名：className → class、textAnchor → text-anchor（照抄 textAnchor 文字會對不齊）', () => {
    const html = markupHtml((conv(chart).tree[1] as Html).nodes as never);
    expect(html).toContain('<figure class="viz-root">');
    expect(html).toContain('<text x="36" y="272.0" text-anchor="end" class="viz-axis">0</text>');
    expect(html).not.toMatch(/textAnchor|className/);
  });
  it('<svg> 裡獨占一行的 <text>、<title> 不會被包進 <p>（瀏覽器在 SVG 裡看到 <p> 會提前結束整張圖）', () => {
    const html = markupHtml((conv(chart).tree[1] as Html).nodes as never);
    const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
    expect(svg).not.toContain('<p>');
    expect(svg).toContain('<title>每趟負荷</title>');
  });
  it('圖說裡的 Markdown 文字與 <strong> 都在，是一段 <p>（與 MDX 的渲染相同）', () => {
    const html = markupHtml((conv(chart).tree[1] as Html).nodes as never);
    expect(html).toContain('<figcaption><p>十趟的負荷。\n<strong>帶杖組最差的一趟，仍然低於徒手組最好的一趟。</strong>兩組毫無重疊。</p></figcaption>');
  });
  it('<style> 的 CSS 原樣保留（不跳脫、不改寫）', () => {
    const html = markupHtml((conv(chart).tree[0] as Html).nodes as never);
    expect(html).toBe('<style>\n.viz-root { --viz-bare:#2a78d6; }\n.viz-bare { fill:var(--viz-bare); }\n</style>');
  });
  it('一行寫完的 <svg>…</svg>（MDX 讀成一段）也是內嵌 HTML', () => {
    const r = conv('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r={4} /></svg>\n');
    expect(r.problems).toEqual([]);
    expect(r.tree).toEqual([{ t: 'html', nodes: [{ tag: 'svg', attrs: { viewBox: '0 0 10 10' }, children: [{ tag: 'circle', attrs: { cx: '5', cy: '5', r: '4' } }] }] }]);
  });
  it('整段只有行內格式（匯出器寫的 <a target="_blank">）仍是段落與連結，不是內嵌 HTML', () => {
    expect(conv('<a href="https://a.com" target="_blank">開新分頁</a>\n').tree[0]).toMatchObject({ t: 'p', children: [{ t: 'link', newTab: true }] });
  });
  it.each([
    ['<script>', '<figure>\n  <script>{`alert(1)`}</script>\n</figure>\n', /script/],
    ['事件屬性', '<div onClick="alert(1)">x</div>\n', /onClick/],
    ['javascript: 連結', '<figure>\n  <a href="javascript:alert(1)">x</a>\n</figure>\n', /javascript/],
    ['@import', '<style>{`@import "https://evil/x.css";`}</style>\n', /@import/],
    ['樣式裡的 url()', '<div style="background:url(https://evil/p.png)">x</div>\n', /url/],
    ['SVG 裡的 HTML', '<svg viewBox="0 0 1 1">\n  <p>文字</p>\n</svg>\n', /<svg> 裡不能放 HTML 的 <p>/],
    ['外部圖片', '<svg viewBox="0 0 1 1">\n  <image href="https://evil/x.png" />\n</svg>\n', /image/],
    ['變數', '<svg viewBox={box} />\n', /viewBox 不是固定的值/],
  ])('不在白名單裡（%s）：整段原樣保留成 RawMdx 並說明原因，不拆一半', (_name, src, why) => {
    const r = mdxToLexical(src, ctx());
    const errs = r.problems.filter((p) => p.level === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(why);
    expect(fieldsOf(r.state)).toEqual([expect.objectContaining({ blockType: 'rawMdx', source: src.trimEnd() })]);
  });
});

describe('清單項目裡的區塊', () => {
  it('編號清單第 2 項裡的表格搬到清單外面，同一項後面的文字跟著搬，後面的項目接著編號', () => {
    const r = conv('1. 一\n2. 二：\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n\n   **表格之後**\n\n3. 三\n4. 四\n');
    expect(r.tree.map((b) => b.t)).toEqual(['list', 'table', 'p', 'list']);
    expect(r.tree[0]).toMatchObject({ ordered: true, items: [{ children: [{ text: '一' }] }, { children: [{ text: '二：' }] }] });
    expect(r.tree[0]).not.toHaveProperty('start');
    expect(r.tree[2]).toMatchObject({ children: [{ text: '表格之後', bold: true }] });
    expect(r.tree[3]).toMatchObject({ ordered: true, start: 3, items: [{ children: [{ text: '三' }] }, { children: [{ text: '四' }] }] });
    expect(r.problems).toEqual([expect.objectContaining({ level: 'warn', message: expect.stringContaining('清單第 2 項裡的表格搬到清單外面') })]);
  });
  it('項目清單最後一項裡的程式碼：搬出來，提醒裡不提「接著編號」', () => {
    const r = conv('- a\n- b\n\n  ```bash\n  ls\n  ```\n');
    expect(r.tree.map((b) => b.t)).toEqual(['list', 'code']);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]!.message).not.toMatch(/接著編號/);
  });
});

const content = path.resolve(import.meta.dirname, '../../src/content');
describe.skipIf(!existsSync(path.join(content, 'tales')))('真實文章', () => {
  it('git 裡每一篇文章（含草稿）導入都沒有任何錯誤：沒有 RawMdx、沒有遺失的內容', () => {
    const g = readGitCorpus(content);
    expect(g.problems.filter((p) => p.problem.level === 'error').map((p) => `${p.file} ${p.problem.where}：${p.problem.message}`)).toEqual([]);
    expect(JSON.stringify(g.corpus.tales.map((t) => t.content))).not.toContain('rawMdx');
  });
  it('Grouse Grind 那篇：樣式與圖表是內嵌 HTML，清單裡的表格搬到清單外，九張表一張不少', () => {
    const t = readGitCorpus(content).corpus.tales.find((x) => x.slug === 'grouse-grind-pole-experiment')!;
    const tree = lexicalToTree(t.content, 'grouse');
    expect(tree.filter((b) => b.t === 'html')).toHaveLength(2);
    expect(tree.filter((b) => b.t === 'table')).toHaveLength(9);
    expect(markupHtml((tree.find((b) => b.t === 'html' && JSON.stringify(b).includes('figure')) as Html).nodes as never)).toContain('<text x="79.0" y="76.1" text-anchor="middle" class="viz-val">76</text>');
  });
});
