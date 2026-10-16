/**
 * MDX → Payload（Lexical）。M4 遷移既有文章與 M8 導入外部 .mdx 共用同一份。
 *
 * 原則：能轉的就轉，不能轉的絕不默默丟掉——回傳 problems，由呼叫端決定要不要讓人處理。
 *  · 圖片：本機圖片交給 resolveImage 上傳換成媒體 id；外站圖片不轉存（版權與容量），改成「待補圖」區塊
 *  · 站內元件（Figure/Gallery/Video/Route/MissingImage/InkRule）→ 對應的區塊
 *  · 其他 JSX／表達式 → RawMdx 區塊（原樣保留，發佈前必須處理）
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import YAML from 'yaml';
import type { Content, PhrasingContent, Root, RootContent } from 'mdast';
import * as L from './lexical-nodes';

type Json = Record<string, unknown>;

export interface Problem { level: 'warn' | 'error'; where: string; message: string }
export interface ImageRef { src: string; alt: string }
export interface ImportContext {
  /** 本機圖片（相對路徑）→ 媒體 id；找不到或不支援回 null */
  resolveImage: (ref: ImageRef) => string | number | null;
  /** 影片 collection id（如 2026/metal-dome）→ reel 的 id */
  resolveReel?: (entryId: string) => string | number | null;
  /** 路線 slug → route 的 id */
  resolveRoute?: (slug: string) => string | number | null;
}
export interface ImportResult { frontmatter: Json; state: Json; problems: Problem[] }

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).use(remarkMdx);

export function parseFrontmatter(src: string): { frontmatter: Json; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: src };
  // core schema：不把 2026-02-08 解析成 Date，日期保持字串
  const fm = YAML.parse(m[1]!, { schema: 'core' }) as Json | null;
  return { frontmatter: fm ?? {}, body: src.slice(m[0].length) };
}

const isExternal = (s: string) => /^(https?:)?\/\//i.test(s);

export function mdxToLexical(src: string, ctx: ImportContext): ImportResult {
  const { frontmatter, body } = parseFrontmatter(src);
  const problems: Problem[] = [];
  const warn = (where: string, message: string) => problems.push({ level: 'warn', where, message });
  const err = (where: string, message: string) => problems.push({ level: 'error', where, message });

  let tree: Root;
  try {
    tree = processor.parse(body) as Root;
  } catch (e) {
    const pos = (e as { line?: number; column?: number });
    err(`行 ${pos.line ?? '?'}`, `MDX 解析失敗：${(e as Error).message}`);
    return { frontmatter, state: L.root([]), problems };
  }

  // import 對照：識別字 → 檔案路徑（`import trail from './trail.jpg'`）
  const imports = new Map<string, string>();
  for (const n of tree.children) {
    if ((n as { type: string }).type !== 'mdxjsEsm') continue;
    for (const m of String((n as { value?: string }).value).matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) imports.set(m[1]!, m[2]!);
  }

  const where = (n: { position?: { start: { line: number } } }) => `行 ${n.position?.start.line ?? '?'}`;

  /* ── 行內 ── */
  function inline(nodes: PhrasingContent[], fmt = 0): Json[] {
    const out: Json[] = [];
    for (const n of nodes) {
      switch (n.type) {
        case 'text': out.push(L.text(n.value, fmt)); break;
        case 'emphasis': out.push(...inline(n.children, fmt | L.FORMAT.italic)); break;
        case 'strong': out.push(...inline(n.children, fmt | L.FORMAT.bold)); break;
        case 'delete': out.push(...inline(n.children, fmt | L.FORMAT.strike)); break;
        case 'inlineCode': out.push(L.text(n.value, fmt | L.FORMAT.code)); break;
        case 'break': out.push(L.linebreak()); break;
        case 'link': out.push(L.link(n.url, inline(n.children, fmt))); break;
        case 'mdxTextExpression': {
          // `{/* 註解 */}` 是給作者看的，不輸出
          if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(n.value)) break;
          err(where(n), `行內表達式 {${n.value}} 無法轉換`);
          break;
        }
        case 'image': // 夾在文字裡的圖：段落層級已拆開處理，走到這裡代表嵌在別的行內結構裡（例如粗體裡）——內容會遺失，必須處理
          err(where(n), `行內圖片 ${n.url} 無法轉換（圖片必須獨立成段），這張圖會遺失`);
          break;
        case 'mdxJsxTextElement': {
          const name = n.name ?? '';
          const inner = inline(n.children as PhrasingContent[], fmt);
          if (name === 'sup') out.push(...inline(n.children as PhrasingContent[], fmt | L.FORMAT.sup));
          else if (name === 'sub') out.push(...inline(n.children as PhrasingContent[], fmt | L.FORMAT.sub));
          else if (name === 'br') out.push(L.linebreak());
          else if (name === 'u') out.push(...inline(n.children as PhrasingContent[], fmt | L.FORMAT.underline));
          else { err(where(n), `行內元件 <${name}> 無法轉換，內容已保留為純文字`); out.push(...inner); }
          break;
        }
        default:
          err(where(n as { position?: { start: { line: number } } }), `行內節點 ${(n as { type: string }).type} 無法轉換`);
      }
    }
    return out;
  }

  const imageBlock = (url: string, alt: string, caption: string | undefined, at: string, wide = false, href?: string): Json => {
    if (isExternal(url)) return L.block({ blockType: 'missingImage', original: url, hint: alt || undefined });
    const id = ctx.resolveImage({ src: url, alt });
    if (id == null) { err(at, `圖片 ${url} 找不到或無法上傳`); return L.block({ blockType: 'missingImage', original: url, hint: '圖片遺失' }); }
    return L.block({ blockType: 'figure', media: id, ...(caption ? { caption } : {}), ...(wide ? { wide: true } : {}), ...(href ? { href } : {}) });
  };

  /* ── JSX 元件 ── */
  const attrs = (n: { attributes: { type: string; name?: string; value?: unknown }[] }) => {
    const out: Record<string, { s?: string; expr?: string }> = {};
    for (const a of n.attributes) {
      if (a.type !== 'mdxJsxAttribute' || !a.name) continue;
      if (a.value == null) out[a.name] = { s: 'true' };
      else if (typeof a.value === 'string') out[a.name] = { s: a.value };
      else out[a.name] = { expr: (a.value as { value: string }).value };
    }
    return out;
  };
  const numAttr = (a?: { s?: string; expr?: string }) => {
    const v = a?.expr ?? a?.s;
    return v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined;
  };

  function component(n: Extract<RootContent, { type: 'mdxJsxFlowElement' }>): Json[] {
    const name = n.name ?? '';
    const a = attrs(n as never);
    const at = where(n);
    switch (name) {
      case 'Figure': {
        const ident = a.src?.expr?.trim() ?? '';
        const path = imports.get(ident);
        if (!path) { err(at, `<Figure src={${ident}}> 找不到對應的 import`); return []; }
        return [imageBlock(path, a.alt?.s ?? '', a.caption?.s, at, a.wide !== undefined)];
      }
      case 'Gallery': {
        const expr = a.images?.expr ?? '';
        const items: Json[] = [];
        for (const m of expr.matchAll(/\{\s*src:\s*(\w+)\s*,\s*alt:\s*(['"])(.*?)\2\s*\}/g)) {
          const path = imports.get(m[1]!);
          const id = path ? ctx.resolveImage({ src: path, alt: m[3]! }) : null;
          if (id == null) { err(at, `<Gallery> 的圖 ${m[1]} 找不到`); continue; }
          items.push({ media: id, alt: m[3] });
        }
        if (!items.length) { err(at, '<Gallery> 沒有解析出任何圖'); return []; }
        return [L.block({ blockType: 'gallery', items, ...(a.caption?.s ? { caption: a.caption.s } : {}) })];
      }
      case 'Video': {
        const entry = a.entry?.s ?? '';
        const id = ctx.resolveReel?.(entry);
        if (id == null) { err(at, `<Video entry="${entry}"> 找不到對應的影片`); return []; }
        return [L.block({ blockType: 'video', reel: id, ...(a.caption?.s ? { caption: a.caption.s } : {}) })];
      }
      case 'Route': {
        const slug = a.of?.s ?? '';
        const id = ctx.resolveRoute?.(slug);
        if (id == null) { err(at, `<Route of="${slug}"> 找不到對應的路線`); return []; }
        const show = a.show?.s ?? 'profile';
        return [L.block({
          blockType: 'route', route: id, show,
          ...(numAttr(a.from) !== undefined ? { from: numAttr(a.from) } : {}), ...(numAttr(a.to) !== undefined ? { to: numAttr(a.to) } : {}),
          ...(numAttr(a.at) !== undefined ? { at: numAttr(a.at) } : {}), ...(a.label?.s ? { label: a.label.s } : {}), ...(a.caption?.s ? { caption: a.caption.s } : {}),
        })];
      }
      case 'MissingImage': return [L.block({ blockType: 'missingImage', original: a.original?.s ?? '', ...(a.hint?.s ? { hint: a.hint.s } : {}) })];
      case 'InkRule': return [L.block({ blockType: 'inkRule' })];
      case 'img': {
        // 舊文章手寫的 <img src alt>
        const src = a.src?.s ?? '';
        return [imageBlock(src, a.alt?.s ?? '', undefined, at)];
      }
      default: {
        // 認不得的 JSX：原樣保留成 RawMdx 區塊，發佈前必須處理
        const raw = src.slice(n.position?.start.offset ? 0 : 0); // 取原文片段
        void raw;
        const start = n.position?.start.offset, end = n.position?.end.offset;
        const text = start !== undefined && end !== undefined ? body.slice(start, end) : `<${name} />`;
        err(at, `<${name}> 不是支援的元件，已原樣保留為 RawMdx 區塊（發佈前必須改寫或移除）`);
        return [L.block({ blockType: 'rawMdx', source: text })];
      }
    }
  }

  /* ── 區塊 ── */
  const blocksOf = (nodes: RootContent[] | Content[]): Json[] => {
    const out: Json[] = [];
    for (const n of nodes as RootContent[]) {
      const at = where(n as never);
      switch (n.type) {
        case 'mdxjsEsm': break; // import 已收集
        case 'yaml': break;
        case 'paragraph': {
          // 段落裡的圖獨立成區塊；其餘文字保持原順序
          let buf: PhrasingContent[] = [];
          const flush = () => { if (buf.length) { const c = inline(buf); if (c.length) out.push(L.paragraph(c)); buf = []; } };
          for (const c of n.children) {
            if (c.type === 'image') { flush(); out.push(imageBlock(c.url, c.alt ?? '', undefined, at)); }
            // [![alt](圖)](網址)：整張圖是連結（例如 YouTube 縮圖）→ 帶 href 的圖
            else if (c.type === 'link' && c.children.length === 1 && c.children[0]!.type === 'image') {
              flush();
              const im = c.children[0] as Extract<PhrasingContent, { type: 'image' }>;
              out.push(imageBlock(im.url, im.alt ?? '', undefined, at, false, c.url));
            }
            else buf.push(c);
          }
          flush();
          break;
        }
        case 'heading': {
          let level = n.depth;
          if (level === 1) { warn(at, 'H1 已降為 H2（標題本身就是 H1）'); level = 2; }
          if (level > 4) { warn(at, `H${level} 已升為 H4`); level = 4; }
          out.push(L.heading(level as 2 | 3 | 4, inline(n.children)));
          break;
        }
        case 'blockquote': {
          const kids: Json[] = [];
          n.children.forEach((c, i) => {
            if (c.type !== 'paragraph') { err(where(c as never), `引言裡的 ${c.type} 無法轉換`); return; }
            if (i > 0) kids.push(L.linebreak(), L.linebreak());
            kids.push(...inline(c.children));
          });
          out.push(L.quote(kids));
          break;
        }
        case 'list': {
          const items = n.children.map((li, i) => {
            const kids: Json[] = [];
            const nested: Json[] = [];
            for (const c of li.children) {
              if (c.type === 'paragraph') kids.push(...(kids.length ? [L.linebreak()] : []), ...inline(c.children));
              else if (c.type === 'list') nested.push(...blocksOf([c]));
              else err(where(c as never), `清單項目裡的 ${c.type} 無法轉換`);
            }
            if (li.checked !== null && li.checked !== undefined) warn(where(li as never), '核取清單已轉成一般清單');
            return [L.listItem(i + 1, kids), ...nested.map((nl) => L.listItem(i + 1, [nl]))];
          }).flat();
          out.push(L.list(!!n.ordered, items));
          break;
        }
        case 'thematicBreak': out.push(L.hr()); break;
        case 'code': out.push(L.block({ blockType: 'code', language: n.lang ?? '', code: n.value })); break;
        case 'table': {
          out.push(L.table(n.children.map((row, ri) => L.tableRow(row.children.map((cell) => L.tableCell(ri === 0, inline(cell.children as PhrasingContent[])))))));
          break;
        }
        case 'mdxJsxFlowElement': out.push(...component(n)); break;
        case 'mdxFlowExpression': {
          if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(n.value)) break; // {/* 註解 */}
          err(at, `表達式 {${n.value.slice(0, 40)}} 無法轉換`);
          break;
        }
        case 'html': err(at, '原始 HTML 無法轉換'); break;
        default: err(at, `節點 ${n.type} 無法轉換`);
      }
    }
    return out;
  };

  return { frontmatter, state: L.root(blocksOf(tree.children)), problems };
}
