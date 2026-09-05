import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * 雙語的資料模型。路由還沒接（那是後面的階段），這裡先把
 * 「正本 ↔ 譯文」的配對與不變量定下來，第一篇譯文寫下去就有東西擋著。
 */

export const LOCALES = ['zh-Hant', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** 中文在根目錄 —— 現有網址與 57 條轉址一條都不用動 */
export const DEFAULT_LOCALE: Locale = 'zh-Hant';

/** 網址前綴：預設語言沒有前綴 */
export const prefix = (l: Locale) => (l === DEFAULT_LOCALE ? '' : `/${l}`);

/** 譯文的 id 是 `<正本 id>:<語言>` */
export function splitId(id: string): { base: string; locale: Locale } {
  const i = id.lastIndexOf(':');
  return i < 0
    ? { base: id, locale: DEFAULT_LOCALE }
    : { base: id.slice(0, i), locale: id.slice(i + 1) as Locale };
}

export type Translation = CollectionEntry<'taleTranslations'>;

/**
 * 建置期不變量。
 *
 * 這些錯誤都是「寫得下去、但之後才會以奇怪的方式爆掉」的那種，
 * 所以要在 build 時就攔住，而不是等到某個頁面渲染出空白。
 */
export async function assertTranslations(): Promise<Map<string, Translation[]>> {
  const tales = await getCollection('tales');
  const byId = new Map(tales.map((t) => [t.id, t]));
  const out = new Map<string, Translation[]>();
  const seen = new Set<string>();
  const bad: string[] = [];

  for (const t of await getCollection('taleTranslations')) {
    const { base, locale } = splitId(t.id);

    if (!LOCALES.includes(locale)) {
      bad.push(`${t.id}: 語言 "${locale}" 不在 LOCALES 裡`);
      continue;
    }
    const src = byId.get(base);
    if (!src) {
      bad.push(`${t.id}: 找不到正本 ${base}（檔名決定配對，資料夾要一致）`);
      continue;
    }
    if (src.data.lang === locale) {
      bad.push(`${t.id}: 正本已經是 ${locale} 了，這份譯文沒有意義`);
    }
    if (seen.has(t.id)) bad.push(`${t.id}: 同一個語言有兩份譯文`);
    seen.add(t.id);

    // scope 與正文必須一致 —— meta 卻寫了正文，那段文字永遠不會被渲染出來
    const hasBody = (t.body ?? '').trim().length > 0;
    if (t.data.scope === 'meta' && hasBody) {
      bad.push(`${t.id}: scope 是 meta 卻有正文（meta 不產生獨立網址，正文不會被顯示）`);
    }
    if (t.data.scope === 'full' && !hasBody) {
      bad.push(`${t.id}: scope 是 full 卻沒有正文`);
    }

    out.set(base, [...(out.get(base) ?? []), t]);
  }

  if (bad.length) {
    throw new Error(`譯文有 ${bad.length} 個問題：\n  ${bad.join('\n  ')}`);
  }
  return out;
}

/** 這篇有哪些語言版本（含正本），依 LOCALES 順序 */
export function localesOf(
  tale: CollectionEntry<'tales'>,
  translations: Map<string, Translation[]>,
): Locale[] {
  const langs = new Set<Locale>([tale.data.lang]);
  for (const t of translations.get(tale.id) ?? []) {
    // 只有全文譯本才有自己的網址；meta 只換卡片上的字
    if (t.data.scope === 'full') langs.add(splitId(t.id).locale);
  }
  return LOCALES.filter((l) => langs.has(l));
}
