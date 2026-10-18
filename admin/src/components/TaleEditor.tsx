'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateTale } from '@content-rules';
import { lexicalToTree, UnknownNodeError } from '../../../packages/content-sync/lexical';
import { blockHtml } from '../../../packages/content-sync/html';
import { Editor } from '../editor/Editor';
import { TaleContext } from '../editor/tale-context';
import { createAutosave, type SaveState } from '../editor/autosave';
import { blockProblems, isBlank } from '../editor/problems';
import { emptyState, type EditorStateJSON } from '../editor/serialize';
import { clearLocal, compareLocal, readLocal, writeLocal } from '../lib/local-draft';
import { PublishTimeline, usePublishRequest, type ReqView } from './PublishStatus';
import { TaleSettings, type FieldErrors, type Meta } from './TaleSettings';
import type { LexicalEditor } from 'lexical';

export interface TaleInit { id: string | null; meta: Meta; content: EditorStateJSON | null; updatedAt: string | null; live: boolean }

/** 離線與否：離線時不必等 30 秒的存檔間隔才告訴使用者，內容已經備份在這台裝置上 */
function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(navigator.onLine);
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

const SAVE_LABEL: Record<SaveState, string> = { saved: '已儲存', dirty: '尚未儲存', saving: '儲存中…', error: '儲存失敗，稍後自動重試' };

/** meta → 送給 Payload 的欄位。空字串一律改成 null（slug 有 unique，多筆空字串會互相衝突） */
export function metaToBody(meta: Meta): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === '_status' || k === 'content') continue;
    body[k] = v === '' ? null : v && typeof v === 'object' && !Array.isArray(v) && 'id' in v ? (v as { id: unknown }).id : v;
  }
  return body;
}

/** relationship 欄位可能是 id 或展開的文件 */
const refId = (v: unknown) => (v && typeof v === 'object' ? ((v as { id?: number | string }).id ?? null) : (v as number | string | null | undefined) ?? null);

function fieldErrors(meta: Meta): FieldErrors {
  const e: FieldErrors = {};
  for (const x of validateTale({
    title: String(meta.title ?? ''), slug: String(meta.slug ?? ''), date: String(meta.date ?? ''), realm: String(meta.realm ?? ''),
    excerpt: String(meta.excerpt ?? ''), verse: (meta.verse as string) ?? null, shareable: (meta.shareable as boolean) ?? true,
    hero: meta.hero, heroAlt: (meta.heroAlt as string) ?? null,
  })) e[x.field] ??= x.message;
  return e;
}

export function TaleEditor({ init }: { init: TaleInit }) {
  const [meta, setMeta] = useState<Meta>(init.meta);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<SaveState>('saved');
  const online = useOnline();
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState(false);
  const [source, setSource] = useState<null | { text: string; problems: { level: 'warn' | 'error'; where: string; message: string }[] }>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [recover, setRecover] = useState<null | { kind: 'local-newer' | 'conflict'; local: ReturnType<typeof readLocal>; serverUpdatedAt?: string | null }>(null);
  // 「要用哪一份」還沒回答之前：不存檔、不寫備份（不能覆寫那份還沒被選的本機草稿）
  const recoverRef = useRef(recover); recoverRef.current = recover;
  const [live, setLive] = useState(init.live);
  const [danger, setDanger] = useState<null | 'unpublish' | 'delete'>(null);

  const idRef = useRef<string | null>(init.id);
  const metaRef = useRef(meta); metaRef.current = meta;
  const contentRef = useRef<EditorStateJSON | null>(init.content);
  const updatedAtRef = useRef<string | null>(init.updatedAt);
  const uploadingRef = useRef(false); uploadingRef.current = uploading;
  const editorRef = useRef<LexicalEditor | null>(null);
  const [initialContent, setInitialContent] = useState<EditorStateJSON | null>(init.content);
  const [editorKey, setEditorKey] = useState(0);
  // 新文章第一次存檔用的隨機鍵：建立成功但回應沒送到時，重試先用它找回同一篇（不建第二篇）
  const clientKeyRef = useRef<string>(init.id ? '' : crypto.randomUUID());
  // 每次編輯 +1：存檔期間又有編輯時，存檔成功也不能清掉備份（那些編輯還沒上伺服器）
  const editSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const deletedRef = useRef(false);

  const backup = useCallback(() => {
    editSeqRef.current++;
    if (recoverRef.current) return;
    writeLocal(idRef.current, { meta: metaRef.current, content: contentRef.current, at: Date.now(), baseUpdatedAt: updatedAtRef.current });
  }, []);

  const save = useCallback(async () => {
    if (deletedRef.current) return;
    const seq = editSeqRef.current;
    const body = { ...metaToBody(metaRef.current), content: contentRef.current ?? emptyState() };
    let create = !idRef.current;
    if (create) {
      // 上一次的建立可能已經在伺服器成功、只是回應沒送到：先找，找到就改成更新它
      const f = await fetch(`/api/tales?where[clientKey][equals]=${clientKeyRef.current}&draft=true&depth=0&limit=1`, { cache: 'no-store' });
      const hit = f.ok ? ((await f.json()) as { docs: { id: number | string; updatedAt: string }[] }).docs[0] : undefined;
      if (hit) { idRef.current = String(hit.id); updatedAtRef.current = hit.updatedAt; create = false; }
    } else {
      // 樂觀鎖：伺服器上的版本比我開始編輯的那一版新，代表別的裝置改過了——不覆蓋，讓人選
      const cur = await fetch(`/api/tales/${idRef.current}?draft=true&depth=0&select[updatedAt]=true`, { cache: 'no-store' });
      if (cur.ok) {
        const server = ((await cur.json()) as { updatedAt?: string }).updatedAt ?? null;
        if (server && updatedAtRef.current && server !== updatedAtRef.current) {
          writeLocal(idRef.current, { meta: metaRef.current, content: contentRef.current, at: Date.now(), baseUpdatedAt: updatedAtRef.current });
          setRecover({ kind: 'conflict', local: readLocal(idRef.current), serverUpdatedAt: server });
          throw new Error('別的裝置已經改過這篇');
        }
      }
    }
    const r = await fetch(create ? '/api/tales?draft=true' : `/api/tales/${idRef.current}?draft=true`, {
      method: create ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(create ? { ...body, clientKey: clientKeyRef.current } : body),
    });
    if (!r.ok) {
      const t = await r.text();
      // 唯一索引：slug 重複。這是欄位問題，不是網路問題，要告訴使用者是哪個欄位
      if (/slug/i.test(t) && /unique|重複|already/i.test(t)) setErrors((e) => ({ ...e, slug: '這個網址代稱已經被另一篇使用，請換一個' }));
      throw new Error(`儲存失敗（${r.status}）`);
    }
    const j = (await r.json()) as { doc: { id: number | string; updatedAt: string } };
    updatedAtRef.current = j.doc.updatedAt;
    if (create) idRef.current = String(j.doc.id);
    // 新文章：網址換成 /tales/<id>。已經離開這一頁（存檔是在卸載時送出的）就不能動網址，那會改到別的頁
    if (!init.id && mountedRef.current && window.location.pathname === '/tales/new') window.history.replaceState(null, '', `/tales/${idRef.current}`);
    if (editSeqRef.current === seq) clearLocal(idRef.current);
    else backup(); // 存檔期間又有編輯：備份留著（新文章的話搬到新 id 的鍵下）
    clearLocal(null);
  }, [backup, init.id]);

  const autosave = useMemo(() => createAutosave({
    now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as number),
    save, blocked: () => uploadingRef.current || !!editorRef.current?.isComposing() || !!recoverRef.current, onState: setState,
  }), [save]);

  // 載入時比對本機備份
  useEffect(() => {
    // 上一頁／下一頁回到「新文章」被換成 /tales/<id> 的那一筆歷史：Next 會還原新文章的畫面。重新載入，拿到伺服器上的那篇
    if (!init.id && window.location.pathname !== '/tales/new') { window.location.replace(window.location.pathname); return; }
    const local = readLocal(init.id);
    const cmp = compareLocal(local, init.updatedAt);
    if (cmp !== 'use-server') setRecover({ kind: cmp, local, serverUpdatedAt: init.updatedAt });
    else if (local) clearLocal(init.id);
  }, [init.id, init.updatedAt]);

  // 連線恢復：立刻把離線期間的變更存上去，不等存檔間隔
  useEffect(() => { if (online && autosave.state !== 'saved') void autosave.flush(); }, [online, autosave]);

  // 離開前：有未存的變更就提醒（只在真的有變更時）
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (autosave.state !== 'saved') { backup(); e.preventDefault(); } };
    const v = () => { if (document.visibilityState === 'hidden' && autosave.state !== 'saved') { backup(); void autosave.flush(); } };
    window.addEventListener('beforeunload', h); document.addEventListener('visibilitychange', v);
    mountedRef.current = true;
    // 在後台裡換頁（點了別的連結）不會觸發 beforeunload：卸載時把還沒存的存掉，不是丟掉
    return () => { mountedRef.current = false; window.removeEventListener('beforeunload', h); document.removeEventListener('visibilitychange', v); void autosave.flush(); };
  }, [autosave, backup]);

  const patch = (p: Partial<Meta>) => {
    setMeta((m) => {
      const next = { ...m, ...p } as Meta;
      if (next.realm === 'still') next.shareable = false;
      return next;
    });
    setErrors((e) => { const n = { ...e }; for (const k of Object.keys(p)) delete n[k]; return n; });
    queueMicrotask(() => { backup(); autosave.markDirty(); });
  };

  const [req, setReq] = usePublishRequest(idRef.current, publishing);
  const active = !!req && (req.status === 'queued' || req.status === 'dispatched');
  // 部署完成：上線狀態跟著變；刪除完成就回列表（這篇已經不存在了）
  useEffect(() => {
    if (req?.status !== 'deployed') return;
    if (req.kind === 'delete') { clearLocal(idRef.current); window.location.assign('/tales'); return; }
    setLive(req.kind === 'publish');
  }, [req]);

  async function publish() {
    setNotice(null);
    if (!(await autosave.flush())) { setNotice('有圖片還在上傳，或儲存沒有成功。等一下再按發佈。'); return; }
    const errs = fieldErrors(metaRef.current);
    const probs = blockProblems(contentRef.current);
    if (isBlank(String(metaRef.current.title ?? ''), contentRef.current)) errs.title = '標題與內文都是空的';
    if (Object.keys(errs).length || probs.length) {
      setErrors(errs);
      setNotice(probs.length ? `內文有 ${probs.length} 個區塊還沒補齊：${probs.map((p) => `第 ${p.index} 個（${p.message}）`).join('、')}` : '有欄位需要修正，已標在設定裡。');
      if (Object.keys(errs).some((k) => k !== 'title')) setSettings(true);
      return;
    }
    const r = await fetch('/api/publish/request', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ collection: 'tales', docId: idRef.current, kind: 'publish' }),
    });
    if (r.status === 422) {
      const j = (await r.json()) as { errors: { field: string; message: string }[] };
      setErrors(Object.fromEntries(j.errors.map((e) => [e.field, e.message])));
      setNotice('伺服器檢查沒通過，已標在設定裡。');
      setSettings(true);
      return;
    }
    if (!r.ok) { setNotice(`送出失敗（${r.status}）。稿子已經存好，稍後再試。`); return; }
    setPublishing(true);
    setReq(null);
  }

  /** 撤下／刪除：從沒上線過的草稿直接刪掉；已上線的走發佈管線（建置成功才生效） */
  async function change(kind: 'unpublish' | 'delete') {
    setDanger(null); setNotice(null);
    if (kind === 'delete') { deletedRef.current = true; autosave.cancel(); }
    const r = await fetch('/api/publish/request', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ collection: 'tales', docId: idRef.current, kind }),
    });
    const j = (await r.json().catch(() => ({}))) as { deleted?: boolean; errors?: { message: string }[] };
    if (r.ok && j.deleted) { clearLocal(idRef.current); window.location.assign('/tales'); return; }
    if (kind === 'delete') deletedRef.current = false;
    if (r.status === 422) { setNotice(j.errors?.map((e) => e.message).join('；') ?? '不能這樣做'); return; }
    if (!r.ok) { setNotice(`送出失敗（${r.status}），稍後再試。`); return; }
    setPublishing(true); setReq(null);
  }

  async function openSource() {
    // 先存好目前的內容，再轉成文字；原始碼模組在這時才載入
    try {
      const m = await import('../lib/source-mode');
      setSource({ text: m.exportSource(contentRef.current ?? emptyState()), problems: [] });
    } catch (e) { setNotice(`無法開啟原始碼：${(e as Error).message}`); }
  }
  async function applySourceText() {
    if (!source) return;
    const m = await import('../lib/source-mode');
    const r = m.applySource(source.text);
    if (!r.ok) { setSource({ ...source, problems: r.problems }); return; } // 有錯誤：停在原始碼，指出哪一行，不套用
    contentRef.current = r.state as unknown as EditorStateJSON;
    setInitialContent(contentRef.current); setEditorKey((k) => k + 1);
    backup(); autosave.markDirty(); setSource(null);
    void autosave.flush(); // 這是使用者明確的動作，不等 30 秒的存檔間隔
  }

  const tree = useMemo(() => {
    if (!preview) return null;
    try { return { ok: true as const, blocks: lexicalToTree(contentRef.current ?? emptyState(), String(meta.slug ?? '新文章')) }; }
    catch (e) { return { ok: false as const, message: e instanceof UnknownNodeError ? e.message : String((e as Error).message) }; }
  }, [preview, meta.slug]);

  const settingsErrorCount = Object.keys(errors).filter((k) => k !== 'title').length;

  return (
    <div className="tale">
      {recover ? (
        <div className="alert" role="alert">
          {recover.kind === 'conflict' ? '這篇在別的裝置上也改過了，兩邊的版本不同。' : '這台裝置上有一份比伺服器更新的草稿（可能是上次沒存成功）。'}
          <div className="row">
            <button type="button" className="btn" onClick={() => {
              const l = recover.local!;
              // 選了這台的：以伺服器目前的版本為基準覆蓋過去（這是本人的決定，不再被樂觀鎖擋）
              if (recover.serverUpdatedAt) updatedAtRef.current = recover.serverUpdatedAt;
              setMeta(l.meta as Meta); metaRef.current = l.meta as Meta; contentRef.current = l.content as EditorStateJSON | null;
              setInitialContent(l.content as EditorStateJSON | null); setEditorKey((k) => k + 1);
              recoverRef.current = null; setRecover(null); backup(); autosave.markDirty();
            }}>用這台裝置的版本</button>
            {/* 選伺服器的：重新載入，編輯器才會是伺服器上的內容（存檔時才發現的衝突，畫面上還是這台的） */}
            <button type="button" className="btn btn--ghost" onClick={() => { clearLocal(idRef.current); window.location.reload(); }}>用伺服器的版本</button>
          </div>
        </div>
      ) : null}

      {/* 還沒選要用哪一份之前不能編輯：打進去的字不屬於任何一份，選完就會被換掉 */}
      <div inert={recover ? true : undefined}>
        <input className="tale-title" aria-label="標題" placeholder="標題" value={String(meta.title ?? '')} aria-invalid={errors.title ? true : undefined}
          onChange={(e) => patch({ title: e.target.value })} />
        {errors.title ? <div className="field-error" role="alert">{errors.title}</div> : null}

        <TaleContext.Provider value={{ date: String(meta.date ?? ''), realm: String(meta.realm ?? ''), route: refId(meta.route), setTaleRoute: (id) => patch({ route: id }) }}>
          <Editor key={editorKey} initial={initialContent} apiRef={editorRef} onBusy={setUploading}
            onChange={(json) => { contentRef.current = json; backup(); autosave.markDirty(); }} />
        </TaleContext.Provider>
      </div>

      {notice ? <div className="alert" role="alert">{notice}</div> : null}
      {req && publishing ? <PublishTimeline req={req as ReqView} /> : null}

      <div className="actionbar" role="group" aria-label="文章操作">
        <span className="save-state" role="status" aria-live="polite" data-state={state}>{uploading ? '圖片上傳中…' : !online ? '離線中：內容已備份在這台裝置，連線後自動儲存' : SAVE_LABEL[state]}</span>
        <button type="button" className="btn btn--ghost" onClick={() => void openSource()}>原始碼</button>
        <button type="button" className="btn btn--ghost" onClick={() => setPreview(true)}>預覽</button>
        <button type="button" className="btn btn--ghost" onClick={() => setSettings(true)}>設定{settingsErrorCount ? `（${settingsErrorCount}）` : ''}</button>
        <button type="button" className="btn btn--seal" disabled={uploading || active} onClick={() => void publish()}>{active ? '發佈中…' : '發佈'}</button>
      </div>

      {settings ? <TaleSettings meta={meta} errors={errors} onChange={patch} onClose={() => setSettings(false)} onBusy={setUploading}
        danger={idRef.current ? { live, onUnpublish: () => { setSettings(false); setDanger('unpublish'); }, onDelete: () => { setSettings(false); setDanger('delete'); } } : undefined} /> : null}
      {danger ? (
        <>
          <div className="sheet-backdrop" onClick={() => setDanger(null)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label={danger === 'unpublish' ? '撤下這篇' : '刪除這篇'}>
            <h2>{danger === 'unpublish' ? '撤下這篇' : '刪除這篇'}</h2>
            <p>{danger === 'unpublish'
              ? '網站上的這一頁會在部署完成後消失，指向它的轉址也會一起移除。稿子留在後台，之後可以再發佈。'
              : live ? '先撤下網站上的這一頁，部署成功後才刪除稿子。這無法復原。' : '這篇從沒上線過，會直接刪除。這無法復原。'}</p>
            <div className="row">
              {/* 朱砂只留給「發佈」與「已上線」：危險動作用一般按鈕，靠文字說清楚 */}
              <button type="button" className="btn" onClick={() => void change(danger)}>{danger === 'unpublish' ? '撤下' : '刪除'}</button>
              <button type="button" className="btn btn--ghost" onClick={() => setDanger(null)}>取消</button>
            </div>
          </div>
        </>
      ) : null}
      {source ? (
        <>
          <div className="sheet-backdrop" onClick={() => setSource(null)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="原始碼">
            <h2>原始碼（MDX）</h2>
            <p className="hint">圖、影片、路線用 media:12、reel:3、route:9 這種參照，不要改成別的格式。改完按「套用」。</p>
            <textarea className="textarea mono" rows={16} spellCheck={false} aria-label="MDX 原始碼" value={source.text}
              onChange={(e) => setSource({ text: e.target.value, problems: [] })} />
            {source.problems.length ? (
              <div className="alert" role="alert"><strong>沒有套用：</strong>
                <ul className="list">{source.problems.map((p, i) => <li key={i}>{p.where}：{p.message}</li>)}</ul></div>
            ) : null}
            <div className="row"><button type="button" className="btn" onClick={() => void applySourceText()}>套用</button>
              <button type="button" className="btn btn--ghost" onClick={() => setSource(null)}>取消</button></div>
          </div>
        </>
      ) : null}
      {preview && tree ? (
        <>
          <div className="sheet-backdrop" onClick={() => setPreview(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="預覽">
            <h2>預覽</h2>
            {tree.ok ? (
              <article className="preview">
                <h1>{String(meta.title ?? '')}</h1>
                {tree.blocks.map((b, i) => {
                  const h = blockHtml(b);
                  return h !== null ? <div key={i} dangerouslySetInnerHTML={{ __html: h }} /> : <p key={i} className="chip">［{b.t}］</p>;
                })}
              </article>
            ) : <div className="alert" role="alert"><strong>這篇現在無法建置：</strong><br />{tree.message}</div>}
            <p className="hint">這是簡易預覽。真正的樣子以發佈後的網站為準。</p>
            <button type="button" className="btn" onClick={() => setPreview(false)}>關閉</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
