import { describe, expect, it } from 'vitest';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { mdxToLexical, parseFrontmatter, type ImportContext } from '../src/lib/mdx-import';

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
    const src = '---\ntitle: x\ndate: 2026-02-08\n---\n\n<style>{`.a{}`}</style>\n';
    expect(mdxToLexical(src, ctx()).problems.map((p) => p.where)).toEqual(['行 6']);
    expect(mdxToLexical('\n<style>{`.a{}`}</style>\n', ctx()).problems.map((p) => p.where)).toEqual(['行 2']);
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
    const r = mdxToLexical('<figure className="viz"><svg/></figure>\n', ctx());
    expect(r.problems[0]).toMatchObject({ level: 'error' });
    const b = (r.state.root as { children: { fields?: { blockType: string; source: string } }[] }).children[0]!;
    expect(b.fields).toMatchObject({ blockType: 'rawMdx', source: '<figure className="viz"><svg/></figure>' });
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
