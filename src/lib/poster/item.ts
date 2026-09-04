import type { CollectionEntry } from 'astro:content';
import { realms } from '@/lib/site';
import { km, vert, duration, monthDay } from '@/lib/format';

/** 文章與行跡共用的分享形狀 —— 三種版面都只認這個 */
export interface ShareItem {
  slug: string;
  kind: 'tale' | 'route';
  title: string;
  subtitle?: string;
  /** 海報主文案：金句優先，退回摘要 */
  hook: string;
  excerpt: string;
  realm: string;
  realmLabel: string;
  date: Date;
  dateLabel: string;
  badge?: string;
  stats: { k: string; v: string }[];
  /** 路線輪廓的 path d，海報上當主視覺 */
  track?: string;
  tags: string[];
  shareable: boolean;
}

const firstSentence = (s: string) => s.split(/[。！？\n]/)[0]!.trim();

/** 行當 → 小紅書上實際有人搜的話題詞。站內的「追雲」「探幽」在那邊沒人搜。 */
const XHS_TOPIC: Record<string, string[]> = {
  run:  ['越野跑', '跑步'],
  snow: ['滑雪', '野雪'],
  road: ['摩托車', '機車旅行'],
  wild: ['戶外', '登山'],
};
/** 地名切成獨立話題詞：「卑詩 · 威士拿」→ ['卑詩', '威士拿'] */
const placeTags = (region: string) =>
  region.split(/[·・,，、]/).map((s) => s.trim()).filter(Boolean);

export function fromTale(id: string, d: CollectionEntry<'tales'>['data']): ShareItem {
  const r = realms[d.realm];
  return {
    slug: id, kind: 'tale', title: d.title,
    hook: d.verse ?? firstSentence(d.excerpt),
    excerpt: d.excerpt,
    realm: d.realm, realmLabel: r.label,
    date: d.date, dateLabel: `${d.date.getUTCFullYear()} · ${monthDay(d.date)}`,
    stats: [], tags: d.xhsTags ?? [...(XHS_TOPIC[d.realm] ?? []), ...d.tags], shareable: d.shareable,
  };
}

export function fromRoute(id: string, d: CollectionEntry<'routes'>['data'], track?: string): ShareItem {
  const r = realms[d.realm];
  const stats = [
    d.distanceKm != null && { k: '距離', v: km(d.distanceKm)! },
    d.gainM != null && { k: '爬升', v: vert(d.gainM)! },
    d.elapsed && { k: '用時', v: duration(d.elapsed)! },
    d.result && { k: '結果', v: d.result },
  ].filter(Boolean) as { k: string; v: string }[];

  return {
    slug: id, kind: 'route', title: d.name, subtitle: d.nameEn,
    hook: d.note ?? d.region,
    excerpt: [d.region, km(d.distanceKm), vert(d.gainM)].filter(Boolean).join(' · '),
    realm: d.realm, realmLabel: r.label,
    date: d.date, dateLabel: `${d.date.getUTCFullYear()} · ${monthDay(d.date)}`,
    badge: d.badge, stats, track,
    tags: [...(XHS_TOPIC[d.realm] ?? []), ...placeTags(d.region)], shareable: true,
  };
}
