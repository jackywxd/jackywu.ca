import Link from 'next/link';
import { ctx } from '../../../lib/server';
import { NeedLogin } from '../../../components/NeedLogin';
import { deriveStatus, groupByYear, latestRequestByDoc } from '../../../lib/tale-status';

export const dynamic = 'force-dynamic';

export default async function TalesPage() {
  const { payload, user } = await ctx();
  if (!user) return <NeedLogin />;

  // 最新版本（含草稿）與「已上線」的主文件是兩份資料
  const [latest, live, reqs] = await Promise.all([
    payload.find({ collection: 'tales', draft: true, limit: 500, pagination: false, depth: 0, overrideAccess: true, sort: '-date' }),
    payload.find({ collection: 'tales', draft: false, where: { _status: { equals: 'published' } }, limit: 500, pagination: false, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'publish-requests', limit: 200, sort: '-createdAtMs', pagination: false, depth: 0, overrideAccess: true }),
  ]);
  const liveIds = new Set(live.docs.map((d) => String(d.id)));
  const byDoc = latestRequestByDoc(
    (reqs.docs as unknown as { collectionSlug: string; docId: string; status: 'queued' | 'dispatched' | 'deployed' | 'failed'; kind: 'publish'; createdAtMs: number }[])
      .filter((r) => r.collectionSlug === 'tales')
      .map((r) => ({ docId: String(r.docId), status: r.status, kind: r.kind, createdAt: r.createdAtMs })),
  );
  const groups = groupByYear(latest.docs.map((d) => ({ ...d, date: d.date })));

  return (
    <>
      <div className="row"><h1 className="h1 grow">文章</h1><Link className="btn fab" href="/tales/new" aria-label="新文章">＋<span className="sr-hide"> 新文章</span></Link></div>
      {groups.length === 0 ? (
        <div className="empty"><p>還沒有任何文章。</p><Link className="btn" href="/tales/new">寫第一篇</Link></div>
      ) : groups.map((g) => (
        <section key={g.year} aria-label={`${g.year} 年`}>
          <h2 className="year">{g.year}</h2>
          <div className="cards">
            {g.items.map((d) => {
              const st = deriveStatus({ live: liveIds.has(String(d.id)), latest: d._status === 'published' ? 'published' : 'draft', request: byDoc.get(String(d.id)) ?? null });
              return (
                <Link key={d.id} className="card" href={`/tales/${d.id}`} data-status={st.key}>
                  <div className="row">
                    <span className="title grow">{d.title || '（未命名）'}</span>
                    <span className={`chip chip--${st.key === 'live' || st.key === 'live-edited' ? 'live' : st.key === 'failed' ? 'failed' : 'plain'}`}><span aria-hidden="true">{st.mark}</span>{st.label}</span>
                  </div>
                  <div className="hint">{d.date ?? '未定日期'}{d.realm ? `・${d.realm}` : ''}</div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
