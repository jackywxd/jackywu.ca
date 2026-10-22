import { describe, expect, it } from 'vitest';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { mdxToLexical } from '../src/lib/mdx-import';
import { emptyState, headlessRoundTrip } from '../src/editor/serialize';

/**
 * 編輯器打開再存回去，內容不能變：用「語意」比較（前台吃的那棵樹），不比位元組。
 * 輸入用 MDX 轉換器的輸出，涵蓋真實文章會有的每一種結構。
 */
const ctx = {
  resolveImage: ({ src }: { src: string }) => (src.startsWith('./') ? 5 : null),
  resolveReel: () => 7, resolveRoute: () => 9,
};
const doc = [
  '## 出發', '', '我 **粗** *斜* ~~刪~~ `碼` [連結](https://a.com/x?y=1&z=2)，結束。', '', '> 引言一', '', '---', '',
  '- 水', '  - 巢狀', '- 鹽', '', '1. 一', '2. 二', '', '| 公里 | 配速 |', '|---|---|', '| 10 | 6:10 |', '',
  '![林間](./a.jpg)', '', '[![縮圖](./b.jpg)](https://youtu.be/x)', '', '```bash', 'echo "hi"', '```', '',
  '<Video entry="2026/x" caption="雪線" />', '', '<Route of="w" show="both" from={10} to={20} />', '',
  '<MissingImage original="https://x/y.jpg" hint="舊圖" />', '', '<InkRule />', '',
].join('\n');

describe('編輯器序列化', () => {
  const src = mdxToLexical(doc, ctx as never);
  it('轉換本身沒有問題', () => expect(src.problems.filter((p) => p.level === 'error')).toEqual([]));

  it('載入再匯出：前台看到的樹完全相同', async () => {
    const out = await headlessRoundTrip(src.state as never);
    expect(lexicalToTree(out, 'x')).toEqual(lexicalToTree(src.state, 'x'));
  });
  it('再轉一次也相同（穩定，不會越存越變）', async () => {
    const once = await headlessRoundTrip(src.state as never);
    const twice = await headlessRoundTrip(once);
    expect(twice).toEqual(once);
  });
  it('每一種區塊都還在（沒有被編輯器吃掉）', async () => {
    const out = await headlessRoundTrip(src.state as never);
    const kinds = lexicalToTree(out, 'x').map((b) => b.t);
    for (const k of ['h', 'p', 'quote', 'hr', 'list', 'table', 'figure', 'code', 'video', 'route', 'missing', 'ink']) expect(kinds).toContain(k);
  });
  it('連著連結的圖保留 href', async () => {
    const out = await headlessRoundTrip(src.state as never);
    expect(lexicalToTree(out, 'x').find((b) => b.t === 'figure' && b.href)).toMatchObject({ href: 'https://youtu.be/x' });
  });
  it('rawMdx 區塊原樣保留（編輯器不能默默丟掉無法轉換的內容）', async () => {
    const r = mdxToLexical('<Chart data={rows} />\n', ctx as never);
    const out = await headlessRoundTrip(r.state as never);
    const b = (out.root.children as { fields?: { blockType: string; source: string } }[])[0]!;
    expect(b.fields).toMatchObject({ blockType: 'rawMdx', source: '<Chart data={rows} />' });
  });
  it('內嵌 HTML 區塊：編輯器載入再存回，節點樹一個不少', async () => {
    const r = mdxToLexical('<style>{`.v { fill: red; }`}</style>\n\n<figure className="v">\n  <svg viewBox="0 0 1 1">\n    <text textAnchor="middle">1</text>\n  </svg>\n</figure>\n', ctx as never);
    const out = await headlessRoundTrip(r.state as never);
    expect(lexicalToTree(out, 'x')).toEqual(lexicalToTree(r.state, 'x'));
    expect(lexicalToTree(out, 'x').map((b) => b.t)).toEqual(['html', 'html']);
  });
  it('認不得的節點 → 載入就丟錯，不是載成空白', async () => {
    const bad = { root: { type: 'root', version: 1, format: '', indent: 0, direction: 'ltr', children: [{ type: 'mystery', version: 1 }] } };
    await expect(headlessRoundTrip(bad as never)).rejects.toThrow();
  });
  it('空白文件的狀態合法，且匯出後仍是一段空段落', async () => {
    const out = await headlessRoundTrip(emptyState());
    expect(lexicalToTree(out, 'x')).toEqual([{ t: 'p', children: [] }]);
  });
});
