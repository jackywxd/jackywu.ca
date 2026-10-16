import { REALMS, checkDate, checkExcerpt, checkSlug, checkTitle, checkVerse } from '@content-rules';

type Json = Record<string, unknown>;
export interface TaleFromFrontmatter { data: Record<string, unknown>; missing: string[]; issues: { field: string; message: string }[]; unknown: string[] }

const KNOWN = new Set(['title', 'slug', 'date', 'updated', 'draft', 'lang', 'realm', 'tags', 'featured', 'excerpt', 'verse', 'shareable', 'xhsTags', 'hero', 'heroAlt', 'video', 'route', 'legacy']);
const bool = (v: unknown, dflt: boolean) => (v === undefined ? dflt : v === true || v === 'true');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : []);

/**
 * 外部 MDX 的 frontmatter → 文章草稿欄位。
 * 不猜：缺的必填欄位列在 missing（草稿可以先存，發佈前必須補），格式不對的列在 issues，不認得的欄位列在 unknown。
 * hero／video／route 需要 id 對照，由呼叫端（有資料庫）在這之後補上。
 */
export function frontmatterToTale(fm: Json, fallbackSlug?: string): TaleFromFrontmatter {
  const missing: string[] = [], issues: { field: string; message: string }[] = [];
  const str = (k: string) => (fm[k] === undefined || fm[k] === null ? undefined : String(fm[k]));
  const need = (k: string) => { if (!str(k)?.trim()) missing.push(k); };
  for (const k of ['title', 'date', 'realm', 'excerpt']) need(k);
  const slug = str('slug') ?? fallbackSlug;
  if (!slug) missing.push('slug');

  const check = (field: string, v: string | undefined, fn: (s: string) => string | null) => { if (v) { const m = fn(v); if (m) issues.push({ field, message: m }); } };
  check('title', str('title'), checkTitle); check('slug', slug, checkSlug); check('date', str('date'), checkDate);
  check('updated', str('updated'), checkDate); check('excerpt', str('excerpt'), checkExcerpt); check('verse', str('verse'), checkVerse);
  const realm = str('realm');
  if (realm && !(REALMS as readonly string[]).includes(realm)) issues.push({ field: 'realm', message: `行當「${realm}」不在清單內（${REALMS.join('、')}）` });
  const lang = str('lang') ?? 'zh-Hant';
  if (!['zh-Hant', 'en'].includes(lang)) issues.push({ field: 'lang', message: `語言「${lang}」不支援` });

  const legacy = fm.legacy && typeof fm.legacy === 'object' ? (fm.legacy as Json) : null;
  return {
    data: {
      title: str('title') ?? '', slug: slug ?? null, date: str('date') ?? null, updated: str('updated') ?? null, lang, realm: realm ?? null,
      tags: list(fm.tags), featured: bool(fm.featured, false), excerpt: str('excerpt') ?? null, verse: str('verse') ?? null,
      shareable: bool(fm.shareable, true) && realm !== 'still', xhsTags: list(fm.xhsTags), heroAlt: str('heroAlt') ?? null,
      legacy: legacy ? { url: String(legacy.url ?? ''), brokenImages: list(legacy.brokenImages) } : undefined,
    },
    missing, issues, unknown: Object.keys(fm).filter((k) => !KNOWN.has(k)),
  };
}
