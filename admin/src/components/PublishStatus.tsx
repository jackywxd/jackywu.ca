'use client';
import { useEffect, useState } from 'react';

export interface ReqView { id: string; status: 'queued' | 'dispatched' | 'deployed' | 'failed'; kind: string; docId: string; collection: string; failure?: { check: string; summary: string; runUrl?: string } }

const STEPS: { key: ReqView['status'] | 'live'; label: string }[] = [
  { key: 'queued', label: '排隊' }, { key: 'dispatched', label: '建置與部署' }, { key: 'deployed', label: '已上線' },
];

/** 一條直式時間軸。失敗時直接顯示原因與連結，不讓人去別處找 */
export function PublishTimeline({ req }: { req: ReqView }) {
  const idx = req.status === 'failed' ? 1 : STEPS.findIndex((s) => s.key === req.status);
  return (
    <div className="timeline" role="status" aria-live="polite">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.key} data-state={i < idx ? 'done' : i === idx ? (req.status === 'failed' ? 'failed' : req.status === 'deployed' ? 'done' : 'active') : 'todo'}>
            <span className="dot" aria-hidden="true" />{s.label}
          </li>
        ))}
      </ol>
      {req.status === 'failed' && req.failure ? (
        <div className="alert" role="alert">
          <strong>沒有上線：{req.failure.check}</strong>
          <pre className="log">{req.failure.summary}</pre>
          <p className="hint">網站維持上一版，沒有任何東西被改動。修正後再按一次發佈。{req.failure.runUrl ? <> <a href={req.failure.runUrl} target="_blank" rel="noopener noreferrer">看完整記錄</a></> : null}</p>
        </div>
      ) : null}
      {req.status === 'deployed' ? <p className="hint">已經上線。</p> : null}
    </div>
  );
}

/** 輪詢某一篇的最新請求；有進行中的才輪詢 */
export function usePublishRequest(docId: string | null, enabled: boolean) {
  const [req, setReq] = useState<ReqView | null>(null);
  useEffect(() => {
    if (!docId || !enabled) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/publish/status', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { requests: ReqView[] };
        const mine = j.requests.find((x) => x.docId === docId && x.collection === 'tales') ?? null;
        if (!stop) setReq(mine);
      } catch { /* 網路不通時下一輪再試 */ }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [docId, enabled]);
  return [req, setReq] as const;
}
