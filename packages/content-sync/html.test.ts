import { describe, expect, it } from 'vitest';
import { blockHtml, esc, inlineHtml } from './html';

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
      .toBe('<table><tr><th>h</th></tr><tr><td>d</td></tr></table>');
  });
  it('元件類區塊回 null（交給 Astro）', () => {
    for (const b of [{ t: 'figure', media: '1', wide: false }, { t: 'ink' }] as const) expect(blockHtml(b as never)).toBeNull();
  });
});
