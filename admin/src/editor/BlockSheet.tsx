'use client';
import { useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, COMMAND_PRIORITY_LOW } from 'lexical';
import { $isBlockNode, type BlockFields } from './nodes/BlockNode';
import { $insertBlockAtSelection, EDIT_BLOCK_COMMAND, INSERT_BLOCK_COMMAND } from './commands';
import { BLOCK_LABELS } from './BlockPreview';
import { MediaPicker } from './MediaPicker';
import { listReels, listRoutes, type Option } from '../lib/api-client';
import type { MediaItem } from '../lib/media-client';
import { RouteImporter } from '../components/RouteImporter';
import { useTale } from './tale-context';
import { markupMdx } from '../../../packages/content-sync/to-mdx';
import type { MarkupNode } from '../../../packages/content-sync/markup';

/** 區塊的編輯抽屜：點區塊或插入新區塊時打開。手機是底部抽屜，桌面同樣（簡單、一致）。 */
export function BlockSheet({ onBusy }: { onBusy?: (b: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const [key, setKey] = useState<string | null>(null);
  const [fields, setFields] = useState<BlockFields | null>(null);
  const [picker, setPicker] = useState<null | 'one' | 'many'>(null);
  const [reels, setReels] = useState<Option[]>([]);
  const [routes, setRoutes] = useState<Option[]>([]);
  const [newRoute, setNewRoute] = useState(false);
  const [alsoTale, setAlsoTale] = useState(true);
  const tale = useTale();

  useEffect(() => editor.registerCommand(EDIT_BLOCK_COMMAND, (k) => {
    editor.getEditorState().read(() => { const n = $getNodeByKey(k); if ($isBlockNode(n)) { setKey(k); setFields({ ...n.getFields() }); } });
    return true;
  }, COMMAND_PRIORITY_LOW), [editor]);

  useEffect(() => editor.registerCommand(INSERT_BLOCK_COMMAND, (f) => {
    // 命令處理器本身就在 update 裡，直接插入並拿到 key
    const k = $insertBlockAtSelection(f);
    if (f.blockType !== 'inkRule') { setKey(k); setFields({ ...f }); }
    return true;
  }, COMMAND_PRIORITY_LOW), [editor]);

  useEffect(() => {
    if (fields?.blockType === 'video') listReels().then(setReels).catch(() => setReels([]));
    if (fields?.blockType === 'route') listRoutes().then(setRoutes).catch(() => setRoutes([]));
  }, [fields?.blockType]);

  if (!key || !fields) return null;
  const set = (patch: Partial<BlockFields>) => setFields((f) => ({ ...(f as BlockFields), ...patch }));
  const close = () => { setKey(null); setFields(null); setPicker(null); setNewRoute(false); };
  const save = () => {
    editor.update(() => { const n = $getNodeByKey(key); if ($isBlockNode(n)) n.setFields(clean(fields)); });
    close();
  };
  const remove = () => { editor.update(() => { $getNodeByKey(key)?.remove(); }); close(); };
  const label = BLOCK_LABELS[fields.blockType] ?? fields.blockType;
  const f = fields as Record<string, unknown>;
  const items = (Array.isArray(f.items) ? f.items : []) as { media: number | string; alt?: string }[];

  return (
    <>
      <div className="sheet-backdrop" onClick={save} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`編輯${label}`}>
        <h2>{label}</h2>

        {fields.blockType === 'figure' ? (
          <>
            <div className="field"><label>圖片</label>
              <button type="button" className="btn" onClick={() => setPicker('one')}>{f.media ? '換一張' : '選擇圖片'}</button>
              {!f.media ? <div className="field-error">還沒選圖</div> : <span className="hint">已選（媒體 {String(f.media)}）</span>}</div>
            <Text label="圖說（可省略）" value={f.caption} onChange={(v) => set({ caption: v })} />
            <Text label="整張圖的連結（可省略，例如 YouTube）" value={f.href} onChange={(v) => set({ href: v })} />
            <label className="row"><input type="checkbox" checked={!!f.wide} onChange={(e) => set({ wide: e.target.checked })} /> 寬版（略為溢出正文欄）</label>
          </>
        ) : null}

        {fields.blockType === 'gallery' ? (
          <>
            <div className="field"><label>圖片（{items.length} 張）</label>
              <button type="button" className="btn" onClick={() => setPicker('many')}>加入圖片</button>
              {!items.length ? <div className="field-error">圖組是空的</div> : null}
              <ul className="list">{items.map((it, i) => (
                <li key={`${it.media}-${i}`} className="row"><span className="grow">媒體 {String(it.media)}</span>
                  <button type="button" className="btn btn--ghost" aria-label={`移除第 ${i + 1} 張`} onClick={() => set({ items: items.filter((_, j) => j !== i) })}>移除</button></li>
              ))}</ul></div>
            <Text label="圖說（可省略）" value={f.caption} onChange={(v) => set({ caption: v })} />
          </>
        ) : null}

        {fields.blockType === 'video' ? (
          <>
            <Select label="影片" value={f.reel} options={reels} onChange={(v) => set({ reel: v })} empty="還沒有影片（到「媒體」頁上傳）" />
            <Text label="圖說（可省略）" value={f.caption} onChange={(v) => set({ caption: v })} />
          </>
        ) : null}

        {fields.blockType === 'route' ? (
          <>
            <Select label="路線" value={f.route} options={routes} onChange={(v) => set({ route: v })} empty="還沒有路線" />
            {/* 寫到一半不必離開文章：在這裡上傳 GPX／FIT，建好就選上（發佈文章時一起上線） */}
            <div className="field">
              <button type="button" className="btn btn--ghost" aria-expanded={newRoute} onClick={() => setNewRoute((v) => !v)}>{newRoute ? '取消上傳' : '上傳 GPX／FIT 建新路線'}</button>
              {newRoute && tale.setTaleRoute && !tale.route ? (
                <label className="row"><input type="checkbox" checked={alsoTale} onChange={(e) => setAlsoTale(e.target.checked)} /> 也設為這篇文章的路線</label>
              ) : null}
            </div>
            {newRoute ? (
              <RouteImporter initial={{ date: tale.date ?? '', realm: tale.realm ?? '' }} onCreated={(r) => {
                setRoutes((rs) => [{ id: r.id, label: r.label }, ...rs.filter((x) => x.id !== r.id)]);
                set({ route: r.id });
                if (alsoTale && tale.setTaleRoute && !tale.route) tale.setTaleRoute(r.id);
                setNewRoute(false);
              }} />
            ) : null}
            <div className="field"><label htmlFor="route-show">顯示</label>
              <select id="route-show" className="select" value={String(f.show ?? 'profile')} onChange={(e) => set({ show: e.target.value })}>
                <option value="profile">爬升剖面</option><option value="track">平面軌跡</option><option value="both">兩者</option></select></div>
            <div className="row">
              <Num label="從（公里）" value={f.from} onChange={(v) => set({ from: v })} /><Num label="到（公里）" value={f.to} onChange={(v) => set({ to: v })} />
              <Num label="標記（公里）" value={f.at} onChange={(v) => set({ at: v })} /></div>
            <Text label="標記文字" value={f.label} onChange={(v) => set({ label: v })} />
            <Text label="圖說" value={f.caption} onChange={(v) => set({ caption: v })} />
          </>
        ) : null}

        {fields.blockType === 'missingImage' ? (
          <><Text label="原本的圖片網址" value={f.original} onChange={(v) => set({ original: v })} /><Text label="提示（可省略）" value={f.hint} onChange={(v) => set({ hint: v })} /></>
        ) : null}

        {fields.blockType === 'code' ? (
          <>
            <Text label="語言（bash、typescript、json…）" value={f.language} onChange={(v) => set({ language: v })} />
            <div className="field"><label htmlFor="code-body">程式碼</label>
              <textarea id="code-body" className="textarea mono" spellCheck={false} rows={10} value={String(f.code ?? '')} onChange={(e) => set({ code: e.target.value })} /></div>
          </>
        ) : null}

        {fields.blockType === 'html' ? (
          <div className="field"><p className="hint">自帶樣式的圖表或手寫的 SVG，網站照原樣顯示。這裡只能看；要改內容，請按操作列的「原始碼」。</p>
            <textarea className="textarea mono" readOnly rows={10} value={Array.isArray(f.nodes) ? markupMdx(f.nodes as MarkupNode[]) : ''} aria-label="內嵌 HTML 的原始碼" /></div>
        ) : null}

        {fields.blockType === 'rawMdx' ? (
          <div className="field"><div className="alert">這段是舊文章裡網站不支援的語法，原樣保留在這裡。要發佈，必須先改寫成其他區塊，或刪掉它。</div>
            <textarea className="textarea mono" readOnly rows={8} value={String(f.source ?? '')} aria-label="原始內容" /></div>
        ) : null}

        {fields.blockType === 'inkRule' ? <p className="hint">水墨分隔線，沒有可以設定的項目。</p> : null}

        <div className="row" style={{ marginBlockStart: 'var(--space-2)' }}>
          <button type="button" className="btn" onClick={save}>完成</button>
          <button type="button" className="btn btn--ghost" onClick={remove}>刪除這個區塊</button>
        </div>
      </div>

      {picker ? (
        <MediaPicker multiple={picker === 'many'} onBusy={onBusy} onClose={() => setPicker(null)}
          onPick={(ms: MediaItem[]) => {
            if (fields.blockType === 'figure') set({ media: ms[0]!.id });
            else set({ items: [...items, ...ms.map((m) => ({ media: m.id, alt: m.alt }))] });
            setPicker(null);
          }} />
      ) : null}
    </>
  );
}

/** 空字串的選填欄位不要寫進去：乾淨的 JSON，前台與測試都不用處理「空字串」 */
export function clean(f: BlockFields): BlockFields {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === '' || v === undefined || v === null) continue;
    if (v === false) continue;
    out[k] = v;
  }
  out.blockType = f.blockType;
  // 空的 original 仍然要保留（待補圖的必填欄位）
  if (f.blockType === 'missingImage') out.original = f.original ?? '';
  if (f.blockType === 'code') { out.language = f.language ?? ''; out.code = f.code ?? ''; }
  return out as BlockFields;
}

function Text({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string) => void }) {
  const id = `f-${label}`;
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /></div>;
}
function Num({ label, value, onChange }: { label: string; value: unknown; onChange: (v: number | undefined) => void }) {
  const id = `n-${label}`;
  return <div className="field grow"><label htmlFor={id}>{label}</label>
    <input id={id} className="input" inputMode="decimal" value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' || Number.isNaN(Number(e.target.value)) ? undefined : Number(e.target.value))} /></div>;
}
function Select({ label, value, options, onChange, empty }: { label: string; value: unknown; options: Option[]; onChange: (v: number | string) => void; empty: string }) {
  const id = `s-${label}`;
  return <div className="field"><label htmlFor={id}>{label}</label>
    {options.length === 0 ? <div className="hint">{empty}</div> : (
      <select id={id} className="select" value={String(value ?? '')} onChange={(e) => onChange(options.find((o) => String(o.id) === e.target.value)?.id ?? e.target.value)} aria-invalid={!value ? true : undefined}>
        <option value="">請選擇</option>{options.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}</select>)}
    {!value && options.length ? <div className="field-error">還沒選</div> : null}</div>;
}
