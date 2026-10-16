/**
 * 原始碼模式：編輯器內容 ⇄ MDX 文字。整個模組在使用者打開原始碼時才動態載入（unified／remark 約 150 KB）。
 * 參照用不透明的 id（media:12、reel:3、route:9），不需要查資料庫，也不會因為網址改了就對不上。
 */
import { lexicalToTree } from '../../../packages/content-sync/lexical';
import { treeToMdx } from '../../../packages/content-sync/to-mdx';
import { mdxToLexical, type Problem } from './mdx-import';

const ref = (kind: string) => (id: string) => `${kind}:${id}`;
const pick = (kind: string) => (s: string) => s.match(new RegExp(`^${kind}:(.+)$`))?.[1] ?? null;

export function exportSource(state: unknown): string {
  const tree = lexicalToTree(state, 'source', { allowRaw: true });
  return treeToMdx(tree, { mediaPath: ref('media'), reelEntry: ref('reel'), routeSlug: ref('route') }).mdx;
}

export interface Applied { ok: boolean; state?: Record<string, unknown>; problems: Problem[] }

export function applySource(text: string): Applied {
  const r = mdxToLexical(text, {
    resolveImage: ({ src }) => pick('media')(src),
    resolveReel: pick('reel'),
    resolveRoute: pick('route'),
  });
  // 「無法轉換、原樣保留」的區塊再匯回來時還是會被標成錯誤；在原始碼模式它們本來就是保留的，降為警告，不擋住套用
  const problems = r.problems.map((p) => (p.level === 'error' && /RawMdx 區塊/.test(p.message) ? { ...p, level: 'warn' as const } : p));
  return { ok: !problems.some((p) => p.level === 'error'), state: r.state, problems };
}
