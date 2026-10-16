'use client';
import { useState } from 'react';
import { REALMS } from '@content-rules';

type Issue = { field: string; message: string };
const TRADE_LABEL: Record<string, string> = { run: '追雲（跑）', snow: '逐雪（滑雪）', road: '鐵馬（摩托）', wild: '探幽（探險）' };

/** 上傳 GPX → 建一條路線草稿。距離、爬升、三張 SVG 由伺服器算，這裡只填 metadata。 */
export function RouteImporter({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ realm: 'run', date: new Date().toLocaleDateString('sv', { timeZone: 'America/Vancouver' }) });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: number; stats: { distanceKm: number; gainM: number | null; points: number } } | null>(null);
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(f)) if (v) fd.set(k, v);
      if (file) fd.set('gpx', file);
      const r = await fetch('/api/ingest/gpx', { method: 'POST', body: fd });
      const j = (await r.json()) as { id?: number; stats?: never; errors?: Issue[]; error?: string };
      if (r.status === 201) { setResult({ id: j.id!, stats: j.stats! }); onDone(); return; }
      if (j.errors) setErrors(Object.fromEntries(j.errors.map((x) => [x.field, x.message])));
      else setErrors({ gpx: j.error ?? `上傳失敗（${r.status}）` });
    } catch { setErrors({ gpx: '網路不通，請稍後再試' }); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <div className="card" role="status">
        <div className="title">路線已建立（草稿）</div>
        <p className="hint">{result.stats.points} 個軌跡點・距離 {result.stats.distanceKm} km・累計爬升 {result.stats.gainM ?? '（GPX 沒有高程）'} m</p>
        <p className="hint">在文章裡輸入 / → 路線 就能插入。要讓它上線，連同引用它的文章一起發佈。</p>
        <button type="button" className="btn" onClick={() => { setResult(null); setFile(null); setF({ realm: 'run', date: f.date ?? '' }); }}>再加一條</button>
      </div>
    );
  }
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="field">
      <label htmlFor={`r-${name}`}>{label}</label>
      <input id={`r-${name}`} className="input" value={f[name] ?? ''} onChange={(e) => set(name, e.target.value)} aria-invalid={errors[name] ? true : undefined} aria-describedby={`r-${name}-e`} {...props} />
      {hint ? <span className="hint">{hint}</span> : null}
      <div id={`r-${name}-e`} className="field-error" role={errors[name] ? 'alert' : undefined} hidden={!errors[name]}>{errors[name]}</div>
    </div>
  );
  return (
    <form className="card" onSubmit={submit} aria-label="新增路線">
      <div className="title">新增路線（GPX）</div>
      <div className="field">
        <label htmlFor="r-gpx">GPX 檔案</label>
        <input id="r-gpx" data-testid="gpx-file" className="input" type="file" accept=".gpx,application/gpx+xml,text/xml,application/xml" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErrors((x) => { const n = { ...x }; delete n.gpx; return n; }); }} aria-invalid={errors.gpx ? true : undefined} />
        <div className="field-error" role={errors.gpx ? 'alert' : undefined} hidden={!errors.gpx}>{errors.gpx}</div>
      </div>
      {field('name', '路線名稱')}
      {field('slug', '網址代稱', { autoCapitalize: 'none' }, '小寫英數與連字號，例如 whistler-utmb-100k-2026')}
      <div className="field"><label htmlFor="r-realm">行當</label>
        <select id="r-realm" className="select" value={f.realm} onChange={(e) => set('realm', e.target.value)} aria-invalid={errors.realm ? true : undefined}>
          {REALMS.filter((r) => r in TRADE_LABEL).map((r) => <option key={r} value={r}>{TRADE_LABEL[r]}</option>)}</select>
        <div className="field-error" role={errors.realm ? 'alert' : undefined} hidden={!errors.realm}>{errors.realm}</div></div>
      {field('region', '地區', {}, '例如：卑詩 · 威士拿')}
      {field('date', '日期', { type: 'date' })}
      {field('nameEn', '英文名稱（選填）')}
      {field('badge', '徽記（選填）', {}, '例如：UTW · 100K · 2026')}
      {field('elapsed', '用時（選填）', { placeholder: 'PT21H47M' }, 'ISO 8601 格式')}
      {field('result', '成績（選填）')}
      {field('note', '備註（選填，200 字內）')}
      <button type="submit" className="btn" disabled={busy}>{busy ? '處理中…' : '建立路線'}</button>
    </form>
  );
}
