'use client';
import { Sheet } from './Sheet';
import { useEffect, useRef, useState } from 'react';
import { listMedia } from '../lib/api-client';
import { ACCEPT_IMAGE, mediaFileUrl, uploadImage, type MediaItem } from '../lib/media-client';

/** 媒體庫：方格、上傳、改 alt。不提供刪除（沒被引用的檔案由系統頁列出，刪除指令給你自己跑）。 */
export function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { listMedia(200).then(setItems).catch((e) => setErr(String(e.message ?? e))); }, []);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setBusy((n) => n + 1);
      try { const m = await uploadImage(f, ''); setItems((c) => (c?.some((x) => x.id === m.id) ? c : [m, ...(c ?? [])])); }
      catch (e) { setErr((e as Error).message); } finally { setBusy((n) => n - 1); }
    }
  }
  async function saveAlt(m: MediaItem, alt: string) {
    const r = await fetch(`/api/media/${m.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alt }) });
    if (!r.ok) { setErr(`儲存替代文字失敗（${r.status}）`); return; }
    setItems((c) => c?.map((x) => (x.id === m.id ? { ...x, alt } : x)) ?? c);
    setOpen(null);
  }

  return (
    <>
      <div className="row">
        <button type="button" className="btn" onClick={() => file.current?.click()}>上傳圖片</button>
        <input ref={file} type="file" accept={ACCEPT_IMAGE} multiple hidden data-testid="media-file" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
        {busy ? <span className="hint" role="status">上傳中…（{busy}）</span> : null}
      </div>
      {err ? <div className="alert" role="alert">{err}</div> : null}
      {items === null ? <p className="hint">載入中…</p> : items.length === 0 ? <p className="empty">還沒有圖片。</p> : (
        <ul className="media-grid" aria-label="圖片">
          {items.map((m) => (
            <li key={m.id}><button type="button" className="media-cell" onClick={() => setOpen(m)} aria-label={m.alt || m.filename}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaFileUrl(m)} alt="" loading="lazy" width={m.width ?? undefined} height={m.height ?? undefined} /></button></li>
          ))}
        </ul>
      )}
      {open ? <AltSheet m={open} onSave={saveAlt} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function AltSheet({ m, onSave, onClose }: { m: MediaItem; onSave: (m: MediaItem, alt: string) => void; onClose: () => void }) {
  const [alt, setAlt] = useState(m.alt ?? '');
  return (
    <Sheet label="圖片詳情" title="圖片" subtitle={`${m.width}×${m.height}・${m.filename}`} onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); if (alt.trim()) onSave(m, alt.trim()); }}
      footer={<><button className="btn btn--ghost" type="button" onClick={onClose}>取消</button><button className="btn" type="submit" disabled={!alt.trim()}>儲存</button></>}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaFileUrl(m)} alt={alt} style={{ maxInlineSize: '100%', blockSize: 'auto', marginBlockEnd: 'var(--space-2)' }} />
      <div className="field"><label htmlFor="alt">替代文字（必填，給看不到圖的人）</label>
        <input id="alt" className="input" value={alt} onChange={(e) => setAlt(e.target.value)} aria-invalid={!alt.trim() ? true : undefined} /></div>
    </Sheet>
  );
}
