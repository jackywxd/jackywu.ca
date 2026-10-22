'use client';
import Link from 'next/link';
import { useState } from 'react';

interface Problem { level: 'warn' | 'error'; where: string; message: string }
interface Outcome {
  id: number; problems: Problem[]; missing: string[]; issues: { field: string; message: string }[]; unknown: string[];
  aliased: { from: string; to: string }[]; images: { uploaded: number; reused: number };
}
const FIELD_LABEL: Record<string, string> = { title: '標題', slug: '網址代稱', date: '日期', realm: '行當', excerpt: '摘要', verse: '金句', lang: '語言', updated: '更新日', hero: '封面' };

/** 導入外部 MDX（或 zip）。一律建成新草稿，不動任何既有文章。 */
export function ImportTale() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<number | string | null>(null);
  const [out, setOut] = useState<Outcome | null>(null);
  const [over, setOver] = useState(false);

  const pick = (list: FileList | null) => { setFiles(Array.from(list ?? [])); setError(null); setExisting(null); setOut(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) { setError('請先選擇檔案'); return; }
    setBusy(true); setError(null); setExisting(null); setOut(null);
    try {
      const fd = new FormData();
      // 資料夾上傳時用相對路徑當檔名，文章裡的相對圖片路徑才對得上
      for (const f of files) fd.append('files', new File([f], (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, { type: f.type }));
      const r = await fetch('/api/ingest/mdx', { method: 'POST', body: fd });
      const j = (await r.json()) as Outcome & { error?: string; existing?: number | string };
      if (r.status === 201) setOut(j); else { setError(j.error ?? `導入失敗（${r.status}）`); setExisting(j.existing ?? null); }
    } catch { setError('網路不通，請稍後再試'); } finally { setBusy(false); }
  }

  const errors = out?.problems.filter((p) => p.level === 'error') ?? [], warns = out?.problems.filter((p) => p.level === 'warn') ?? [];
  return (
    <>
      <h1 className="h1">導入文章</h1>
      <form className="card stack" onSubmit={submit} aria-label="導入文章">
        <p className="hint">一個 .md／.mdx（可以連同它用到的圖片），或一個 .zip。會建立成新的草稿，不會動到任何既有的文章。外站的圖片不會被下載，會留成「待補圖」。自帶樣式的圖表（&lt;style&gt;、&lt;svg&gt;）照原樣帶進來。</p>
        {/* 瀏覽器原生的檔案欄位是英文的「Choose Files」：換成整塊可點、可拖放的選檔區，input 本身留著給鍵盤與測試 */}
        <label className="drop" data-over={over || undefined} htmlFor="imp-files"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
          <strong>選擇檔案</strong>
          <span className="hint">或把檔案拖到這裡（.md、.mdx、.zip、圖片）</span>
          <input id="imp-files" data-testid="import-files" type="file" multiple accept=".md,.mdx,.zip,.jpg,.jpeg,.png,.webp" onChange={(e) => pick(e.target.files)} />
        </label>
        {/* 手機瀏覽器不能選資料夾：只在桌面顯示 */}
        <div className="row desktop-only"><label className="btn btn--ghost" htmlFor="imp-dir">改選整個資料夾</label>
          <input id="imp-dir" type="file" hidden {...{ webkitdirectory: '' }} onChange={(e) => pick(e.target.files)} /></div>
        {files.length ? (
          <div role="status"><p className="hint">已選 {files.length} 個檔案：</p>
            <ul className="files">{files.slice(0, 8).map((f) => <li key={f.name + f.size}>{(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name}</li>)}
              {files.length > 8 ? <li>…還有 {files.length - 8} 個</li> : null}</ul></div>
        ) : null}
        {error ? <div className="alert" role="alert">{error}{existing !== null ? <> <Link href={`/tales/${existing}`}>打開那篇</Link></> : null}</div> : null}
        <button type="submit" className="btn" disabled={busy}>{busy ? '導入中…' : '導入'}</button>
      </form>

      {out ? (
        <div className="card stack" role="status" aria-label="導入結果">
          <div className="title">草稿已建立</div>
          <p className="hint">圖片：新上傳 {out.images.uploaded} 張，沿用既有 {out.images.reused} 張。</p>
          {out.missing.length ? <div className="alert"><strong>發佈前還要補這些欄位：</strong>{out.missing.map((m) => FIELD_LABEL[m] ?? m).join('、')}</div> : null}
          {out.issues.length ? <ul className="list">{out.issues.map((i) => <li key={i.field} className="field-error">{FIELD_LABEL[i.field] ?? i.field}：{i.message}</li>)}</ul> : null}
          {out.aliased.length ? <p className="hint">換個名字帶進來的欄位：{out.aliased.map((a) => `${a.from} → ${FIELD_LABEL[a.to] ?? a.to}`).join('、')}</p> : null}
          {out.unknown.length ? <p className="hint">不認得、沒有帶進來的欄位：{out.unknown.join('、')}</p> : null}
          {errors.length ? <div className="alert" role="alert"><strong>{errors.length} 個地方需要你處理（發佈前必須解決）：</strong>
            <ul className="list">{errors.map((p, i) => <li key={i}>{p.where}：{p.message}</li>)}</ul></div> : null}
          {warns.length ? <details><summary>{warns.length} 個提醒</summary><ul className="list">{warns.map((p, i) => <li key={i} className="hint">{p.where}：{p.message}</li>)}</ul></details> : null}
          <Link className="btn" href={`/tales/${out.id}`}>打開草稿</Link>
        </div>
      ) : null}
    </>
  );
}
