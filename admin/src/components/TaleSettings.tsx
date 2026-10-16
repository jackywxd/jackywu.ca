'use client';
import { useEffect, useState } from 'react';
import { displayWidth, LIMITS, REALMS } from '@content-rules';
import { TALE_FORM_FIELDS, type FormField } from '../editor/tale-form';
import { MediaPicker } from '../editor/MediaPicker';
import { listReels, listRoutes, type Option } from '../lib/api-client';

export type Meta = Record<string, unknown> & { title: string };
export type FieldErrors = Record<string, string>;

const REALM_LABEL: Record<string, string> = { run: '追雲（跑）', snow: '逐雪（滑雪）', road: '鐵馬（摩托）', wild: '探幽（探險）', forge: '爐火（技術）', still: '靜（私人）' };

/** 設定抽屜：欄位由 TALE_FORM_FIELDS 產生。手機是底部抽屜，桌面同樣（一致、可測）。 */
export function TaleSettings({ meta, errors, onChange, onClose, onBusy }: {
  meta: Meta; errors: FieldErrors; onChange: (patch: Partial<Meta>) => void; onClose: () => void; onBusy?: (b: boolean) => void;
}) {
  const [reels, setReels] = useState<Option[]>([]);
  const [routes, setRoutes] = useState<Option[]>([]);
  const [picker, setPicker] = useState(false);
  useEffect(() => { listReels().then(setReels).catch(() => {}); listRoutes().then(setRoutes).catch(() => {}); }, []);

  const set = (name: string, v: unknown) => onChange({ [name]: v });
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
        return <select id={id} className="select" value={String(v ?? '')} aria-invalid={invalid} onChange={(e) => set(f.name, e.target.value)}>
          <option value="">請選擇</option>{REALMS.map((r) => <option key={r} value={r}>{REALM_LABEL[r]}</option>)}</select>;
      case 'select-lang':
        return <select id={id} className="select" value={String(v ?? 'zh-Hant')} onChange={(e) => set(f.name, e.target.value)}><option value="zh-Hant">繁體中文</option><option value="en">English</option></select>;
      case 'textarea-excerpt': {
        const w = displayWidth(String(v ?? ''));
        return <><textarea id={id} className="textarea" value={String(v ?? '')} aria-invalid={invalid} aria-describedby={`${id}-e`} onChange={(e) => set(f.name, e.target.value)} />
          <span className="hint" aria-live="polite">顯示寬度 {w}（{LIMITS.excerptMin}–{LIMITS.excerptMax}）</span></>;
      }
      case 'tags':
        return <input id={id} className="input" value={Array.isArray(v) ? (v as string[]).join('，') : ''} onChange={(e) => set(f.name, e.target.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean))} />;
      case 'checkbox':
        return <label className="row"><input id={id} type="checkbox" checked={f.name === 'shareable' ? v !== false : !!v} disabled={f.name === 'shareable' && meta.realm === 'still'}
          onChange={(e) => set(f.name, e.target.checked)} /> {f.label}</label>;
      case 'media':
        return <div className="row"><button type="button" className="btn" onClick={() => setPicker(true)}>{v ? '換一張' : '選擇封面圖'}</button>
          {v ? <button type="button" className="btn btn--ghost" onClick={() => set(f.name, null)}>移除</button> : null}</div>;
      case 'select-reel': case 'select-route': {
        const opts = f.kind === 'select-reel' ? reels : routes;
        return <select id={id} className="select" value={String(typeof v === 'object' && v ? (v as { id: unknown }).id : v ?? '')} onChange={(e) => set(f.name, e.target.value ? (opts.find((o) => String(o.id) === e.target.value)?.id ?? e.target.value) : null)}>
          <option value="">沒有</option>{opts.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}</select>;
      }
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="文章設定">
        <h2>文章設定</h2>
        {TALE_FORM_FIELDS.map((f) => (
          <div className="field" key={f.name}>
            {f.kind !== 'checkbox' ? <label htmlFor={`m-${f.name}`}>{f.label}</label> : null}
            {control(f)}
            {f.hint ? <span className="hint">{f.hint}</span> : null}
            <div id={`m-${f.name}-e`} className="field-error" role={err(f.name) ? 'alert' : undefined} hidden={!err(f.name)}>{err(f.name)}</div>
          </div>
        ))}
        <button type="button" className="btn" onClick={onClose}>完成</button>
      </div>
      {picker ? <MediaPicker onBusy={onBusy} onClose={() => setPicker(false)} onPick={([m]) => { set('hero', m!.id); if (!meta.heroAlt) set('heroAlt', m!.alt); setPicker(false); }} /> : null}
    </>
  );
}
