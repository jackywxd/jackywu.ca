import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import type { Klass, LexicalNode } from 'lexical';
import { BlockNode } from './BlockNode';

/** 編輯器與無頭測試共用的節點清單：兩邊必須一致，序列化測試才有意義 */
export const EDITOR_NODES: Klass<LexicalNode>[] = [
  HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode,
  TableNode, TableRowNode, TableCellNode, HorizontalRuleNode, BlockNode,
];
