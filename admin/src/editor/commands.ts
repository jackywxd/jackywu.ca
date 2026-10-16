import {
  $createParagraphNode, $getSelection, $isRangeSelection, $isRootOrShadowRoot, createCommand, type LexicalEditor, type LexicalCommand,
} from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import { $createBlockNode, type BlockFields } from './nodes/BlockNode';
import type { SlashId } from './slash';

/** 插入一個區塊並（視需要）打開它的編輯抽屜 */
export const INSERT_BLOCK_COMMAND: LexicalCommand<BlockFields> = createCommand('INSERT_BLOCK_COMMAND');
/** 編輯器通知外層：使用者點了某個區塊，要編輯它 */
export const EDIT_BLOCK_COMMAND: LexicalCommand<string> = createCommand('EDIT_BLOCK_COMMAND');

/** 每種區塊的初始欄位。必填的沒填就是空，由抽屜要求使用者補齊（發佈前檢查也會擋） */
export const BLOCK_DEFAULTS: Record<string, () => BlockFields> = {
  figure: () => ({ blockType: 'figure' }),
  gallery: () => ({ blockType: 'gallery', items: [] }),
  video: () => ({ blockType: 'video' }),
  route: () => ({ blockType: 'route', show: 'profile' }),
  missingImage: () => ({ blockType: 'missingImage', original: '' }),
  inkRule: () => ({ blockType: 'inkRule' }),
  code: () => ({ blockType: 'code', language: '', code: '' }),
};

export function applySlash(editor: LexicalEditor, id: SlashId) {
  switch (id) {
    case 'p': editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createParagraphNode()); }); return;
    case 'h2': case 'h3': case 'h4':
      editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createHeadingNode(id)); }); return;
    case 'quote': editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createQuoteNode()); }); return;
    case 'ul': editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined); return;
    case 'ol': editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined); return;
    case 'hr': editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined); return;
    case 'table': editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3', includeHeaders: { rows: true, columns: false } }); return;
    default: {
      const make = BLOCK_DEFAULTS[id];
      if (make) editor.dispatchCommand(INSERT_BLOCK_COMMAND, make());
    }
  }
}

/**
 * 在目前位置插入區塊節點；回傳新節點的 key。
 * 必須在 editor.update / 命令處理器「裡面」呼叫：巢狀的 editor.update 會被延後到外層結束才執行，
 * 那時回傳值早就回去了（拿到 null，抽屜就不會打開）。
 */
export function $insertBlockAtSelection(fields: BlockFields): string {
  const node = $createBlockNode(fields);
  const sel = $getSelection();
  if ($isRangeSelection(sel)) {
    const top = sel.anchor.getNode().getTopLevelElement();
    // 目前是空段落：直接換成區塊，不留一個沒用的空行
    if (top && top.getTextContentSize() === 0 && top.getType() === 'paragraph' && $isRootOrShadowRoot(top.getParent())) {
      top.replace(node);
      node.selectNext();
      return node.getKey();
    }
  }
  $insertNodeToNearestRoot(node);
  return node.getKey();
}
