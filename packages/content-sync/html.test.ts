import { describe, expect, it } from 'vitest';
import { blockHtml, esc, inlineHtml, smarten } from './html';

describe('跳脫', () => {
  it('五個字元都跳脫', () => expect(esc(`<a href="x" onclick='y'>&`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;'));
  it('文字裡的 script 不會變成標籤', () => {
    expect(inlineHtml([{ t: 'text', text: '<script>alert(1)</script>' }])).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('連結網址裡的引號不能跳出屬性', () => {
    const h = inlineHtml([{ t: 'link', href: 'https://a.com/"onmouseover="x', newTab: false, children: [{ t: 'text', text: 'k' }] }]);
    expect(h).not.toMatch(/"onmouseover/);
    expect(h).toContain('&quot;onmouseover');
  });
  it('縱深防禦：不安全的協定即使溜進樹裡也拒絕輸出', () => {
    expect(() => inlineHtml([{ t: 'link', href: 'javascript:alert(1)', newTab: false, children: [] }])).toThrow(/不安全/);
  });
});

describe('格式', () => {
  it('巢狀格式標籤的順序固定', () => {
    expect(inlineHtml([{ t: 'text', text: 'x', bold: true, italic: true, code: true }])).toBe('<strong><em><code>x</code></em></strong>');
  });
  it('新分頁連結帶 noopener', () => {
    expect(inlineHtml([{ t: 'link', href: 'https://a.com', newTab: true, children: [{ t: 'text', text: 'go' }] }]))
      .toBe('<a href="https://a.com" target="_blank" rel="noopener noreferrer">go</a>');
  });
});

describe('區塊', () => {
  const tx = (s: string) => [{ t: 'text' as const, text: s }];
  it('標題、引言、分隔線', () => {
    expect(blockHtml({ t: 'h', level: 2, children: tx('a') })).toBe('<h2>a</h2>');
    expect(blockHtml({ t: 'quote', children: tx('q') })).toBe('<blockquote><p>q</p></blockquote>');
    expect(blockHtml({ t: 'hr' })).toBe('<hr>');
  });
  it('巢狀清單', () => {
    expect(blockHtml({ t: 'list', ordered: false, items: [{ children: tx('a'), sub: { t: 'list', ordered: true, items: [{ children: tx('b') }] } }] }))
      .toBe('<ul><li>a<ol><li>b</li></ol></li></ul>');
  });
  it('表格：表頭列用 th', () => {
    expect(blockHtml({ t: 'table', rows: [{ header: true, cells: [tx('h')] }, { header: false, cells: [tx('d')] }] }))
      .toBe('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>');
  });
  it('元件類區塊回 null（交給 Astro）', () => {
    for (const b of [{ t: 'figure', media: '1', wide: false }, { t: 'ink' }] as const) expect(blockHtml(b as never)).toBeNull();
  });
});

describe('smarten：與 Astro markdown 引擎一致的標點', () => {
  it.each([
    ["That's fine", 'That’s fine'], ['say "hi" now', 'say “hi” now'], ['("quoted")', '(“quoted”)'], ["'single' ok", '‘single’ ok'],
    ['wait...', 'wait…'], ['a -- b', 'a – b'], ['a --- b', 'a — b'], ['"開頭"', '“開頭”'], ['沒有標點', '沒有標點'],
  ])('%j → %j', (i, o) => expect(smarten(i)).toBe(o));
  it('行內程式碼不套用', () => {
    expect(inlineHtml([{ t: 'text', text: "it's -- x", code: true }])).toBe("<code>it&#39;s -- x</code>");
  });
  it('套用後仍會跳脫（不能因為換了字元就漏掉 <）', () => {
    expect(inlineHtml([{ t: 'text', text: '<b> "x" </b>' }])).toBe('&lt;b&gt; “x” &lt;/b&gt;');
  });
});

import { createRequire } from 'node:module';
import type { Inline } from './lexical';
/**
 * 標點與 git 模式一模一樣：拿 git 模式真正用的那個引擎（@astrojs/mdx → markdown-satteri → satteri，
 * 同樣的 smartPunctuation 設定）當答案，而不是我們自己寫的規則。satteri 是原生模組，規則讀不到原始碼。
 */
describe('引號、破折號、刪節號：與 git 模式（satteri）逐字相同', () => {
  const req = createRequire(createRequire(createRequire(import.meta.url).resolve('@astrojs/mdx/package.json')).resolve('@astrojs/markdown-satteri'));
  const { markdownToHtml } = req('satteri') as { markdownToHtml: (s: string, o: object) => { html: string } };
  const oracle = (md: string) => markdownToHtml(md, { features: { gfm: true, smartPunctuation: true } }).html.trim().replace(/^<p>|<\/p>$/g, '');
  const t = (text: string, extra: Partial<Inline & { t: 'text' }> = {}): Inline => ({ t: 'text', text, ...extra });
  const cases: [string, Inline[]][] = [
    ['他說"你好"', [t('他說"你好"')]],
    ['「他說，"走"」', [t('「他說，"走"」')]],
    ['他說"你好"，然後"再見"。', [t('他說"你好"，然後"再見"。')]],
    ['"Hello," she said.', [t('"Hello," she said.')]],
    ["It's John's book.", [t("It's John's book.")]],
    ["'single' quotes", [t("'single' quotes")]],
    ["中文'單引號'中文", [t("中文'單引號'中文")]],
    ['("括號裡的")', [t('("括號裡的")')]],
    ['"沒有關起來', [t('"沒有關起來')]],
    ['a -- b --- c ... d', [t('a -- b --- c ... d')]],
    ['2010--2020', [t('2010--2020')]],
    ['a "**粗體**" b', [t('a "'), t('粗體', { bold: true }), t('" b')]],
    ['"*斜體*"後面', [t('"'), t('斜體', { italic: true }), t('"後面')]],
    ['用 `"x"` 不轉', [t('用 '), t('"x"', { code: true }), t(' 不轉')]],
  ];
  // 文字節點裡的 " 與 ' 要不要寫成實體只是跳脫方式不同，畫出來一樣
  const norm = (h: string) => h.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  it.each(cases)('%j', (md, nodes) => expect(norm(inlineHtml(nodes))).toBe(norm(oracle(md))));
});

describe('區塊的 HTML 結構與 git 模式（satteri）相同', () => {
  const req = createRequire(createRequire(createRequire(import.meta.url).resolve('@astrojs/mdx/package.json')).resolve('@astrojs/markdown-satteri'));
  const { markdownToHtml } = req('satteri') as { markdownToHtml: (s: string, o: object) => { html: string } };
  const oracle = (md: string) => markdownToHtml(md, { features: { gfm: true, smartPunctuation: true } }).html;
  const flat = (h: string) => h.replace(/>\s+</g, '><').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const tx = (s: string): Inline[] => [{ t: 'text', text: s }];
  it('多段引言是兩個 <p>，不是一個 <p> 裡夾 <br><br>', () =>
    expect(flat(blockHtml({ t: 'quote', children: [...tx('一'), { t: 'br' }, { t: 'br' }, ...tx('二')] })!)).toBe(flat(oracle('> 一\n>\n> 二'))));
  it('表格有 thead 與 tbody', () =>
    expect(flat(blockHtml({ t: 'table', rows: [{ header: true, cells: [tx('甲'), tx('乙')] }, { header: false, cells: [tx('1'), tx('2')] }] })!))
      .toBe(flat(oracle('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |'))));
  it('從 5 開始的有序清單', () =>
    expect(flat(blockHtml({ t: 'list', ordered: true, start: 5, items: [{ children: tx('五') }, { children: tx('六') }] })!)).toBe(flat(oracle('5. 五\n6. 六'))));
});

describe('標題的 id：與 git 模式同一個 slugger（站內的 #錨點 連結才不會斷）', () => {
  it('中文標題、重複的標題（第二個加 -1）、標題裡的引號', async () => {
    const Slugger = (await import('github-slugger')).default;
    const s = new Slugger();
    const ctx = { slug: (text: string) => s.slug(text) };
    const ref = new Slugger();
    expect(blockHtml({ t: 'h', level: 2, children: [{ t: 'text', text: '出發前' }] }, ctx)).toBe(`<h2 id="${ref.slug('出發前')}">出發前</h2>`);
    expect(blockHtml({ t: 'h', level: 2, children: [{ t: 'text', text: '出發前' }] }, ctx)).toBe(`<h2 id="${ref.slug('出發前')}">出發前</h2>`);
    expect(blockHtml({ t: 'h', level: 3, children: [{ t: 'text', text: '他說"好"' }] }, ctx)).toBe(`<h3 id="${ref.slug('他說“好”')}">他說“好”</h3>`);
  });
  it('沒給 slugger（例如後台預覽）就不加 id', () => expect(blockHtml({ t: 'h', level: 2, children: [{ t: 'text', text: 'a' }] })).toBe('<h2>a</h2>'));
});
