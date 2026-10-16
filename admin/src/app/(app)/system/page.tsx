import { ctx } from '../../../lib/server';
import { NeedLogin } from '../../../components/NeedLogin';
import { loadRecent } from '../../../lib/publish-service';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const { payload, user } = await ctx();
  if (!user) return <NeedLogin />;
  const recent = await loadRecent(payload, 20);
  const done = recent.filter((r) => r.status === 'deployed' && r.dispatchedAt && r.finishedAt).map((r) => (r.finishedAt! - r.createdAt) / 1000).sort((a, b) => a - b);
  const pct = (p: number) => (done.length ? done[Math.min(done.length - 1, Math.floor(done.length * p))]! : null);
  const fmt = (s: number | null) => (s === null ? '—' : s < 90 ? `${Math.round(s)} 秒` : `${(s / 60).toFixed(1)} 分`);
  return (
    <>
      <h1 className="h1">系統</h1>
      <div className="cards">
        <div className="card"><div className="title">發佈到上線所花的時間</div><div className="hint">最近 {done.length} 次：中位數 {fmt(pct(0.5))}，p95 {fmt(pct(0.95))}（目標 p95 ≤ 6 分鐘）</div></div>
        <div className="card"><div className="title">最近的發佈</div>
          {recent.length === 0 ? <div className="hint">還沒有。</div> : (
            <ul className="list">{recent.map((r) => (
              <li key={r.id}><span className={`chip chip--${r.status === 'failed' ? 'failed' : r.status === 'deployed' ? 'live' : 'plain'}`}>{r.status === 'deployed' ? '已上線' : r.status === 'failed' ? '失敗' : r.status === 'dispatched' ? '部署中' : '排隊中'}</span>
                {' '}{r.kind === 'publish' ? '發佈' : r.kind === 'unpublish' ? '撤下' : '刪除'} {r.collection}/{r.docId}
                {r.failure ? <div className="hint">{r.failure.check}：{r.failure.summary.split('\n')[0]}</div> : null}</li>
            ))}</ul>)}
        </div>
      </div>
    </>
  );
}
