import { getCollection } from 'astro:content';
import { realms } from './site';
import type { TimelineItem } from './timeline';

/** 地名切成獨立標籤：「卑詩 · 威士拿」→ ['卑詩', '威士拿'] */
const placeTags = (region: string) =>
  region.split(/[·・,，、]/).map((s) => s.trim()).filter(Boolean);

/**
 * 標籤 slug：空白轉連字號、去掉會讓 URL 變醜的字元。
 * 中文保留（現代瀏覽器顯示正常，解碼後可讀），但空白絕不留 ——
 * 舊站的 /blog/2020/2020-08-03 Castle Tower 就是前車之鑑。
 */
export const tagSlug = (tag: string) =>
  tag.trim().replace(/\s+/g, '-').replace(/[/?#&%]/g, '').toLowerCase();

export interface TagEntry { tag: string; slug: string; items: TimelineItem[] }

/**
 * 標籤同時從文章與行跡取：
 * 文章用 frontmatter 的 tags，行跡用行當名與拆開的地名 ——
 * 否則行跡就永遠不會出現在任何標籤下。
 */
export async function getTags(): Promise<TagEntry[]> {
  const [tales, routes] = await Promise.all([getCollection('tales'), getCollection('routes')]);
  const map = new Map<string, TimelineItem[]>();
  const add = (tag: string, item: TimelineItem) => {
    const k = tag.trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  };

  for (const e of tales) {
    if (import.meta.env.PROD && e.data.draft) continue;
    if (e.data.realm === 'still') continue;      // 「靜」不進任何列表
    const item: TimelineItem = { kind: 'tale', date: e.data.date, realm: e.data.realm, id: e.id, data: e.data };
    for (const t of e.data.tags) add(t, item);
  }
  for (const e of routes) {
    const item: TimelineItem = { kind: 'route', date: e.data.date, realm: e.data.realm, id: e.id, data: e.data };
    add(realms[e.data.realm].label, item);
    for (const t of placeTags(e.data.region)) add(t, item);
  }

  return [...map.entries()]
    .map(([tag, items]) => ({ tag, slug: tagSlug(tag), items: items.sort((a, b) => b.date.getTime() - a.date.getTime()) }))
    .sort((a, b) => b.items.length - a.items.length || a.tag.localeCompare(b.tag, 'zh-Hant'));
}
