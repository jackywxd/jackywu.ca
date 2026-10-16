'use client';
import { useState } from 'react';

/** 取代 window.prompt：手機上看得到、測得到。網址只收 http／https／mailto／站內路徑 */
export const SAFE_LINK = /^(https?:\/\/\S+|mailto:\S+|\/(?!\/)\S*|#\S*)$/i;

export function validateLink(v: string): string | null {
  const t = v.trim();
  if (!t) return '請輸入網址';
  if (!SAFE_LINK.test(t)) return '網址要以 https://、http://、mailto: 或 / 開頭';
  return null;
}

export function LinkDialog({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (url: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <form className="sheet" role="dialog" aria-modal="true" aria-label="加入連結"
        onSubmit={(e) => { e.preventDefault(); const m = validateLink(v); if (m) setErr(m); else onSubmit(v.trim()); }}>
        <h2>加入連結</h2>
        <div className="field">
          <label htmlFor="link-url">網址</label>
          <input id="link-url" className="input" inputMode="url" autoFocus value={v} aria-invalid={err ? true : undefined}
            onChange={(e) => { setV(e.target.value); setErr(null); }} placeholder="https://" />
          {err ? <div className="field-error" role="alert">{err}</div> : null}
        </div>
        <div className="row">
          <button type="submit" className="btn btn--seal-off">加入</button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>取消</button>
        </div>
      </form>
    </>
  );
}
