import { realms, site } from '@/lib/site';
import type { ShareItem } from './item';

/**
 * 站上的「非內容頁」也需要分享卡片。
 *
 * 文章與行跡本來就有，但首頁、四個行當、年份頁、輿圖、掌櫃都沒有 ——
 * 把 https://jackywu.ca/ 貼到微信會抓不到任何圖。分享連結最常分享的
 * 其實就是首頁。
 */
export interface PageCard {
  slug: string;          // 產圖端點的路徑片段
  path: string;          // 實際頁面網址
  title: string;
  subtitle?: string;
  realm: string;
  /** 卡片左上角的小字。索引頁多半不需要 —— 標題本身就是身份 */
  kicker?: string;
}

export function pageCards(years: number[]): PageCard[] {
  const cards: PageCard[] = [
    { slug: 'home', path: '/', title: site.name, subtitle: site.signature, realm: 'run' },
    { slug: 'routes', path: '/routes/', title: '輿圖', subtitle: '走過的路', realm: 'wild' },
    { slug: 'reel', path: '/reel/', title: '影', subtitle: '路上拍的', realm: 'snow' },
    { slug: 'tags', path: '/tags/', title: '江湖冊', subtitle: '所有的標記', realm: 'run' },
    { slug: 'forge', path: '/forge/', title: realms.forge.label, subtitle: realms.forge.sub, realm: 'forge' },
    { slug: 'manual', path: '/manual/', title: '凡例', subtitle: '客棧的體例', realm: 'wild' },
    { slug: 'keeper', path: '/keeper/', title: '掌櫃', subtitle: `${site.author} · ${site.signature}`, realm: 'run' },
    { slug: 'search', path: '/search/', title: '尋', subtitle: '在客棧裡找一段路', realm: 'run' },
  ];
  for (const k of ['run', 'snow', 'road', 'wild'] as const) {
    cards.push({ slug: k, path: realms[k].path, title: realms[k].label, subtitle: realms[k].sub, realm: k });
  }
  for (const y of years) {
    cards.push({ slug: `year/${y}`, path: `/tales/${y}/`, title: String(y), subtitle: '一年的路', realm: 'run', kicker: '時光機' });
  }
  return cards;
}

/** 借用 ShareItem 的形狀，三種版面就不用各寫一份 */
export const toShareItem = (c: PageCard): ShareItem => ({
  slug: c.slug,
  kind: 'tale',
  title: c.title,
  hook: c.subtitle ?? site.description,
  excerpt: c.subtitle ?? site.description,
  realm: c.realm,
  realmLabel: c.kicker ?? '',
  date: new Date(),
  dateLabel: '',
  stats: [],
  tags: [],
  shareable: true,
});

/** 頁面反查自己的分享圖 */
export const pageShareUrls = (slug: string) => ({
  og: `/og/page/${slug}.png`,
  wx: `/wx/page/${slug}.jpg`,
  poster: `/share/page/${slug}.jpg`,
});
