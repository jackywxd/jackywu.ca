/**
 * 簡化樹 → HTML 字串（純文字類的區塊）。
 * 輸出前一律跳脫；連結的協定已經在 lexical.ts 裡檢查過，這裡再擋一次（縱深防禦）。
 */
import { SAFE_HREF, type Block, type Inline } from './lexical.ts';
import { validateMarkup, type MarkupNode } from './markup.ts';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 與 lexical.ts 同一條規則（輸出前再擋一次）
const SAFE = SAFE_HREF;

/**
 * 標點美化（智慧引號、破折號、刪節號）。
 * 站上的 MDX 文章由 Astro 的 markdown 引擎在建置時做這件事；後台文章走這條路，
 * 必須得到同樣的結果，否則同一個網站出現兩種標點。只套用在一般文字，行內程式碼不套用。
 */
export function smarten(s: string): string {
  return smartenInline([{ t: 'text', text: s }]).map((n) => (n as { text: string }).text).join('');
}

const WS = /\s/u;
const PUNCT = /[\p{P}\p{S}]/u;

/**
 * 直引號 → 彎引號，以「整段」為單位（跨過粗體、斜體、連結的邊界），規則與 git 模式的 satteri 相同
 * （html.test.ts 直接拿 satteri 的輸出當答案）：
 *  · 前後字元決定能不能開、能不能關（CommonMark 的 flanking；中文字是字母，不是標點）
 *  · 能關而且前面有同一種還沒關的開引號 → 配成一對；否則能開就開
 *  · 單引號兩邊都是字（It's、中文'字'中文）→ 撇號 ’
 * 先前逐個文字節點、只看前一個字元，於是「他說"你好"」變成 ”你好”，粗體後面的引號方向也反了。
 */
export function smartenInline(nodes: Inline[]): Inline[] {
  const out = structuredClone(nodes);
  // 攤平成一串字元，記住每個可改寫的字元在哪個節點。satteri 看的是 Markdown 原文，粗體斜體的 * 、
  // 程式碼的 ` 、連結的 [ ] 本身也是引號旁邊的字元——這裡在格式換手的地方補上同樣的分隔字元，結果才會一樣
  const chars: { c: string; node?: { text: string } }[] = [];
  const fmt = (n: Inline) => (n.t === 'text' ? `${n.bold ? 'b' : ''}${n.italic ? 'i' : ''}${n.strike ? 's' : ''}` : '');
  let last = '';
  const walk = (ns: Inline[]) => {
    for (const n of ns) {
      if (n.t === 'br') { chars.push({ c: '\n' }); last = ''; continue; }
      if (n.t === 'link') { chars.push({ c: '[' }); last = ''; walk(n.children); chars.push({ c: ')' }); last = ''; continue; }
      if (n.code) { chars.push({ c: '`' }, { c: 'a' }, { c: '`' }); last = ''; continue; }
      const f = fmt(n);
      if (f !== last && (f || last)) chars.push({ c: '*' });
      last = f;
      for (let i = 0; i < n.text.length; i++) chars.push({ c: n.text[i]!, node: n as { text: string } });
    }
    if (last) { chars.push({ c: '*' }); last = ''; }
  };
  walk(out);
  const at = (k: number) => (k < 0 || k >= chars.length ? ' ' : chars[k]!.c);
  const repl = new Map<number, string>();
  const stack: { k: number; q: string }[] = [];
  for (let k = 0; k < chars.length; k++) {
    const q = chars[k]!.c;
    if ((q !== '"' && q !== "'") || !chars[k]!.node) continue;
    const prev = at(k - 1), next = at(k + 1);
    const left = !WS.test(next) && (!PUNCT.test(next) || WS.test(prev) || PUNCT.test(prev));
    const right = !WS.test(prev) && (!PUNCT.test(prev) || WS.test(next) || PUNCT.test(next));
    const [canOpen, canClose] = q === "'"
      ? [left && (!right || PUNCT.test(prev)), right && (!left || PUNCT.test(next))]
      : [left, right];
    const j = canClose ? stack.map((x) => x.q).lastIndexOf(q) : -1;
    if (j >= 0) {
      const o = stack[j]!;
      stack.length = j; // 中間沒配到的開引號作廢（當成落單的）
      repl.set(o.k, q === '"' ? '“' : '‘');
      repl.set(k, q === '"' ? '”' : '’');
    } else if (canOpen) stack.push({ k, q });
    else repl.set(k, q === '"' ? '”' : '’');
  }
  for (const o of stack) repl.set(o.k, o.q === '"' ? '“' : '’');
  // 寫回各節點；破折號與刪節號是局部的，逐節點處理
  for (const [k, r] of repl) chars[k]!.c = r;
  const rebuilt = new Map<{ text: string }, string[]>();
  for (const ch of chars) if (ch.node) { const a = rebuilt.get(ch.node) ?? []; a.push(ch.c); rebuilt.set(ch.node, a); }
  for (const [node, a] of rebuilt) node.text = a.join('').replace(/---/g, '—').replace(/--/g, '–').replace(/\.\.\./g, '…');
  return out;
}

/** 一段行內內容 → HTML。標點的轉換以整段為單位（見 smartenInline） */
export function inlineHtml(nodes: Inline[]): string {
  return renderInline(smartenInline(nodes));
}

function renderInline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.t === 'br') return '<br>';
      if (n.t === 'link') {
        if (!SAFE.test(n.href)) throw new Error(`拒絕輸出不安全的連結：${n.href}`);
        const rel = n.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${esc(n.href)}"${rel}>${renderInline(n.children)}</a>`;
      }
      let h = esc(n.text);
      if (n.code) h = `<code>${h}</code>`;
      if (n.sub) h = `<sub>${h}</sub>`;
      if (n.sup) h = `<sup>${h}</sup>`;
      if (n.underline) h = `<u>${h}</u>`;
      if (n.strike) h = `<s>${h}</s>`;
      if (n.italic) h = `<em>${h}</em>`;
      if (n.bold) h = `<strong>${h}</strong>`;
      return h;
    })
    .join('');
}

/** 行內內容的純文字（標點已轉換）：給標題的 id 用 */
const plain = (nodes: Inline[]): string => smartenInline(nodes).map((n) => (n.t === 'br' ? ' ' : n.t === 'link' ? plain(n.children) : n.text)).join('');

/** 一篇文章的渲染情境。slug：標題 id 的產生器——git 模式用 github-slugger，同一篇共用一個（重複的標題才會加 -1） */
export interface RenderContext { slug?: (text: string) => string }

/** 只處理文字類區塊與內嵌 HTML；figure/gallery/video/route/missing/ink 由 Astro 元件負責，這裡回 null */
export function blockHtml(b: Block, ctx: RenderContext = {}): string | null {
  switch (b.t) {
    case 'p': return `<p>${inlineHtml(b.children)}</p>`;
    case 'h': {
      const id = ctx.slug ? ` id="${esc(ctx.slug(plain(b.children)))}"` : '';
      return `<h${b.level}${id}>${inlineHtml(b.children)}</h${b.level}>`;
    }
    case 'quote': {
      // 兩個換行是段落的分界（匯入時把多段引言併成一個節點、段落之間放兩個換行）：畫回多個 <p>，與 git 模式一樣
      const paras: Inline[][] = [[]];
      b.children.forEach((n, i) => {
        if (n.t === 'br' && b.children[i + 1]?.t === 'br') { paras.push([]); return; }
        if (n.t === 'br' && b.children[i - 1]?.t === 'br') return;
        paras.at(-1)!.push(n);
      });
      return `<blockquote>${paras.map((p) => `<p>${inlineHtml(p)}</p>`).join('')}</blockquote>`;
    }
    case 'hr': return '<hr>';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((i) => `<li>${inlineHtml(i.children)}${i.sub ? blockHtml(i.sub) : ''}</li>`).join('');
      return `<${tag}${b.start !== undefined ? ` start="${b.start}"` : ''}>${items}</${tag}>`;
    }
    case 'table': {
      // 與 git 模式相同：標題列在 <thead>，其餘在 <tbody>
      const row = (r: (typeof b.rows)[number]) => `<tr>${r.cells.map((c) => `<${r.header ? 'th' : 'td'}>${inlineHtml(c)}</${r.header ? 'th' : 'td'}>`).join('')}</tr>`;
      const head = b.rows[0]?.header ? b.rows[0] : null;
      const body = head ? b.rows.slice(1) : b.rows;
      return `<table>${head ? `<thead>${row(head)}</thead>` : ''}${body.length ? `<tbody>${body.map(row).join('')}</tbody>` : ''}</table>`;
    }
    case 'html': return markupHtml(b.nodes);
    default: return null;
  }
}

/**
 * 內嵌 HTML → HTML 字串。輸出前再檢查一次白名單（縱深防禦，與連結相同）。
 * 文字一律跳脫；<style> 的內容是原始的 CSS（白名單已擋掉「</style」與外部載入）。
 * 標點美化只套在 HTML 的文字（圖說），SVG 裡的標籤文字是資料（5'10"），不動。
 */
export function markupHtml(nodes: MarkupNode[]): string {
  const problem = validateMarkup(nodes);
  if (problem) throw new Error(`拒絕輸出不合格的內嵌 HTML：${problem}`);
  const render = (ns: MarkupNode[], inSvg: boolean): string => ns.map((n) => {
    if (typeof n === 'string') return esc(inSvg ? n : smarten(n));
    const attrs = Object.entries(n.attrs ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    if (n.tag === 'style') return `<style${attrs}>${(n.children ?? []).join('')}</style>`;
    if (n.tag === 'br') return `<br${attrs}>`;
    const svg = inSvg || n.tag === 'svg';
    // SVG 的空元素寫成自我結束（HTML 解析器在 SVG 裡認得 />）；HTML 的元素一律有結束標籤
    if (svg && !n.children?.length) return `<${n.tag}${attrs}/>`;
    return `<${n.tag}${attrs}>${render(n.children ?? [], svg)}</${n.tag}>`;
  }).join('');
  return render(nodes, false);
}
