import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { site } from '@/lib/site';
import { getTimeline, href } from '@/lib/timeline';

/**
 * 訂閱是這個站唯一不受微信／小紅書平台規則轄制的分發管道，值得留。
 * 內容取時光機（四行當），forge 與 still 不進 —— 與站上一致。
 */
export async function GET(ctx: APIContext) {
  const items = (await getTimeline())
    .flatMap((g) => g.items)
    .slice(0, 50)
    .map((it) => ({
      title: it.kind === 'route' ? it.data.name : it.data.title,
      pubDate: it.date,
      link: href(it),
      description:
        it.kind === 'tale' ? it.data.excerpt
        : it.kind === 'route' ? [it.data.region, it.data.note].filter(Boolean).join(' · ')
        : it.data.caption ?? it.data.title,
    }));

  return rss({
    title: `${site.name} · ${site.signature}`,
    description: site.description,
    site: ctx.site ?? site.url,
    items,
    customData: `<language>zh-Hant</language>`,
  });
}
