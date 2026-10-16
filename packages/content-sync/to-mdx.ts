/**
 * 簡化樹 → MDX。供「原始碼模式」、每週備份、以及匯出使用。
 * 反方向是 admin/src/lib/mdx-import；兩邊用 golden 測試互相驗證（MDX → 樹 → MDX → 樹 必須相等）。
 *
 * 內容裡的 MDX 特殊字元一律跳脫；粗體、斜體的標記在「標記貼著標點」時改用 <strong>、<em>：
 * CommonMark 的 `**文字。**接著` 不會變粗體（見 docs/gotchas.md），用標籤就沒有這個歧義。
 */
import type { Block, Inline } from './lexical.ts';

export interface ExportResolvers {
  /** 媒體 id → 檔案路徑（相對於 MDX 檔，例如 ./media/12.jpg） */
  mediaPath: (id: string) => string;
  /** 影片 id → collection id（如 2026/metal-dome） */
  reelEntry: (id: string) => string;
  /** 路線 id → slug */
  routeSlug: (id: string) => string;
}

const PUNCT = /[\p{P}\p{S}\s]/u;

/** 行內：把會被 MDX 當成語法的字元跳脫掉 */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/([*_`~[\]<>{}|])/g, '\\$1')
    .replace(/&(?=[#\w])/g, '\\&');
}
/** 行首的符號（# - + > 數字. 等）也要擋，否則會變成標題或清單 */
function escapeBlockStart(s: string): string {
  return s.replace(/^(\s*)([#>+-])(?=\s|$)/, '$1\\$2').replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3').replace(/^(\s*)(={2,}|-{2,}|_{3,})\s*$/, '$1\\$2');
}
/** 每一行都要擋：文字裡的換行（匯入時保留下來的軟換行）之後，同樣會被當成新的區塊開頭 */
const escapeLines = (s: string) => s.split('\n').map(escapeBlockStart).join('\n');

function mark(open: string, close: string, tag: string, inner: string): string {
  if (!inner.trim()) return inner;
  // 標記貼著標點（或空白）時 CommonMark 不認，改用 JSX 標籤；前後的空白要放到標記外面
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  const body = m[2]!;
  const first = [...body][0] ?? '', last = [...body].at(-1) ?? '';
  const ambiguous = PUNCT.test(first) || PUNCT.test(last);
  return ambiguous ? `${m[1]}<${tag}>${body}</${tag}>${m[3]}` : `${m[1]}${open}${body}${close}${m[3]}`;
}

export function inlineMdx(nodes: Inline[], opts: { inTable?: boolean } = {}): string {
  return nodes.map((n) => {
    if (n.t === 'br') return '<br />';
    if (n.t === 'link') {
      // 開新分頁的連結 Markdown 寫不出來：用 <a target="_blank">（匯入器認得），否則 [文字](網址)
      if (n.newTab) return `<a${attr('href', n.href)} target="_blank">${inlineMdx(n.children, opts)}</a>`;
      const href = /[\s()<>]/.test(n.href) ? `<${n.href}>` : n.href;
      return `[${inlineMdx(n.children, opts)}](${href})`;
    }
    // 行內程式碼：含反引號時用 <code>{"…"}</code>；在表格裡 | 要寫成 \|（GFM 的規則，否則儲存格會被切開）。
    // 外層的粗體、斜體照樣套上——先前直接 return，粗體就不見了
    let h = n.code
      ? (n.text.includes('`') ? `<code>{${JSON.stringify(n.text)}}</code>` : `\`${opts.inTable ? n.text.replace(/\|/g, '\\|') : n.text}\``)
      : escapeText(n.text);
    if (n.sub) h = `<sub>${h}</sub>`;
    if (n.sup) h = `<sup>${h}</sup>`;
    if (n.underline) h = `<u>${h}</u>`;
    if (n.strike) h = mark('~~', '~~', 's', h);
    if (n.italic) h = mark('*', '*', 'em', h);
    if (n.bold) h = mark('**', '**', 'strong', h);
    return h;
  }).join('');
}

const attr = (name: string, v: string | number | boolean | undefined): string => {
  if (v === undefined || v === '' || v === false) return '';
  if (v === true) return ` ${name}`;
  if (typeof v === 'number') return ` ${name}={${v}}`;
  // JSX 屬性的字串不支援反斜線跳脫，而且會解 HTML 實體（&copy; 會變成 ©）：
  // 含引號、反斜線、換行或 & 時改用 {"…"} 表達式（裡面是 JS 字串，可以跳脫，不解實體）
  return /["\\\n\r&]/.test(v) ? ` ${name}={${JSON.stringify(v)}}` : ` ${name}="${v}"`;
};

function fence(code: string, lang: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${code}\n${f}`;
}

/** 巢狀清單的縮排必須等於「父項標記的寬度」：`- ` 是 2，`1. ` 是 3，`10. ` 是 4；寬度不夠會被當成同層的另一個清單 */
function list(b: Extract<Block, { t: 'list' }>, pad = ''): string {
  return b.items.map((it, i) => {
    const bullet = b.ordered ? `${(b.start ?? 1) + i}. ` : '- ';
    const head = `${pad}${bullet}${escapeBlockStart(inlineMdx(it.children))}`;
    return it.sub ? `${head}\n${list(it.sub, pad + ' '.repeat(bullet.length))}` : head;
  }).join('\n');
}

export interface ExportResult { mdx: string; imports: Record<string, string> }

/** 輸出整篇的正文。圖片用 import 識別字引用（m1、m2…），imports 另外回傳，由呼叫端放在檔案開頭。 */
export function treeToMdx(tree: Block[], r: ExportResolvers): ExportResult {
  const imports = new Map<string, string>(); // 路徑 → 識別字
  const ident = (path: string) => { let id = imports.get(path); if (!id) { id = `m${imports.size + 1}`; imports.set(path, id); } return id; };

  const parts = tree.map((b): string => {
    switch (b.t) {
      case 'p': return escapeLines(inlineMdx(b.children));
      case 'h': return `${'#'.repeat(b.level)} ${inlineMdx(b.children)}`;
      // 引言裡的每一行也是區塊的開頭：「- 」「1. 」「# 」不擋就在引言裡變成清單或標題
      case 'quote': return inlineMdx(b.children).split(/<br \/>\s*<br \/>/)
        .map((p) => p.split('<br />').map((line) => `> ${escapeLines(line)}`).join('  \n')).join('\n>\n');
      case 'hr': return '---';
      case 'list': return list(b);
      case 'code': return fence(b.code, b.language);
      case 'table': {
        const rows = b.rows.map((row) => `| ${row.cells.map((c) => inlineMdx(c, { inTable: true }) || ' ').join(' | ')} |`);
        const cols = b.rows[0]?.cells.length ?? 1;
        return [rows[0], `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1)].join('\n');
      }
      case 'figure': {
        const path = r.mediaPath(b.media);
        const alt = (b as { alt?: string }).alt ?? '';
        if (!b.caption && !b.wide && !b.href) return `![${escapeText(alt)}](${path})`;
        if (!b.caption && !b.wide && b.href) return `[![${escapeText(alt)}](${path})](${b.href})`;
        return `<Figure src={${ident(path)}}${attr('alt', alt)}${attr('caption', b.caption)}${attr('wide', b.wide)}${attr('href', b.href)} />`;
      }
      case 'gallery': {
        const items = b.items.map((i) => `{ src: ${ident(r.mediaPath(i.media))}, alt: ${JSON.stringify(i.alt)} }`).join(', ');
        return `<Gallery images={[${items}]}${attr('caption', b.caption)} />`;
      }
      case 'video': return `<Video${attr('entry', r.reelEntry(b.reel))}${attr('caption', b.caption)} />`;
      case 'route':
        return `<Route${attr('of', r.routeSlug(b.route))}${attr('show', b.show === 'profile' ? undefined : b.show)}${attr('from', b.from)}${attr('to', b.to)}${attr('at', b.at)}${attr('label', b.label)}${attr('caption', b.caption)} />`;
      case 'missing': return `<MissingImage${attr('original', b.original)}${attr('hint', b.hint)} />`;
      case 'ink': return '<InkRule />';
      case 'raw': return b.source;
    }
  });

  const importLines = [...imports].map(([path, id]) => `import ${id} from '${path}';`);
  const header = importLines.length ? importLines.join('\n') + '\n\n' : '';
  return { mdx: header + parts.join('\n\n') + '\n', imports: Object.fromEntries(imports) };
}
