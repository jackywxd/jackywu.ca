import { getCollection } from 'astro:content';
import { fromTale, fromRoute, type ShareItem } from './item';

const trackFiles = import.meta.glob<string>('/src/content/routes/*.svg', {
  query: '?raw', import: 'default', eager: true,
});
const trackD = (id: string) => {
  const raw = trackFiles[`/src/content/routes/${id}.svg`];
  return raw?.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
};

/** 三個產圖端點共用：所有可分享的條目，命名空間避免 id 撞號 */
export async function shareablePaths() {
  const [tales, routes] = await Promise.all([getCollection('tales'), getCollection('routes')]);
  const out: { params: { slug: string }; props: { item: ShareItem } }[] = [];

  for (const e of tales) {
    if (import.meta.env.PROD && e.data.draft) continue;
    const item = fromTale(e.id, e.data);
    if (!item.shareable) continue;          // realm: still 不產分享圖
    out.push({ params: { slug: `tales/${e.id}` }, props: { item } });
  }
  for (const e of routes) {
    out.push({ params: { slug: `routes/${e.id}` }, props: { item: fromRoute(e.id, e.data, trackD(e.id)) } });
  }
  return out;
}

/** 由頁面反查自己的分享圖路徑 */
export const shareUrls = (kind: 'tales' | 'routes', id: string) => ({
  og: `/og/${kind}/${id}.png`,
  wx: `/wx/${kind}/${id}.jpg`,
  poster: `/share/${kind}/${id}.jpg`,
});
