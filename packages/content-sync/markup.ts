/**
 * 內嵌 HTML 區塊（自帶樣式的圖表、手寫的 SVG）：白名單裡的靜態標記。純函式、零依賴。
 *
 * 存的是節點樹，不是 HTML 字串：渲染端不必解析 HTML，只輸出白名單裡的標籤與屬性、文字一律跳脫——
 * 安全由構造保證，不靠事後過濾。匯入（admin/src/lib/mdx-import）、渲染（html.ts）、
 * 匯出（to-mdx.ts）與建置時的檢查（lexical.ts）共用這一份規則。
 *
 * 屬性一律存成 HTML／SVG 的真名（class、text-anchor），不是 JSX 的寫法（className、textAnchor）：
 * 瀏覽器不認 textAnchor，照抄會讓 SVG 的文字對不齊。
 */
import { SAFE_HREF } from './safe-href.ts';

export type MarkupNode = string | MarkupElement;
export interface MarkupElement { tag: string; attrs?: Record<string, string>; children?: MarkupNode[] }

/** SVG 以外能用的標籤。沒有 script、iframe、img（圖片走「圖」區塊，才有尺寸與壓縮）、表單 */
const HTML_TAGS = new Set([
  'figure', 'figcaption', 'div', 'span', 'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'sub', 'sup', 'small',
  'code', 'a', 'ul', 'ol', 'li', 'style', 'svg',
]);
/** svg 裡面能用的標籤。沒有 foreignObject（會在 SVG 裡開回 HTML）、image、animate／set（能改寫屬性）、script */
const SVG_TAGS = new Set([
  'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'use', 'style',
]);
export const isMarkupTag = (tag: string): boolean => HTML_TAGS.has(tag) || SVG_TAGS.has(tag);

/** SVG 的屬性裡，HTML／SVG 真名帶連字號、JSX 寫成駝峰的那些 */
const KEBAB = [
  'fill-opacity', 'fill-rule', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'font-size', 'font-weight',
  'font-family', 'font-style', 'letter-spacing', 'word-spacing', 'text-decoration', 'writing-mode', 'vector-effect',
  'shape-rendering', 'paint-order', 'clip-path', 'clip-rule', 'marker-start', 'marker-mid', 'marker-end', 'stop-color', 'stop-opacity',
];
const camel = (s: string) => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
const FROM_JSX = new Map<string, string>([['className', 'class'], ...KEBAB.map((k) => [camel(k), k] as [string, string])]);
/** JSX 的屬性名 → 真名（className → class、textAnchor → text-anchor）；本來就是真名的原樣 */
export const attrFromJsx = (name: string): string => FROM_JSX.get(name) ?? name;
/**
 * 真名 → 匯出成 MDX 的寫法。只有 class 寫成 className（Astro 會換回 class）；text-anchor 這類照真名寫：
 * 寫成 textAnchor 的話 Astro 原樣輸出、瀏覽器不認（docs/gotchas.md）。JSX 的屬性名本來就可以有連字號
 */
export const attrToJsx = (name: string): string => (name === 'class' ? 'className' : name);

const SVG_ATTRS = new Set([
  ...KEBAB, 'viewBox', 'width', 'height', 'xmlns', 'preserveAspectRatio', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'fx', 'fy', 'fr', 'd', 'points', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'transform', 'fill', 'stroke', 'opacity',
  'mask', 'offset', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient', 'href',
]);
const GLOBAL_ATTRS = new Set(['class', 'id', 'role', 'lang', 'dir', 'title', 'style']);
const HTML_ATTRS: Record<string, Set<string>> = { a: new Set(['href', 'target', 'rel']), ol: new Set(['start']), li: new Set(['value']) };


/** 樣式裡解開 CSS 跳脫（u\72l( 就是 url(）之後再檢查 */
const unescapeCss = (s: string) =>
  s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff) || 0xfffd)).replace(/\\(.)/g, '$1');

/** 樣式（<style> 的內容或 style 屬性）：只能描述外觀，不能載入任何東西、也不能跳出 <style> */
export function checkCss(css: string): string | null {
  if (/<\/style/i.test(css)) return '樣式裡不能出現「</style」';
  const plain = unescapeCss(css);
  if (/@import/i.test(plain)) return '樣式不能用 @import 載入外部檔案';
  if (/url\s*\(/i.test(plain)) return '樣式不能用 url(…) 載入圖片或字型';
  if (/expression\s*\(|javascript:/i.test(plain)) return '樣式裡有不允許的語法';
  return null;
}

function checkAttr(tag: string, inSvg: boolean, name: string, value: string): string | null {
  const ok = GLOBAL_ATTRS.has(name) || /^aria-[a-z]+$/.test(name) || /^data-[a-z0-9-]+$/.test(name)
    || (inSvg || tag === 'svg' ? SVG_ATTRS.has(name) : HTML_ATTRS[tag]?.has(name) ?? false);
  if (!ok) return `<${tag}> 不支援屬性 ${name}`;
  if (name === 'style') return checkCss(value);
  if (name === 'href') {
    // SVG 的 href 只能指向同一份 SVG 裡的元素（<use href="#a">）；HTML 的連結與內文連結同一條規則
    if (inSvg ? !/^#[\w-]+$/.test(value) : !SAFE_HREF.test(value.trim())) return `<${tag}> 的連結「${value}」不允許`;
    return null;
  }
  if (name === 'target' && value !== '_blank') return `<a> 的 target 只能是 _blank`;
  // fill="url(#漸層)" 這種同一份 SVG 裡的引用可以；其他 url(…) 會去外面抓東西
  if (/url\s*\(/i.test(value) && !/^\s*url\(#[\w-]+\)\s*$/.test(value)) return `<${tag}> 的 ${name} 只能用 url(#id) 引用同一張圖裡的東西`;
  if (/^\s*javascript:/i.test(value)) return `<${tag}> 的 ${name} 不允許`;
  return null;
}

const LIMIT = { depth: 48, nodes: 10_000 } as const;

/**
 * 整棵樹合不合格；合格回 null，否則回第一個問題（含它在哪一層）。
 * SVG 與 HTML 不能混：<svg> 裡出現 <p>，瀏覽器的解析器會提前結束 SVG，後面整張圖都壞掉。
 */
export function validateMarkup(nodes: unknown): string | null {
  if (!Array.isArray(nodes) || !nodes.length) return '內嵌 HTML 是空的';
  let count = 0;
  const walk = (list: unknown[], path: string[], inSvg: boolean): string | null => {
    for (const n of list) {
      if (++count > LIMIT.nodes) return `內嵌 HTML 太大（上限 ${LIMIT.nodes} 個節點）`;
      // 最外層的文字沒有標籤包著：匯出成 MDX 會變成一般段落，讀回來就不是內嵌 HTML 了
      if (typeof n === 'string') { if (!path.length) return '最外層只能是標籤，文字要放在標籤裡'; continue; }
      if (!n || typeof n !== 'object' || typeof (n as MarkupElement).tag !== 'string') return `${path.join(' › ') || '最外層'}有不認得的節點`;
      const { tag, attrs, children } = n as MarkupElement;
      const here = [...path, `<${tag}>`];
      const at = (m: string) => (path.length ? `${path.join(' › ')} 裡：${m}` : m);
      if (inSvg ? !SVG_TAGS.has(tag) : !HTML_TAGS.has(tag)) {
        return at(inSvg && HTML_TAGS.has(tag) ? `<svg> 裡不能放 HTML 的 <${tag}>` : `<${tag}> 不在支援的標籤裡`);
      }
      if (here.length > LIMIT.depth) return `內嵌 HTML 巢狀太深（上限 ${LIMIT.depth} 層）`;
      for (const [k, v] of Object.entries(attrs ?? {})) {
        if (typeof v !== 'string') return at(`<${tag}> 的屬性 ${k} 不是文字`);
        const m = checkAttr(tag, inSvg, k, v);
        if (m) return at(m);
      }
      if (children !== undefined && !Array.isArray(children)) return at(`<${tag}> 的內容不是清單`);
      if (tag === 'style') {
        if (!(children ?? []).every((c) => typeof c === 'string')) return at('<style> 裡只能放樣式文字');
        const m = checkCss((children as string[]).join(''));
        if (m) return at(m);
        continue;
      }
      if (tag === 'br' && children?.length) return at('<br> 不能有內容');
      const m = walk(children ?? [], here, inSvg || tag === 'svg');
      if (m) return m;
    }
    return null;
  };
  return walk(nodes, [], false);
}

/** 給編輯器的一行摘要：最外層的標籤與看得到的文字 */
export function markupSummary(nodes: MarkupNode[]): string {
  const tags = nodes.filter((n): n is MarkupElement => typeof n !== 'string').map((n) => `<${n.tag}>`);
  const text: string[] = [];
  const walk = (ns: MarkupNode[]) => { for (const n of ns) { if (typeof n === 'string') text.push(n); else if (n.tag !== 'style') walk(n.children ?? []); } };
  walk(nodes);
  const words = text.join(' ').replace(/\s+/g, ' ').trim();
  return [tags.join(' '), words ? (words.length > 30 ? `${words.slice(0, 30)}…` : words) : ''].filter(Boolean).join('・');
}
