'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, CAN_REDO_COMMAND, CAN_UNDO_COMMAND, COMMAND_PRIORITY_LOW, FORMAT_TEXT_COMMAND, REDO_COMMAND, UNDO_COMMAND } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { $isListNode, ListNode } from '@lexical/list';
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import { applySlash } from './commands';
import { SLASH_ITEMS, type SlashId } from './slash';
import { keyboardInset } from './keyboard';

type BlockKind = 'p' | 'h2' | 'h3' | 'h4' | 'quote' | 'ul' | 'ol';

export function Toolbar({ onRequestLink }: { onRequestLink: (current: string | null) => void }) {
  const [editor] = useLexicalComposerContext();
  const [fmt, setFmt] = useState({ bold: false, italic: false, link: false });
  const [block, setBlock] = useState<BlockKind>('p');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const refresh = useCallback(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const anchor = sel.anchor.getNode();
    const top = anchor.getTopLevelElementOrThrow();
    setFmt({ bold: sel.hasFormat('bold'), italic: sel.hasFormat('italic'), link: !!$findMatchingParent(anchor, $isLinkNode) });
    if ($isHeadingNode(top)) setBlock(top.getTag() as BlockKind);
    else if ($isListNode(top)) setBlock((top as ListNode).getListType() === 'number' ? 'ol' : 'ul');
    else setBlock(top.getType() === 'quote' ? 'quote' : 'p');
  }, []);

  useEffect(() => mergeRegister(
    editor.registerUpdateListener(({ editorState }) => editorState.read(refresh)),
    editor.registerCommand(CAN_UNDO_COMMAND, (v) => { setCanUndo(v); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_REDO_COMMAND, (v) => { setCanRedo(v); return false; }, COMMAND_PRIORITY_LOW),
  ), [editor, refresh]);

  // 工具列貼在虛擬鍵盤正上方（iOS Safari 不會縮小版面，只縮小 visualViewport）
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () => document.documentElement.style.setProperty('--kb', `${keyboardInset(window.innerHeight, vv)}px`);
    set();
    vv.addEventListener('resize', set); vv.addEventListener('scroll', set);
    return () => { vv.removeEventListener('resize', set); vv.removeEventListener('scroll', set); document.documentElement.style.removeProperty('--kb'); };
  }, []);

  const keepFocus = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault(); // 按按鈕不要讓編輯區失焦（鍵盤才不會收起來）
  const btn = (label: string, on: boolean, onClick: () => void, pressed?: boolean, disabled?: boolean) => (
    <button type="button" className="tb-btn" aria-label={label} aria-pressed={pressed} disabled={disabled} onPointerDown={keepFocus} onClick={onClick}>{on ? label : label}</button>
  );

  const pick = (id: SlashId) => { applySlash(editor, id); setInsertOpen(false); };

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="編輯工具">
      <div className="tb-row">
        <button type="button" className="tb-btn" aria-label="復原" disabled={!canUndo} onPointerDown={keepFocus} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>↶</button>
        <button type="button" className="tb-btn" aria-label="重做" disabled={!canRedo} onPointerDown={keepFocus} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>↷</button>
        <select className="tb-select" aria-label="段落樣式" value={block} onChange={(e) => applySlash(editor, e.target.value as SlashId)}>
          <option value="p">內文</option><option value="h2">標題 2</option><option value="h3">標題 3</option><option value="h4">標題 4</option>
          <option value="quote">引言</option><option value="ul">項目清單</option><option value="ol">編號清單</option>
        </select>
        <button type="button" className="tb-btn" aria-label="粗體" aria-pressed={fmt.bold} onPointerDown={keepFocus} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}><b>B</b></button>
        <button type="button" className="tb-btn" aria-label="斜體" aria-pressed={fmt.italic} onPointerDown={keepFocus} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}><i>I</i></button>
        <button type="button" className="tb-btn" aria-label="連結" aria-pressed={fmt.link} onPointerDown={keepFocus}
          onClick={() => {
            if (fmt.link) { editor.dispatchCommand(TOGGLE_LINK_COMMAND, null); return; }
            onRequestLink(null);
          }}>🔗</button>
        <button type="button" className="tb-btn" aria-label="插入" aria-expanded={insertOpen} onPointerDown={keepFocus} onClick={() => setInsertOpen((v) => !v)}>＋</button>
      </div>
      {insertOpen ? (
        <div className="tb-insert" role="menu" aria-label="插入">
          {SLASH_ITEMS.filter((i) => !['p', 'h2', 'h3', 'h4', 'quote', 'ul', 'ol'].includes(i.id)).map((i) => (
            <button key={i.id} type="button" role="menuitem" className="tb-item" onPointerDown={keepFocus} onClick={() => pick(i.id)}>
              <span>{i.label}</span><span className="hint">{i.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
