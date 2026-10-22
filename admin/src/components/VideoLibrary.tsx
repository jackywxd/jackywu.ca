'use client';
import { Sheet } from './Sheet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TRADES } from '@content-rules';
import { uploadVideo } from '../lib/video-upload';

interface Reel { id: number; title: string; videoId: string; realm?: string | null; date?: string | null; posterAlt?: string | null; caption?: string | null; duration?: number | null; bytes?: number | null; transcode?: { status?: string; attempts?: number; error?: string | null } }
const STATUS: Record<string, { label: string; mark: string }> = {
  uploading: { label: '上傳中', mark: '↑' }, queued: { label: '排隊轉碼', mark: '…' }, running: { label: '轉碼中', mark: '↻' },
  done: { label: '可以使用', mark: '✓' }, failed: { label: '轉碼失敗', mark: '⚠' }, none: { label: '尚未上傳', mark: '·' },
};
const TRADE_LABEL: Record<string, string> = { run: '追雲（跑）', snow: '逐雪（滑雪）', road: '鐵馬（摩托）', wild: '探幽（探險）' };
const mb = (n?: number | null) => (n ? `${(n / 1048576).toFixed(1)} MB` : '—');

export function VideoLibrary() {
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [edit, setEdit] = useState<Reel | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch('/api/reels?limit=200&depth=0&draft=true&sort=-createdAt').then((r) => r.json() as Promise<{ docs: Reel[] }>).then((j) => setReels(j.docs)).catch(() => setReels([]));
  }, []);
  useEffect(load, [load]);
  // 有進行中的就輪詢，轉好了畫面自己會變
  useEffect(() => {
    if (!reels?.some((r) => ['uploading', 'queued', 'running'].includes(r.transcode?.status ?? ''))) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [reels, load]);

  async function pick(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setMsg(null); setProgress({ name: f.name, pct: 0 });
    try {
      await uploadVideo(f, { onProgress: (d, t) => setProgress({ name: f.name, pct: Math.round((d / t) * 100) }) });
      setMsg('上傳完成，開始轉碼。轉好之後狀態會自動更新。');
    } catch (e) { setMsg(`上傳失敗：${(e as Error).message}`); } finally { setProgress(null); load(); }
  }
  async function retry(r: Reel) {
    const res = await fetch('/api/video/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reel: String(r.id) }) });
    setMsg(res.ok ? '已重新排入轉碼。' : `無法重新轉碼（${res.status}）`); load();
  }

  return (
    <section aria-label="影片">
      <div className="row"><h2 className="year grow">影片</h2>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={!!progress}>上傳影片</button>
        <input ref={input} data-testid="video-file" type="file" hidden accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v" onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} /></div>
      {progress ? <div role="status" className="card"><div className="hint">上傳 {progress.name}</div><progress value={progress.pct} max={100} aria-label="上傳進度" style={{ inlineSize: '100%' }} /> <span className="hint">{progress.pct}%</span></div> : null}
      {msg ? <div className="alert" role="status">{msg}</div> : null}
      {reels === null ? <p className="hint">載入中…</p> : reels.length === 0 ? <p className="empty">還沒有影片。iPhone 拍的 HEVC 也可以，會自動轉成相容的格式。</p> : (
        <div className="cards">{reels.map((r) => {
          const s = STATUS[r.transcode?.status ?? 'none'] ?? STATUS.none!;
          return (
            <div key={r.id} className="card">
              <div className="row"><span className="title grow">{r.title}</span><span className={`chip ${r.transcode?.status === 'failed' ? 'chip--failed' : ''}`}><span aria-hidden="true">{s.mark}</span>{s.label}</span></div>
              <div className="hint">{r.videoId}・{mb(r.bytes)}{r.duration ? `・${r.duration} 秒` : ''}</div>
              {r.transcode?.error ? <div className="field-error" role="alert">{r.transcode.error}</div> : null}
              <div className="row">
                <button type="button" className="btn btn--ghost" onClick={() => setEdit(r)}>編輯資料</button>
                {r.transcode?.status === 'failed' ? <button type="button" className="btn btn--ghost" onClick={() => void retry(r)}>重新轉碼</button> : null}
              </div>
            </div>);
        })}</div>
      )}
      {edit ? <ReelSheet reel={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} /> : null}
    </section>
  );
}

function ReelSheet({ reel, onClose, onSaved }: { reel: Reel; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: reel.title ?? '', realm: reel.realm ?? '', date: reel.date ?? '', posterAlt: reel.posterAlt ?? '', caption: reel.caption ?? '' });
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/reels/${reel.id}?draft=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, realm: f.realm || null, date: f.date || null }) });
    if (r.ok) onSaved(); else setErr(`儲存失敗（${r.status}）`);
  }
  return (
    <Sheet label="影片資料" onClose={onClose} onSubmit={save}
      footer={<><button type="button" className="btn btn--ghost" onClick={onClose}>取消</button><button type="submit" className="btn">儲存</button></>}>
        <div className="field"><label htmlFor="rl-title">標題</label><input id="rl-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label htmlFor="rl-realm">行當（發佈必填）</label>
          <select id="rl-realm" className="select" value={f.realm} onChange={(e) => setF({ ...f, realm: e.target.value })}><option value="">請選擇</option>{TRADES.map((t) => <option key={t} value={t}>{TRADE_LABEL[t]}</option>)}</select></div>
        <div className="field"><label htmlFor="rl-date">日期（發佈必填）</label><input id="rl-date" className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="field"><label htmlFor="rl-alt">封面的替代文字（發佈必填）</label><input id="rl-alt" className="input" value={f.posterAlt} onChange={(e) => setF({ ...f, posterAlt: e.target.value })} /></div>
        <div className="field"><label htmlFor="rl-cap">圖說（選填，120 字內）</label><input id="rl-cap" className="input" maxLength={120} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /></div>
        {err ? <div className="alert" role="alert">{err}</div> : null}
    </Sheet>
  );
}
