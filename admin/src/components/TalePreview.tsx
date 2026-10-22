'use client';
import { useEffect, useMemo, useState } from 'react';
import { collectMedia, lexicalToTree, UnknownNodeError, type Block } from '../../../packages/content-sync/lexical';
import { blockHtml } from '../../../packages/content-sync/html';
import { mediaFileUrl, type MediaItem } from '../lib/media-client';
import { Sheet } from './Sheet';

/**
 * 預覽：正文用前台同一份排版（.scroll，見 globals.css），圖與圖組顯示真的圖。
 * 影片、路線、墨線要建置時才產生，這裡用說明卡代替——不是空白，也不是一行看不懂的［route］。
 */
export function TalePreview({ title, slug, content, onClose }: { title: string; slug: string; content: unknown; onClose: () => void }) {
  const tree = useMemo(() => {
    try { return { ok: true as const, blocks: lexicalToTree(content, slug) }; }
    catch (e) { return { ok: false as const, message: e instanceof UnknownNodeError ? e.message : String((e as Error).message) }; }
  }, [content, slug]);

  const ids = tree.ok ? collectMedia(tree.blocks) : [];
  const key = ids.join(',');
  const [media, setMedia] = useState<Record<string, MediaItem>>({});
  useEffect(() => {
    if (!key) return;
    fetch(`/api/media?depth=0&limit=${key.split(',').length}&where[id][in]=${key}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { docs: MediaItem[] }) : { docs: [] }))
      .then((j: { docs: MediaItem[] }) => setMedia(Object.fromEntries(j.docs.map((m) => [String(m.id), m]))))
      .catch(() => {}); // 拿不到就顯示替代文字，不擋預覽
  }, [key]);

  const img = (id: string, alt: string) => {
    const m = media[id];
    // eslint-disable-next-line @next/next/no-img-element
    return m ? <img src={mediaFileUrl(m)} alt={alt || m.alt} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" />
      : <div className="stub"><strong>圖</strong>{alt || `媒體 ${id}`}</div>;
  };

  const block = (b: Block, i: number) => {
    switch (b.t) {
      case 'figure': return <figure key={i}>{img(b.media, (b as { alt?: string }).alt ?? '')}{b.caption ? <figcaption>{b.caption}</figcaption> : null}</figure>;
      case 'gallery': return <figure key={i}><div className="gal">{b.items.map((it, j) => <div key={j}>{img(it.media, it.alt)}</div>)}</div>{b.caption ? <figcaption>{b.caption}</figcaption> : null}</figure>;
      case 'code': return <pre key={i}><code>{b.code}</code></pre>;
      case 'video': return <div key={i} className="stub"><strong>影片</strong>{b.caption ?? '發佈後在這裡播放'}</div>;
      case 'route': return <div key={i} className="stub"><strong>路線圖（{b.show === 'track' ? '平面軌跡' : b.show === 'both' ? '剖面與軌跡' : '爬升剖面'}）</strong>
        {[b.from !== undefined || b.to !== undefined ? `高亮 ${b.from ?? 0}–${b.to ?? '終點'} 公里` : '', b.caption ?? ''].filter(Boolean).join('・') || '發佈後在這裡顯示'}</div>;
      case 'missing': return <div key={i} className="stub"><strong>待補圖</strong>{b.hint ?? b.original}</div>;
      case 'ink': return <div key={i} className="stub" aria-label="墨線">〰 墨線（水墨分隔）</div>;
      default: {
        const h = blockHtml(b);
        if (h === null) return <div key={i} className="stub"><strong>{b.t}</strong>這個區塊只有發佈後才看得到</div>;
        // 寬表格在自己的框裡捲，不撐寬預覽
        return <div key={i} className={b.t === 'table' ? 'table-scroll' : undefined} dangerouslySetInnerHTML={{ __html: h }} />;
      }
    }
  };

  return (
    // 只有「關閉」一個動作：標題列的 × 就是它，底部不再放一顆同名的按鈕（讀屏會聽到兩個「關閉」）
    <Sheet label="預覽" size="full" subtitle="排版與網站相同；影片、路線圖要發佈後才看得到。" onClose={onClose}>
      {tree.ok ? (
        <article className="scroll preview">
          <h1>{title || '（還沒有標題）'}</h1>
          {tree.blocks.map(block)}
        </article>
      ) : <div className="alert" role="alert"><strong>這篇現在無法建置：</strong><br />{tree.message}</div>}
    </Sheet>
  );
}
