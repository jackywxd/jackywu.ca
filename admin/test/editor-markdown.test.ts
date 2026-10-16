import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { describe, expect, it } from 'vitest';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { EDITOR_NODES } from '../src/editor/nodes';
import { MARKDOWN_HINTS, TRANSFORMERS } from '../src/editor/transformers';

function fromMd(md: string) {
  const ed = createHeadlessEditor({ nodes: EDITOR_NODES, onError: (e) => { throw e; } });
  ed.update(() => { $convertFromMarkdownString(md, TRANSFORMERS); }, { discrete: true });
  return ed;
}
const treeOf = (md: string) => lexicalToTree(fromMd(md).getEditorState().toJSON(), 'x');

describe('Markdown 快捷鍵', () => {
  it('## ### #### → H2 H3 H4', () => {
    expect(treeOf('## a\n\n### b\n\n#### c').map((b) => (b.t === 'h' ? b.level : 0))).toEqual([2, 3, 4]);
  });
  it('# 不會變成標題（標題本身就是 H1）', () => {
    expect(treeOf('# a')[0]!.t).toBe('p');
  });
  it('##### 不會變成標題', () => expect(treeOf('##### a')[0]!.t).toBe('p'));
  it('--- 變成分隔線，不是段落文字', () => expect(treeOf('前\n\n---\n\n後').map((b) => b.t)).toEqual(['p', 'hr', 'p']));
  it('引言與清單', () => expect(treeOf('> 引\n\n- a\n- b\n\n1. x').map((b) => b.t)).toEqual(['quote', 'list', 'list']));
  it('粗體、斜體、刪除線、行內碼、連結', () => {
    const p = treeOf('**粗** *斜* ~~刪~~ `碼` [連](https://a.com)')[0] as { children: { text?: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; href?: string; t: string }[] };
    expect(p.children.find((c) => c.text === '粗')).toMatchObject({ bold: true });
    expect(p.children.find((c) => c.text === '斜')).toMatchObject({ italic: true });
    expect(p.children.find((c) => c.text === '刪')).toMatchObject({ strike: true });
    expect(p.children.find((c) => c.text === '碼')).toMatchObject({ code: true });
    expect(p.children.find((c) => c.t === 'link')).toMatchObject({ href: 'https://a.com' });
  });
  it('javascript: 連結即使被打進編輯器，前台渲染也會拒絕（不是靜默輸出）', () => {
    expect(() => treeOf('[x](javascript:alert(1))')).toThrow(/不是 http/);
  });
  it('匯出再匯入穩定', () => {
    const ed = fromMd('## 標題\n\n段落 **粗**\n\n- a\n- b');
    const md = ed.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
    expect(md).toContain('## 標題');
    const again = fromMd(md).getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
    expect(again).toBe(md);
  });
  it('畫面上的提示涵蓋每一個快捷鍵', () => {
    for (const h of ['## ', '> ', '- ', '1. ', '**', '*', '~~', '`', '](', '---']) {
      expect(MARKDOWN_HINTS.some((x) => x.includes(h)), h).toBe(true);
    }
  });
});
