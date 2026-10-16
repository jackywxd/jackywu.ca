'use client';
import { useEffect, useRef, useState } from 'react';
import { listMedia } from '../lib/api-client';
import { ACCEPT_IMAGE, mediaFileUrl, uploadImage, type MediaItem } from '../lib/media-client';

/** 選一張或多張已上傳的圖，或當場上傳。上傳中時外層要禁止存檔與發佈（onBusy）。 */
export function MediaPicker({ multiple, onPick, onClose, onBusy }: {
  multiple?: boolean; onPick: (items: MediaItem[]) => void; onClose: () => void; onBusy?: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [sel, setSel] = useState<MediaItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { listMedia().then(setItems).catch((e) => setErr(String(e.message ?? e))); }, []);
  useEffect(() => { onBusy?.(busy > 0); }, [busy, onBusy]);
  // 單選時上傳完成就關掉抽屜，元件在 busy 回到 0 之前就被卸載了——卸載時一定要把「忙碌」放掉，
  // 否則外層永遠以為還在上傳，發佈鈕永遠是灰的
  useEffect(() => () => onBusy?.(false), [onBusy]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    for (const f of Array.from(files)) {
      setBusy((n) => n + 1);
      try {
        const m = await uploadImage(f, '');
        setItems((cur) => (cur?.some((x) => x.id === m.id) ? cur : [m, ...(cur ?? [])]));
        if (multiple) setSel((s) => [...s, m]); else { onPick([m]); return; }
      } catch (e) { setErr((e as Error).message); } finally { setBusy((n) => n - 1); }
    }
  }
  const toggle = (m: MediaItem) => {
    if (!multiple) return onPick([m]);
    setSel((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : [...s, m]));
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="選擇圖片">
        <h2>選擇圖片</h2>
        <div className="row" style={{ marginBlockEnd: 'var(--space-2)' }}>
          <button type="button" className="btn" onClick={() => file.current?.click()}>從相簿或相機上傳</button>
          <input ref={file} type="file" accept={ACCEPT_IMAGE} multiple={multiple} hidden data-testid="media-file" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
          {busy > 0 ? <span className="hint" role="status">上傳中…（{busy}）</span> : null}
        </div>
        {err ? <div className="alert" role="alert">{err}</div> : null}
        {items === null ? <p className="hint">載入中…</p> : items.length === 0 ? <p className="empty">還沒有圖片。上傳第一張吧。</p> : (
          <ul className="media-grid" aria-label="圖片">
            {items.map((m) => (
              <li key={m.id}>
                <button type="button" className="media-cell" aria-pressed={sel.some((x) => x.id === m.id)} aria-label={m.alt || m.filename} onClick={() => toggle(m)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaFileUrl(m)} alt="" loading="lazy" width={m.width ?? undefined} height={m.height ?? undefined} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {multiple ? (
          <div className="row" style={{ marginBlockStart: 'var(--space-2)' }}>
            <button type="button" className="btn" disabled={!sel.length || busy > 0} onClick={() => onPick(sel)}>加入 {sel.length} 張</button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>取消</button>
          </div>
        ) : <div className="row"><button type="button" className="btn btn--ghost" onClick={onClose}>取消</button></div>}
      </div>
    </>
  );
}
