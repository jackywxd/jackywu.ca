'use client';
import { useCallback, useEffect, useState } from 'react';
import { RouteImporter } from './RouteImporter';

interface RouteRow { id: number; name: string; slug: string; date: string; distanceKm?: number | null; gainM?: number | null; _status?: string }

export function RoutesPage() {
  const [rows, setRows] = useState<RouteRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    fetch('/api/routes?limit=200&depth=0&draft=true&sort=-date').then((r) => r.json() as Promise<{ docs: RouteRow[] }>).then((j) => setRows(j.docs)).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  return (
    <>
      <div className="row"><h1 className="h1 grow">路線</h1><button type="button" className="btn" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>＋ GPX</button></div>
      {adding ? <RouteImporter onDone={load} /> : null}
      {rows === null ? <p className="hint">載入中…</p> : rows.length === 0 ? <p className="empty">還沒有路線。上傳 GPX 建立第一條。</p> : (
        <div className="cards">{rows.map((r) => (
          <div key={r.id} className="card">
            <div className="row"><span className="title grow">{r.name}</span><span className="chip">{r._status === 'published' ? '已上線' : '草稿'}</span></div>
            <div className="hint">{r.date}・{r.distanceKm ?? '—'} km・爬升 {r.gainM ?? '—'} m・{r.slug}</div>
          </div>))}</div>
      )}
    </>
  );
}
