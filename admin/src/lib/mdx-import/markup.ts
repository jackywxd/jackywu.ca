/**
 * MDX 裡的 JSX（HTML／SVG 標籤）→ 內嵌 HTML 區塊的節點樹。規則（白名單）在 packages/content-sync/markup.ts。
 *
 * 這裡只負責「讀懂 MDX」：屬性的值、{…} 表達式、標籤裡的 Markdown，以及 MDX 的一條規則——
 * 一段裡只有 JSX（與空白）時，那一段不是段落，是那幾個元素本身。
 * 少了這條，<svg> 裡獨占一行的 <text>76</text> 會被包進 <p>，瀏覽器看到 SVG 裡的 <p> 就提前結束整張圖。
 */
import { attrFromJsx, isMarkupTag, type MarkupNode } from '../../../../packages/content-sync/markup';

/** remark-mdx 的節點：只用到這些欄位 */
export interface MdNode {
  type: string; name?: string | null; value?: string; url?: string; children?: MdNode[];
  attributes?: { type: string; name?: string; value?: string | null | { value: string; data?: { estree?: Program } } }[];
  data?: { estree?: Program };
}
interface Program { body: { type: string; expression?: Expr }[] }
interface Expr {
  type: string; value?: unknown; operator?: string; argument?: Expr;
  expressions?: unknown[]; quasis?: { value: { cooked?: string | null } }[];
}

const WS = /^[\t\r\n ]*$/;
const COMMENT = /^\s*\/\*[\s\S]*\*\/\s*$/;

/** 一段裡只有 JSX 元素、{…} 與空白 → 那幾個元素本身（空白丟掉）；否則 null。與 @mdx-js/mdx 的 unravel 相同 */
export function unravel(p: MdNode): MdNode[] | null {
  let jsx = false;
  for (const c of p.children ?? []) {
    if (c.type === 'mdxJsxTextElement' || c.type === 'mdxTextExpression') jsx = true;
    else if (!(c.type === 'text' && WS.test(c.value ?? ''))) return null;
  }
  return jsx ? (p.children ?? []).filter((c) => c.type !== 'text') : null;
}

/**
 * {…} 的值：只收固定的字串、數字（含負數）、沒有 ${} 的樣板字串。
 * 回傳 undefined 代表「不是固定的值」（變數、函式呼叫……），false 回 null（屬性不寫）。
 */
export function staticValue(estree: Program | undefined): string | null | undefined {
  const e = estree?.body.length === 1 && estree.body[0]!.type === 'ExpressionStatement' ? estree.body[0]!.expression : undefined;
  if (!e) return undefined;
  if (e.type === 'Literal') {
    if (typeof e.value === 'string' || typeof e.value === 'number') return String(e.value);
    if (e.value === true) return '';
    if (e.value === false) return null;
    return undefined;
  }
  if (e.type === 'UnaryExpression' && e.operator === '-' && e.argument?.type === 'Literal' && typeof e.argument.value === 'number') return String(-e.argument.value);
  if (e.type === 'TemplateLiteral' && !e.expressions?.length && e.quasis?.length === 1) return e.quasis[0]!.value.cooked ?? undefined;
  return undefined;
}

const MARKS: Record<string, string> = { strong: 'strong', emphasis: 'em', delete: 'del' };

/**
 * 轉換一串 MDX 節點。認不得的東西寫進 fails（一條一句，給人看），由呼叫端決定整段改存 RawMdx——
 * 這裡不默默略過任何東西。相鄰的文字併成一個字串（{"\n"} 與旁邊的文字是同一段文字）。
 */
export function jsxToMarkup(nodes: MdNode[], fails: string[]): MarkupNode[] {
  const out: MarkupNode[] = [];
  const text = (s: string) => { if (typeof out.at(-1) === 'string') out[out.length - 1] += s; else out.push(s); };
  const add = (ns: MarkupNode[]) => { for (const c of ns) if (typeof c === 'string') text(c); else out.push(c); };
  const el = (tag: string, children: MarkupNode[], attrs?: Record<string, string>): MarkupNode =>
    ({ tag, ...(attrs && Object.keys(attrs).length ? { attrs } : {}), ...(children.length ? { children } : {}) });

  for (const n of nodes) {
    switch (n.type) {
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        const tag = n.name ?? '';
        if (!isMarkupTag(tag)) { fails.push(tag ? `<${tag}> 不在支援的標籤裡` : 'JSX 片段 <>…</> 無法轉換'); break; }
        const attrs: Record<string, string> = {};
        for (const a of n.attributes ?? []) {
          if (a.type !== 'mdxJsxAttribute' || !a.name) { fails.push(`<${tag}> 的展開屬性 {...} 無法轉換`); continue; }
          const v = a.value == null ? '' : typeof a.value === 'string' ? a.value : staticValue(a.value.data?.estree);
          if (v === undefined) { fails.push(`<${tag}> 的屬性 ${a.name} 不是固定的值`); continue; }
          if (v !== null) attrs[attrFromJsx(a.name)] = v;
        }
        out.push(el(tag, jsxToMarkup(n.children ?? [], fails), attrs));
        break;
      }
      case 'paragraph': {
        const flat = unravel(n);
        if (flat) add(jsxToMarkup(flat, fails));
        else out.push(el('p', jsxToMarkup(n.children ?? [], fails)));
        break;
      }
      case 'text': text(n.value ?? ''); break;
      case 'strong': case 'emphasis': case 'delete': out.push(el(MARKS[n.type]!, jsxToMarkup(n.children ?? [], fails))); break;
      case 'inlineCode': out.push(el('code', [n.value ?? ''])); break;
      case 'break': out.push(el('br', [])); break;
      // 網址合不合格由白名單檢查（與內文連結同一條規則）
      case 'link': out.push(el('a', jsxToMarkup(n.children ?? [], fails), { href: n.url ?? '' })); break;
      case 'mdxFlowExpression':
      case 'mdxTextExpression': {
        if (COMMENT.test(n.value ?? '')) break; // {/* 註解 */} 是給作者看的
        const v = staticValue(n.data?.estree);
        if (v == null) fails.push(`{${(n.value ?? '').trim().slice(0, 30)}} 不是固定的文字`);
        else text(v);
        break;
      }
      default: fails.push(`${n.type} 無法放進內嵌 HTML`);
    }
  }
  return out;
}
