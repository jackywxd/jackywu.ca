/**
 * Payload（Lexical）正文 → 前台渲染用的簡化樹。純函式、零依賴。
 *
 * 兩條硬規則：
 *  1. 認不得的節點一律丟錯（寫出節點型別與文章 slug），絕不靜默略過——
 *     靜默略過等於讀者看到一篇缺了一段的文章，而建置是綠的。
 *  2. 連結只允許 http / https / mailto / 站內相對路徑。
 */

export type Inline =
  | { t: 'text'; text: string; bold?: true; italic?: true; strike?: true; underline?: true; code?: true; sub?: true; sup?: true }
  | { t: 'br' }
  | { t: 'link'; href: string; newTab: boolean; children: Inline[] };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: 2 | 3 | 4; children: Inline[] }
  | { t: 'quote'; children: Inline[] }
  | { t: 'list'; ordered: boolean; start?: number; items: { children: Inline[]; sub?: Block & { t: 'list' } }[] }
  | { t: 'hr' }
  | { t: 'table'; rows: { header: boolean; cells: Inline[][] }[] }
  | { t: 'figure'; media: string; caption?: string; wide: boolean; href?: string }
  | { t: 'gallery'; items: { media: string; alt: string }[]; caption?: string }
  | { t: 'video'; reel: string; caption?: string }
  | { t: 'route'; route: string; show: 'profile' | 'track' | 'both'; from?: number; to?: number; at?: number; label?: string; caption?: string }
  | { t: 'code'; language: string; code: string }
  | { t: 'missing'; original: string; hint?: string }
  | { t: 'ink' }
  /** 只有「原始碼模式」與匯出會用：無法轉換、原樣保留的 MDX。渲染端（allowRaw 預設 false）一律拒絕 */
  | { t: 'raw'; source: string };

export class UnknownNodeError extends Error {
  // Node 的型別剝除只支援「可抹除」的語法，不能用建構子參數屬性
  readonly nodeType: string;
  readonly slug: string;
  constructor(nodeType: string, slug: string, detail = '') {
    super(`文章 ${slug} 含有無法渲染的節點「${nodeType}」${detail ? `（${detail}）` : ''}。` +
      `請在後台移除或改用支援的區塊；建置不會略過它。`);
    this.nodeType = nodeType;
    this.slug = slug;
  }
}

type N = Record<string, unknown> & { type?: string; children?: N[] };
const FORMAT = { bold: 1, italic: 2, strike: 4, underline: 8, code: 16, sub: 32, sup: 64 } as const;
const KNOWN_FORMAT = 127;
/** Lexical 其他的格式位元：沒有對應的呈現就丟錯，不能默默壓平（從網頁貼上可能帶進來） */
const UNSUPPORTED_FORMAT: [number, string][] = [[128, '螢光標記'], [256, '小寫轉換'], [512, '大寫轉換'], [1024, '首字大寫轉換']];

/** 連結只允許 http、https、mailto、站內路徑（/ 開頭，不能是 // 或 /\ ——瀏覽器會把 /\evil.com 當成外站）、錨點 */
export const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?![\/\\])|#)/i;

export function safeHref(href: unknown, slug: string): string {
  if (typeof href !== 'string' || !SAFE_HREF.test(href.trim())) {
    throw new UnknownNodeError('link', slug, `網址「${String(href)}」不是 http、https、mailto 或站內路徑`);
  }
  return href.trim();
}

const idOf = (v: unknown): string => {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'id' in v) return String((v as { id: unknown }).id);
  return '';
};

function inline(nodes: N[] | undefined, slug: string): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'text': {
        const f = Number(n.format ?? 0);
        if (f & ~KNOWN_FORMAT) {
          const names = UNSUPPORTED_FORMAT.filter(([bit]) => f & bit).map(([, name]) => name);
          throw new UnknownNodeError('text', slug, `「${String(n.text ?? '').slice(0, 20)}」用了${names.join('、') || `格式 ${f}`}，網站沒有這種樣式；請改成粗體或斜體`);
        }
        const node: Inline & { t: 'text' } = { t: 'text', text: String(n.text ?? '') };
        for (const [k, bit] of Object.entries(FORMAT)) if (f & bit) (node as Record<string, unknown>)[k] = true;
        out.push(node);
        break;
      }
      case 'linebreak': out.push({ t: 'br' }); break;
      case 'link':
      case 'autolink': {
        // 兩種來源：Payload 的 { fields: { url, newTab } }，以及後台編輯器（Lexical 原生 LinkNode）的 { url, target }
        const fields = (n.fields ?? { url: n.url, newTab: n.target === '_blank' }) as Record<string, unknown>;
        if (fields.linkType && fields.linkType !== 'custom') {
          throw new UnknownNodeError('link', slug, `內部連結（${String(fields.linkType)}）尚未支援，請改用完整網址`);
        }
        out.push({ t: 'link', href: safeHref(fields.url, slug), newTab: !!fields.newTab, children: inline(n.children, slug) });
        break;
      }
      default:
        throw new UnknownNodeError(String(n.type), slug);
    }
  }
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function list(n: N, slug: string): Block & { t: 'list' } {
  if (n.listType === 'check') throw new UnknownNodeError('list', slug, '核取清單尚未支援');
  const items: (Block & { t: 'list' })['items'] = [];
  for (const li of n.children ?? []) {
    if (li.type !== 'listitem') throw new UnknownNodeError(String(li.type), slug);
    const kids = li.children ?? [];
    const lists = kids.filter((k) => k.type === 'list');
    if (lists.length > 1) throw new UnknownNodeError('list', slug, '同一項裡有兩個子清單');
    const nested = lists[0];
    const text = kids.filter((k) => k.type !== 'list');
    // 巢狀清單在 Lexical 裡是「只含一個 list 的 listitem」，併到前一項底下。
    // 前面沒有項目（第一項就是子清單）就自己成為一項；文字與子清單在同一項（匯入常見）兩者都留著。
    // 先前這兩種形狀會默默丟掉子清單——不報錯、建置綠燈，讀者看到少一段
    if (nested && !text.length && items.length && !items[items.length - 1]!.sub) {
      items[items.length - 1]!.sub = list(nested, slug);
      continue;
    }
    items.push({ children: inline(text, slug), ...(nested ? { sub: list(nested, slug) } : {}) });
  }
  const start = n.listType === 'number' && typeof n.start === 'number' && Number.isInteger(n.start) && n.start !== 1 ? n.start : undefined;
  return { t: 'list', ordered: n.listType === 'number', ...(start !== undefined ? { start } : {}), items };
}

function block(n: N, slug: string, allowRaw: boolean): Block {
  switch (n.type) {
    case 'paragraph': return { t: 'p', children: inline(n.children, slug) };
    case 'heading': {
      const level = Number(String(n.tag ?? '').replace('h', ''));
      if (level < 2 || level > 4) {
        throw new UnknownNodeError('heading', slug, `只允許 H2–H4（標題已經是 H1），遇到 ${String(n.tag)}`);
      }
      return { t: 'h', level: level as 2 | 3 | 4, children: inline(n.children, slug) };
    }
    case 'quote': return { t: 'quote', children: inline(n.children, slug) };
    case 'list': return list(n, slug);
    case 'horizontalrule': return { t: 'hr' };
    case 'table': {
      const rows = (n.children ?? []).map((r) => {
        if (r.type !== 'tablerow') throw new UnknownNodeError(String(r.type), slug);
        const cells = r.children ?? [];
        const header = cells.length > 0 && cells.every((c) => Number(c.headerState ?? 0) > 0);
        return {
          header,
          cells: cells.map((c) => {
            if (c.type !== 'tablecell') throw new UnknownNodeError(String(c.type), slug);
            if (Number(c.colSpan ?? 1) > 1 || Number(c.rowSpan ?? 1) > 1) throw new UnknownNodeError('tablecell', slug, '合併儲存格尚未支援，請拆開');
            // 儲存格內是段落；攤平成 inline，段落之間補換行。不是段落（標題、清單）就丟錯：攤平會默默拿掉它的結構
            return (c.children ?? []).flatMap((p, i) => {
              if (p.type !== 'paragraph') throw new UnknownNodeError(String(p.type), slug, '儲存格裡只能放一般文字');
              return [...(i ? [{ t: 'br' } as Inline] : []), ...inline(p.children, slug)];
            });
          }),
        };
      });
      return { t: 'table', rows };
    }
    case 'block': {
      const f = (n.fields ?? {}) as Record<string, unknown>;
      switch (f.blockType) {
        case 'figure': {
          const media = idOf(f.media);
          if (!media) throw new UnknownNodeError('figure', slug, '沒有選圖片');
          return { t: 'figure', media, caption: str(f.caption), wide: !!f.wide, ...(str(f.href) ? { href: safeHref(f.href, slug) } : {}) };
        }
        case 'gallery': {
          const items = ((f.items ?? []) as Record<string, unknown>[]).map((it) => ({ media: idOf(it.media), alt: String(it.alt ?? '') }));
          if (!items.length || items.some((i) => !i.media)) throw new UnknownNodeError('gallery', slug, '圖組是空的或有一格沒選圖');
          return { t: 'gallery', items, caption: str(f.caption) };
        }
        case 'video': {
          const reel = idOf(f.reel);
          if (!reel) throw new UnknownNodeError('video', slug, '沒有選影片');
          return { t: 'video', reel, caption: str(f.caption) };
        }
        case 'route': {
          const route = idOf(f.route);
          if (!route) throw new UnknownNodeError('route', slug, '沒有選路線');
          const show = (f.show ?? 'profile') as string;
          if (!['profile', 'track', 'both'].includes(show)) throw new UnknownNodeError('route', slug, `show=${show}`);
          return { t: 'route', route, show: show as 'profile', from: num(f.from), to: num(f.to), at: num(f.at), label: str(f.label), caption: str(f.caption) };
        }
        case 'code': {
          if (typeof f.code !== 'string') throw new UnknownNodeError('code', slug, '程式碼區塊沒有內容');
          return { t: 'code', language: String(f.language ?? ''), code: f.code };
        }
        case 'missingImage': return { t: 'missing', original: String(f.original ?? ''), hint: str(f.hint) };
        case 'inkRule': return { t: 'ink' };
        case 'rawMdx':
          if (allowRaw) return { t: 'raw', source: String(f.source ?? '') };
          throw new UnknownNodeError('block:rawMdx', slug);
        default: throw new UnknownNodeError(`block:${String(f.blockType)}`, slug);
      }
    }
    default: throw new UnknownNodeError(String(n.type), slug);
  }
}

export function lexicalToTree(state: unknown, slug: string, opts: { allowRaw?: boolean } = {}): Block[] {
  const root = (state as { root?: N } | null)?.root;
  if (!root || root.type !== 'root') throw new UnknownNodeError('root', slug, '正文不是合法的 Lexical 狀態');
  return (root.children ?? []).map((n) => block(n, slug, !!opts.allowRaw));
}

/** 這棵樹引用到的所有媒體 id（建置時據此下載圖片、產生 manifest） */
export function collectMedia(tree: Block[]): string[] {
  const ids = new Set<string>();
  for (const b of tree) {
    if (b.t === 'figure') ids.add(b.media);
    if (b.t === 'gallery') b.items.forEach((i) => ids.add(i.media));
  }
  return [...ids];
}
