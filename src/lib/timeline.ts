import { getCollection, type CollectionEntry } from 'astro:content';
import type { Realm } from './site';

export type Trade = 'run' | 'snow' | 'road' | 'wild';

export type TimelineItem =
  | { kind: 'tale'; date: Date; realm: Realm; id: string; data: CollectionEntry<'tales'>['data'] }
  | { kind: 'route'; date: Date; realm: Trade; id: string; data: CollectionEntry<'routes'>['data'] }
  | { kind: 'reel'; date: Date; realm: Trade; id: string; data: CollectionEntry<'reel'>['data'] };

export interface YearGroup {
  year: number;
  items: TimelineItem[];
}

const isProd = import.meta.env.PROD;

/**
 * 把三個 collection 合成一條軸。
 * forge（爐火·舊技術文）與 still（靜·私人文）不進時光機 —— 這是刻意的：
 * 它們仍然存在、仍然有 URL、仍然被 301 保住，只是不出現在這條線上。
 */
export async function getTimeline(opts: { realm?: Trade } = {}): Promise<YearGroup[]> {
  const [tales, routes, reel] = await Promise.all([
    getCollection('tales'),
    getCollection('routes'),
    getCollection('reel'),
  ]);

  const items: TimelineItem[] = [];

  for (const e of tales) {
    if (isProd && e.data.draft) continue;
    if (e.data.realm === 'forge' || e.data.realm === 'still') continue;
    if (opts.realm && e.data.realm !== opts.realm) continue;
    items.push({ kind: 'tale', date: e.data.date, realm: e.data.realm, id: e.id, data: e.data });
  }
  for (const e of routes) {
    if (opts.realm && e.data.realm !== opts.realm) continue;
    items.push({ kind: 'route', date: e.data.date, realm: e.data.realm, id: e.id, data: e.data });
  }
  for (const e of reel) {
    if (opts.realm && e.data.realm !== opts.realm) continue;
    items.push({ kind: 'reel', date: e.data.date, realm: e.data.realm, id: e.id, data: e.data });
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  const byYear = new Map<number, TimelineItem[]>();
  for (const it of items) {
    const y = it.date.getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(it);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({ year, items }));
}

export function href(it: TimelineItem): string {
  return it.kind === 'tale' ? `/tales/${it.id}/`
       : it.kind === 'route' ? `/routes/${it.id}/`
       : `/reel/#${it.id}`;
}

/** 「已載入 N 場行跡 · M 篇文章」—— 給時光機頁首的計數行 */
export function tally(groups: YearGroup[]) {
  const all = groups.flatMap((g) => g.items);
  return {
    tales: all.filter((i) => i.kind === 'tale').length,
    routes: all.filter((i) => i.kind === 'route').length,
    reels: all.filter((i) => i.kind === 'reel').length,
    years: groups.length,
  };
}
