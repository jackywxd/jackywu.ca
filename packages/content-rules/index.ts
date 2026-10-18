/**
 * 前台 (src/content.config.ts) 與後台 (admin/) 共用的內容規則。
 *
 * 零依賴、純函式。規則只能活在這一份：兩邊各寫一份，遲早對不上，
 * 而「後台放行、前台建置失敗」正是無人值守發佈最壞的一種失敗。
 */

/** 顯示寬度：中日韓字算 2，其餘算 1。見 docs/content.md。 */
export const displayWidth = (s: string): number =>
  [...s].reduce(
    (n, ch) =>
      n +
      (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
        ? 2
        : 1),
    0,
  );

export const REALMS = ['run', 'snow', 'road', 'wild', 'forge', 'still'] as const;
export const TRADES = ['run', 'snow', 'road', 'wild'] as const;
export type Realm = (typeof REALMS)[number];

export const LIMITS = {
  title: 120,
  excerptMin: 20,
  excerptMax: 200,
  verse: 80,
} as const;

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 回傳錯誤訊息；合格回 null。 */
export const checkSlug = (s: string): string | null =>
  SLUG_RE.test(s) ? null : '網址代稱只能用小寫英數與連字號（例如 whistler-100k），中文標題必須手動給一個';

export const checkDate = (s: string): string | null => {
  if (!DATE_RE.test(s)) return '日期格式必須是 YYYY-MM-DD';
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? '不存在的日期' : null;
};

/** 路線的開始時間：當地時間＋偏移，精確到分（FIT 帶來的），例如 2026-08-16T06:05-07:00 */
export const STARTED_AT_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d[+-](?:[01]\d|2[0-3]):[0-5]\d$/;
export const checkStartedAt = (s: string): string | null =>
  !STARTED_AT_RE.test(s) ? '開始時間要是「當地時間＋時區」，例如 2026-08-16T06:05-07:00'
    : checkDate(s.slice(0, 10)) ? '開始時間的日期不存在' : null;

/** ISO 8601 時長（移動時間、用時），例如 PT2H31M5S */
export const DURATION_RE = /^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/;
export const checkDuration = (s: string): string | null => (DURATION_RE.test(s) ? null : '時間要是 ISO 8601 格式，例如 PT2H31M');

export const checkTitle = (s: string): string | null =>
  s.length === 0
    ? '標題不能是空的'
    : displayWidth(s) > LIMITS.title
      ? `標題太長（顯示寬度上限 ${LIMITS.title}，約 60 個中文字）`
      : null;

export const checkExcerpt = (s: string): string | null => {
  const w = displayWidth(s);
  if (w < LIMITS.excerptMin) return `摘要太短（顯示寬度至少 ${LIMITS.excerptMin}，約 10 個中文字）`;
  if (w > LIMITS.excerptMax) return `摘要太長（顯示寬度上限 ${LIMITS.excerptMax}，約 100 個中文字）`;
  return null;
};

export const checkVerse = (s: string): string | null =>
  displayWidth(s) > LIMITS.verse ? `金句太長（顯示寬度上限 ${LIMITS.verse}，約 40 個中文字）` : null;

export interface TaleFields {
  title: string;
  slug: string;
  date: string;
  realm: string;
  excerpt: string;
  verse?: string | null;
  shareable?: boolean | null;
  hero?: unknown;
  heroAlt?: string | null;
}

export interface FieldError {
  field: string;
  message: string;
}

/** 發佈前的完整檢查。每個錯誤指向一個欄位，畫面上才找得到。 */
export function validateTale(t: TaleFields): FieldError[] {
  const errs: FieldError[] = [];
  const push = (field: string, message: string | null) => message && errs.push({ field, message });
  push('title', checkTitle(t.title));
  push('slug', checkSlug(t.slug));
  push('date', checkDate(t.date));
  push('excerpt', checkExcerpt(t.excerpt));
  if (t.verse) push('verse', checkVerse(t.verse));
  if (!(REALMS as readonly string[]).includes(t.realm)) push('realm', '行當不在清單內');
  if (t.hero && !t.heroAlt) push('heroAlt', 'hero 存在時必須提供 heroAlt（無障礙要求）');
  if (t.realm === 'still' && t.shareable !== false) {
    push('shareable', 'realm: still 必須 shareable: false —— 私人文不產分享海報');
  }
  return errs;
}

/** date 的年份決定資料夾。字串切，不經 Date：溫哥華深夜不會被 UTC 推到隔年。 */
export const yearOf = (date: string): string => date.slice(0, 4);

/** 內容 id：<year>/<slug>，也是網址 /tales/<year>/<slug>/ */
export const taleId = (date: string, slug: string): string => `${yearOf(date)}/${slug}`;
