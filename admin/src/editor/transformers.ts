import {
  BOLD_STAR, BOLD_UNDERSCORE, INLINE_CODE, ITALIC_STAR, ITALIC_UNDERSCORE, LINK, ORDERED_LIST, QUOTE, STRIKETHROUGH, UNORDERED_LIST,
  type ElementTransformer, type Transformer,
} from '@lexical/markdown';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import type { ElementNode } from 'lexical';

/** `## ` `### ` `#### ` → H2–H4。沒有 H1（標題本身就是 H1）；H5、H6 站上不用 */
export const HEADING_H2_H4: ElementTransformer = {
  dependencies: [],
  export: (node) => (!$isHeadingNode(node) ? null : `${'#'.repeat(Number(node.getTag().slice(1)))} ${node.getTextContent()}`),
  regExp: /^(#{2,4})\s/,
  replace: (parent: ElementNode, children, match) => {
    const h = $createHeadingNode(`h${match[1]!.length}` as 'h2' | 'h3' | 'h4');
    h.append(...children);
    parent.replace(h);
    h.select(0, 0);
  },
  type: 'element',
};

export const HR: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parent, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode();
    if (isImport || parent.getNextSibling() != null) parent.replace(line);
    else parent.insertBefore(line);
    line.selectNext();
  },
  type: 'element',
};

export const TRANSFORMERS: Transformer[] = [
  HEADING_H2_H4, HR, QUOTE, UNORDERED_LIST, ORDERED_LIST,
  INLINE_CODE, BOLD_STAR, BOLD_UNDERSCORE, ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH, LINK,
];

/** 畫面下方的提示（與上面的清單同步，測試會比對） */
export const MARKDOWN_HINTS = ['## 標題', '> 引言', '- 清單', '1. 編號', '**粗體**', '*斜體*', '~~刪除~~', '`程式碼`', '[文字](網址)', '---'];
