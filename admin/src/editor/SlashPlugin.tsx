'use client';
import { useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isParagraphNode, $isRangeSelection, $isTextNode } from 'lexical';
import { applySlash } from './commands';
import { filterSlash, type SlashItem } from './slash';

/**
 * 在「只有 /xxx 的空段落」裡打斜線，工具列上方出現選單。
 * 中文輸入法組字中不觸發（組字的字還沒定案，不能拿來當查詢）。
 */
export function SlashPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const items: SlashItem[] = query === null ? [] : filterSlash(query);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    if (editor.isComposing()) return;
    editorState.read(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return setQuery(null);
      const node = sel.anchor.getNode();
      const para = node.getParent();
      if (!$isTextNode(node) || !para || !$isParagraphNode(para) || para.getChildrenSize() !== 1) return setQuery(null);
      const m = node.getTextContent().match(/^\/(\S*)$/);
      setQuery(m ? m[1]! : null);
      setActive(0);
    });
  }), [editor]);

  useEffect(() => {
    if (query === null) return;
    const root = editor.getRootElement();
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]!); }
      else if (e.key === 'Escape') { setQuery(null); }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  });

  function choose(item: SlashItem) {
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) sel.anchor.getNode().getParent()?.clear(); // 把 "/xxx" 清掉
    });
    applySlash(editor, item.id);
    setQuery(null);
  }

  if (query === null || !items.length) return null;
  return (
    <div className="ed-slash" role="listbox" aria-label="插入選單">
      {items.map((it, i) => (
        <button key={it.id} type="button" role="option" aria-selected={i === active} className="tb-item"
          onPointerDown={(e) => e.preventDefault()} onClick={() => choose(it)}>
          <span>{it.label}</span><span className="hint">{it.hint}</span>
        </button>
      ))}
    </div>
  );
}
