'use client';
import { useState } from 'react';
import { Sheet } from '../components/Sheet';

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
    // 打開就是要打網址：焦點直接放在輸入框
    <Sheet label="加入連結" size="confirm" focus="field" onClose={onCancel}
      onSubmit={(e) => { e.preventDefault(); const m = validateLink(v); if (m) setErr(m); else onSubmit(v.trim()); }}
      footer={<>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="btn">加入</button>
      </>}>
      <div className="field">
        <label htmlFor="link-url">網址</label>
        <input id="link-url" className="input" inputMode="url" value={v} aria-invalid={err ? true : undefined}
          onChange={(e) => { setV(e.target.value); setErr(null); }} placeholder="https://" />
        {err ? <div className="field-error" role="alert">{err}</div> : null}
      </div>
    </Sheet>
  );
}
