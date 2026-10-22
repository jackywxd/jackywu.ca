import { describe, expect, it } from 'vitest';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { applySource, exportSource } from '../src/lib/source-mode';
import { mdxToLexical } from '../src/lib/mdx-import';

const ctx = { resolveImage: ({ src }: { src: string }) => (src === './a.jpg' ? '5' : null), resolveReel: () => '3', resolveRoute: () => '9' };
const state = (md: string) => mdxToLexical(md, ctx as never).state;

describe('原始碼模式', () => {
  const md = '## 標題\n\n文字 **粗**，[連結](https://a.com)。\n\n![](./a.jpg)\n\n<Video entry="2026/x" caption="雪線" />\n\n<Route of="w" show="both" from={1} to={2} />\n\n```bash\nls\n```\n';
  it('編輯器內容 → 原始碼 → 回到編輯器：前台看到的樹相同', () => {
    const s = state(md);
    const text = exportSource(s);
    expect(text).toContain('![](media:5)');
    expect(text).toContain('<Video entry="reel:3"');
    const back = applySource(text);
    expect(back.ok).toBe(true);
    expect(lexicalToTree(back.state, 'x')).toEqual(lexicalToTree(s, 'x'));
  });
  it('使用者在原始碼裡改字，套用後編輯器裡就是改過的字', () => {
    const back = applySource(exportSource(state(md)).replace('文字', '改過的字'));
    expect(JSON.stringify(lexicalToTree(back.state, 'x'))).toContain('改過的字');
  });
  it('語法錯誤：不套用（ok=false），並指出行號；原來的內容不受影響', () => {
    const r = applySource('正常\n\n<Open>\n');
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatchObject({ level: 'error', message: expect.stringContaining('解析失敗') });
  });
  it('引用不存在的媒體（打錯 id 的格式）→ 錯誤，不是默默丟掉', () => {
    expect(applySource('![](media-12)\n').ok).toBe(false);
  });
  it('原樣保留的 rawMdx 區塊：匯出、再匯回來都還在，且不擋住套用（只是警告）', () => {
    const s = state('<Chart data={rows} />\n');
    const text = exportSource(s);
    expect(text).toContain('<Chart data={rows} />');
    const back = applySource(text);
    expect(back.ok).toBe(true);
    expect(back.problems.every((p) => p.level === 'warn')).toBe(true);
    expect(JSON.stringify(back.state)).toContain('rawMdx');
  });
  it('內嵌 HTML（圖表）在原始碼裡寫成 JSX，改了圖說文字，套用後就是改過的', () => {
    const s = state('<figure className="viz">\n  <svg viewBox="0 0 10 10">\n    <text x="1" y="2" textAnchor="middle">76</text>\n  </svg>\n  <figcaption>原本的圖說</figcaption>\n</figure>\n');
    const text = exportSource(s);
    expect(text).toContain('<text x="1" y="2" text-anchor="middle">76</text>'); // 原稿寫 textAnchor，存的與匯出的都是真名
    const back = applySource(text.replace('原本的圖說', '改過的圖說'));
    expect(back.ok).toBe(true);
    expect(lexicalToTree(back.state, 'x')).toEqual([{ t: 'html', nodes: [{ tag: 'figure', attrs: { class: 'viz' }, children: [
      { tag: 'svg', attrs: { viewBox: '0 0 10 10' }, children: [{ tag: 'text', attrs: { x: '1', y: '2', 'text-anchor': 'middle' }, children: ['76'] }] },
      { tag: 'figcaption', children: ['改過的圖說'] },
    ] }] }]);
  });
});
