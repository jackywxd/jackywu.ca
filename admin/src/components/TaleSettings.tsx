'use client';
import { useEffect, useState } from 'react';
import { displayWidth, LIMITS, REALMS } from '@content-rules';
import { TALE_FORM_FIELDS, type FormField } from '../editor/tale-form';
import { MediaPicker } from '../editor/MediaPicker';
import { listReels, listRoutes, type Option } from '../lib/api-client';
import { useSheet } from './useSheet';
import { RouteImporter } from './RouteImporter';

export type Meta = Record<string, unknown> & { title: string };
export type FieldErrors = Record<string, string>;

const REALM_LABEL: Record<string, string> = { run: '追雲（跑）', snow: '逐雪（滑雪）', road: '鐵馬（摩托）', wild: '探幽（探險）', forge: '爐火（技術）', still: '靜（私人）' };

/** 設定抽屜：欄位由 TALE_FORM_FIELDS 產生。手機是底部抽屜，桌面同樣（一致、可測）。 */
const refOf = (v: unknown) => (v && typeof v === 'object' ? ((v as { id?: number | string }).id ?? null) : (v as number | string | null | undefined) ?? null);
const splitTags = (t: string) => t.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);

export function TaleSettings({ meta, errors, onChange, onClose, onBusy, danger }: {
  meta: Meta; errors: FieldErrors; onChange: (patch: Partial<Meta>) => void; onClose: () => void; onBusy?: (b: boolean) => void;
  /** 撤下與刪除。新文章（還沒存過）沒有 */
  danger?: { live: boolean; onUnpublish: () => void; onDelete: () => void };
}) {
  const sheet = useSheet<HTMLDivElement>(onClose);
  // 標籤欄位顯示的是使用者打的原文；存的是切開後的陣列。先前每打一個字就重新組回去，分隔符號一打就被吃掉
  const [tagsText, setTagsText] = useState(() => (Array.isArray(meta.tags) ? (meta.tags as string[]).join('，') : ''));
  const [reels, setReels] = useState<Option[]>([]);
  const [routes, setRoutes] = useState<Option[]>([]);
  const [picker, setPicker] = useState(false);
  const [newRoute, setNewRoute] = useState(false);
  useEffect(() => { listReels().then(setReels).catch(() => {}); listRoutes().then(setRoutes).catch(() => {}); }, []);

  const set = (name: string, v: unknown) => onChange({ [name]: v });
  /** 改用路線圖：清掉封面圖；替代文字沒填（或還是上一次自動產生的）就由路線資料產生，可以再改 */
  async function chooseRouteHero(id: number | string) {
    let alt = '路線圖';
    try {
      const r = await fetch(`/api/routes/${id}?depth=0&draft=true`, { cache: 'no-store' });
      if (r.ok) {
        const d = (await r.json()) as { name?: string; distanceKm?: number | null; gainM?: number | null };
        alt = ['路線圖：' + (d.name ?? ''), d.distanceKm ? `${d.distanceKm} km` : '', d.gainM ? `累計爬升 ${d.gainM} m` : ''].filter(Boolean).join('，');
      }
    } catch { /* 拿不到就用預設的替代文字，照樣可以改 */ }
    const keepAlt = meta.heroAlt && !String(meta.heroAlt).startsWith('路線圖');
    onChange({ heroRoute: true, hero: null, ...(keepAlt ? {} : { heroAlt: alt }) });
  }
  const err = (name: string) => errors[name];

  const control = (f: FormField) => {
    const id = `m-${f.name}`;
    const invalid = err(f.name) ? true : undefined;
    const v = meta[f.name];
    switch (f.kind) {
      case 'slug': case 'text-verse': case 'text-alt':
        return <input id={id} className="input" value={String(v ?? '')} aria-invalid={invalid} aria-describedby={`${id}-e`} autoCapitalize="none" onChange={(e) => set(f.name, e.target.value)} />;
      case 'date':
        return <input id={id} className="input" type="date" value={String(v ?? '')} aria-invalid={invalid} aria-describedby={`${id}-e`} onChange={(e) => set(f.name, e.target.value)} />;
      case 'select-realm':
        return <select id={id} className="select" value={String(v ?? '')} aria-invalid={invalid} aria-describedby={`${id}-e`} onChange={(e) => set(f.name, e.target.value)}>
          <option value="">請選擇</option>{REALMS.map((r) => <option key={r} value={r}>{REALM_LABEL[r]}</option>)}</select>;
      case 'select-lang':
        return <select id={id} className="select" value={String(v ?? 'zh-Hant')} onChange={(e) => set(f.name, e.target.value)}><option value="zh-Hant">繁體中文</option><option value="en">English</option></select>;
      case 'textarea-excerpt': {
        const w = displayWidth(String(v ?? ''));
        return <><textarea id={id} className="textarea" value={String(v ?? '')} aria-invalid={invalid} aria-describedby={`${id}-e`} onChange={(e) => set(f.name, e.target.value)} />
          <span className="hint" aria-live="polite">顯示寬度 {w}（{LIMITS.excerptMin}–{LIMITS.excerptMax}）</span></>;
      }
      case 'tags':
        return <input id={id} className="input" value={tagsText} onChange={(e) => { setTagsText(e.target.value); set(f.name, splitTags(e.target.value)); }} />;
      case 'checkbox':
        return <label className="row"><input id={id} type="checkbox" checked={f.name === 'shareable' ? v !== false : !!v} disabled={f.name === 'shareable' && meta.realm === 'still'}
          onChange={(e) => set(f.name, e.target.checked)} /> {f.label}</label>;
      case 'media': {
        // 封面二選一：一張圖，或文章路線的軌跡圖（前台內嵌向量圖，分享圖也用它）
        const routeId = refOf(meta.route);
        if (meta.heroRoute) {
          return <><div className="row"><span className="hint grow">用路線圖當封面</span>
            <button type="button" className="btn btn--ghost" onClick={() => onChange({ heroRoute: false })}>改用圖片</button></div>
            <div className="field-error" role={err('heroRoute') ? 'alert' : undefined} hidden={!err('heroRoute')}>{err('heroRoute')}</div></>;
        }
        return <><div className="row"><button type="button" className="btn" onClick={() => setPicker(true)}>{v ? '換一張' : '選擇封面圖'}</button>
          {v ? <button type="button" className="btn btn--ghost" onClick={() => set(f.name, null)}>移除</button> : null}
          <button type="button" className="btn btn--ghost" disabled={!routeId} aria-invalid={err('heroRoute') ? true : undefined}
            title={routeId ? undefined : '先在下面的「路線」選這篇文章的路線'} onClick={() => void chooseRouteHero(routeId!)}>用路線圖</button></div>
          {!routeId ? <span className="hint">要用路線圖當封面，先在下面的「路線」選這篇文章的路線。</span> : null}
          <div className="field-error" role={err('heroRoute') ? 'alert' : undefined} hidden={!err('heroRoute')}>{err('heroRoute')}</div></>;
      }
      case 'select-reel': case 'select-route': {
        const opts = f.kind === 'select-reel' ? reels : routes;
        const sel = <select id={id} className="select" value={String(typeof v === 'object' && v ? (v as { id: unknown }).id : v ?? '')} onChange={(e) => set(f.name, e.target.value ? (opts.find((o) => String(o.id) === e.target.value)?.id ?? e.target.value) : null)}>
          <option value="">沒有</option>{opts.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}</select>;
        if (f.kind === 'select-reel') return sel;
        // 路線可以就地上傳 GPX／FIT：建好就選上
        return <>{sel}
          <button type="button" className="btn btn--ghost" aria-expanded={newRoute} onClick={() => setNewRoute((x) => !x)}>{newRoute ? '取消上傳' : '上傳 GPX／FIT 建新路線'}</button>
          {newRoute ? <RouteImporter initial={{ date: String(meta.date ?? ''), realm: String(meta.realm ?? '') }} onCreated={(r) => {
            setRoutes((rs) => [{ id: r.id, label: r.label }, ...rs.filter((x) => x.id !== r.id)]);
            set(f.name, r.id); setNewRoute(false);
          }} /> : null}</>;
      }
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="文章設定" ref={sheet}>
        <h2>文章設定</h2>
        {TALE_FORM_FIELDS.map((f) => (
          <div className="field" key={f.name}>
            {/* 封面圖是按鈕不是輸入框：沒有可以對應的 id，用一般的標題 */}
            {f.kind === 'media' ? <span className="label">{f.label}</span> : f.kind !== 'checkbox' ? <label htmlFor={`m-${f.name}`}>{f.label}</label> : null}
            {control(f)}
            {f.hint ? <span className="hint">{f.hint}</span> : null}
            <div id={`m-${f.name}-e`} className="field-error" role={err(f.name) ? 'alert' : undefined} hidden={!err(f.name)}>{err(f.name)}</div>
          </div>
        ))}
        <button type="button" className="btn" onClick={onClose}>完成</button>
        {danger ? (
          <div className="field danger-zone">
            <span className="label">撤下與刪除</span>
            <div className="row">
              {danger.live ? <button type="button" className="btn btn--ghost" onClick={danger.onUnpublish}>撤下</button> : null}
              <button type="button" className="btn btn--ghost" onClick={danger.onDelete}>刪除</button>
            </div>
          </div>
        ) : null}
      </div>
      {picker ? <MediaPicker onBusy={onBusy} onClose={() => setPicker(false)} onPick={([m]) => { set('hero', m!.id); if (!meta.heroAlt) set('heroAlt', m!.alt); setPicker(false); }} /> : null}
    </>
  );
}
