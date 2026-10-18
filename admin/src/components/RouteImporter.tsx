'use client';
import { useState } from 'react';
import { REALMS } from '@content-rules';
import { isFit } from '../../../packages/activity/sniff';

type Issue = { field: string; message: string };
const TRADE_LABEL: Record<string, string> = { run: '追雲（跑）', snow: '逐雪（滑雪）', road: '鐵馬（摩托）', wild: '探幽（探險）' };

/**
 * 上傳 GPX 或 FIT → 建一條路線草稿。距離、爬升、三張 SVG 由伺服器算，這裡只填 metadata。
 * FIT（Garmin／COROS）在瀏覽器裡轉成 GPX 再送出：Worker 不必載入 FIT SDK，解析長活動也不吃 Worker 的 CPU。
 * 移動時間、總時間、開始時間從 FIT 預填，可以改。
 */
export function RouteImporter({ onDone, initial, onCreated }: {
  onDone?: () => void;
  /** 預填（在文章裡上傳時：文章的日期與行當）。FIT 檔裡的日期優先：路線的日期是活動當天 */
  initial?: Record<string, string>;
  /** 在文章裡上傳：建好就把新路線交回去選上，不顯示「已建立」的卡片 */
  onCreated?: (route: { id: number; label: string }) => void;
}) {
  const [f, setF] = useState<Record<string, string>>(() => ({
    realm: 'run', date: new Date().toLocaleDateString('sv', { timeZone: 'America/Vancouver' }),
    ...Object.fromEntries(Object.entries(initial ?? {}).filter(([k, v]) => v && (k !== 'realm' || v in TRADE_LABEL))),
  }));
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fitInfo, setFitInfo] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; stats: { distanceKm: number; gainM: number | null; points: number } } | null>(null);
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  async function pick(picked: File | null) {
    setErrors((x) => { const n = { ...x }; delete n.gpx; return n; });
    setFitInfo(null); setFile(null);
    if (!picked) return;
    // 看內容不看副檔名：.FIT 大寫、改過名的檔案都認得
    if (!isFit(new Uint8Array(await picked.slice(0, 12).arrayBuffer()))) { setFile(picked); return; }
    setBusy(true);
    try {
      const { fromFit, toGpx, isoDuration } = await import('../../../packages/activity/index');
      const r = fromFit(new Uint8Array(await picked.arrayBuffer()));
      if (!r.ok) { setErrors((x) => ({ ...x, gpx: r.error })); return; }
      setFile(new File([toGpx(r.points)], picked.name.replace(/\.fit$/i, '') + '.gpx', { type: 'application/gpx+xml' }));
      setF((x) => ({
        ...x,
        ...(r.startedAt ? { date: r.startedAt.slice(0, 10), startedAt: r.startedAt } : {}),
        ...(r.movingS != null ? { movingTime: isoDuration(r.movingS) } : {}),
        ...(r.elapsedS != null ? { elapsed: isoDuration(r.elapsedS) } : {}),
      }));
      setFitInfo([`FIT：${r.points.length} 個軌跡點${r.kind === 'course' ? '（規劃路線，沒有計時）' : ''}。日期與時間已從檔案帶入，可以修改。`, ...r.warnings].join(' '));
    } catch (e) {
      setErrors((x) => ({ ...x, gpx: `讀取 FIT 失敗：${(e as Error).message}` }));
    } finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(f)) if (v) fd.set(k, v);
      if (file) fd.set('gpx', file);
      const r = await fetch('/api/ingest/gpx', { method: 'POST', body: fd });
      const j = (await r.json()) as { id?: number; stats?: never; errors?: Issue[]; error?: string };
      if (r.status === 201) {
        const st = j.stats as unknown as { distanceKm: number; gainM: number | null; points: number };
        if (onCreated) { onCreated({ id: j.id!, label: `${f.name}・${st.distanceKm} km` }); return; }
        setResult({ id: j.id!, stats: st }); onDone?.(); return;
      }
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
      <div className="title">新增路線（GPX／FIT）</div>
      <div className="field">
        <label htmlFor="r-gpx">GPX 或 FIT 檔案</label>
        <input id="r-gpx" data-testid="gpx-file" className="input" type="file" accept=".gpx,.fit,application/gpx+xml,text/xml,application/xml,application/vnd.ant.fit,application/octet-stream" onChange={(e) => void pick(e.target.files?.[0] ?? null)} aria-invalid={errors.gpx ? true : undefined} />
        {fitInfo ? <span className="hint" role="status">{fitInfo}</span> : null}
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
      {field('movingTime', '移動時間（選填）', { placeholder: 'PT2H31M' }, '不含停下來的時間；ISO 8601 格式')}
      {field('startedAt', '開始時間（選填）', { placeholder: '2026-08-16T06:05-07:00', autoCapitalize: 'none' }, '當地時間＋時區')}
      {field('result', '成績（選填）')}
      {field('note', '備註（選填，200 字內）')}
      <button type="submit" className="btn" disabled={busy}>{busy ? '處理中…' : '建立路線'}</button>
    </form>
  );
}
