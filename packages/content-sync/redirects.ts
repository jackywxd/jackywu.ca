import { taleId } from '../content-rules/index.ts';

/** 改網址的 301 規劃。後台（改名時寫進 redirects 集合）與前台建置（這一筆請求還沒定案時）共用同一份。 */
export interface Redirect { from: string; to: string }

/** 網址一律用 %20 取代空白（_redirects 以空白分欄） */
export const encodePath = (p: string) => p.replace(/ /g, '%20');

export const taleUrl = (date: string, slug: string) => `/tales/${taleId(date, slug)}/`;

/**
 * 文章改了 slug 或日期 → 舊網址要 301 到新網址。
 * 同時把「指向舊網址」的既有轉址一併改指新網址，避免形成轉址鏈（A→B→C）。
 * 回傳需要新增與需要更新的項目；新舊網址相同則什麼都不做。
 */
export function planTaleRedirects(args: {
  before: { date: string; slug: string };
  after: { date: string; slug: string };
  existing: readonly Redirect[];
}): { create: Redirect[]; retarget: Redirect[]; remove: string[] } {
  const oldUrl = taleUrl(args.before.date, args.before.slug);
  const newUrl = taleUrl(args.after.date, args.after.slug);
  if (oldUrl === newUrl) return { create: [], retarget: [], remove: [] };

  const retarget = args.existing.filter((r) => r.to === oldUrl).map((r) => ({ from: r.from, to: newUrl }));
  // 新網址以前如果是某條轉址的來源（改回舊名），那條轉址必須移除，否則會自己轉自己
  const remove = args.existing.filter((r) => r.from === newUrl).map((r) => r.from);
  const create = args.existing.some((r) => r.from === oldUrl) ? [] : [{ from: oldUrl, to: newUrl }];
  return { create, retarget: retarget.filter((r) => r.from !== newUrl), remove };
}
