/**
 * 簡化樹 → HTML 字串（純文字類的區塊）。
 * 輸出前一律跳脫；連結的協定已經在 lexical.ts 裡檢查過，這裡再擋一次（縱深防禦）。
 */
import type { Block, Inline } from './lexical.ts';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

/**
 * 標點美化（智慧引號、破折號、刪節號）。
 * 站上的 MDX 文章由 Astro 的 markdown 引擎在建置時做這件事；後台文章走這條路，
 * 必須得到同樣的結果，否則同一個網站出現兩種標點。只套用在一般文字，行內程式碼不套用。
 */
export function smarten(s: string): string {
  return s
    .replace(/---/g, '—').replace(/--/g, '–')
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s([{<—–-])"/g, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s([{<—–-])'/g, '$1‘').replace(/'/g, '’');
}

export function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.t === 'br') return '<br>';
      if (n.t === 'link') {
        if (!SAFE.test(n.href)) throw new Error(`拒絕輸出不安全的連結：${n.href}`);
        const rel = n.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${esc(n.href)}"${rel}>${inlineHtml(n.children)}</a>`;
      }
      let h = esc(n.code ? n.text : smarten(n.text));
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

/** 只處理文字類區塊；figure/gallery/video/route/missing/ink 由 Astro 元件負責，這裡回 null */
export function blockHtml(b: Block): string | null {
  switch (b.t) {
    case 'p': return `<p>${inlineHtml(b.children)}</p>`;
    case 'h': return `<h${b.level}>${inlineHtml(b.children)}</h${b.level}>`;
    case 'quote': return `<blockquote><p>${inlineHtml(b.children)}</p></blockquote>`;
    case 'hr': return '<hr>';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((i) => `<li>${inlineHtml(i.children)}${i.sub ? blockHtml(i.sub) : ''}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      const rows = b.rows
        .map((r) => `<tr>${r.cells.map((c) => `<${r.header ? 'th' : 'td'}>${inlineHtml(c)}</${r.header ? 'th' : 'td'}>`).join('')}</tr>`)
        .join('');
      return `<table>${rows}</table>`;
    }
    default: return null;
  }
}
