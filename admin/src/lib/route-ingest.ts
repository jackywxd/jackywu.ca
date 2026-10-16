import { TRADES, checkDate, checkSlug } from '@content-rules';
import { buildRoute } from '../../../packages/gpx/index';

export const MAX_GPX_BYTES = 20 * 1024 * 1024;

export interface RouteMeta { slug: string; name: string; realm: string; region: string; date: string; nameEn?: string; badge?: string; elapsed?: string; result?: string; note?: string }
export interface FieldIssue { field: string; message: string }

/** 表單欄位本身的檢查（不含 GPX）。沒附 GPX 時也要能一次列出所有欄位問題 */
export function validateMeta(meta: Partial<RouteMeta>): FieldIssue[] {
  const errors: FieldIssue[] = [];
  const need = (field: keyof RouteMeta, label: string) => { if (!meta[field]?.toString().trim()) errors.push({ field, message: `${label}必填` }); };
  need('name', '路線名稱'); need('region', '地區'); need('slug', '網址代稱'); need('date', '日期');
  if (meta.slug) { const m = checkSlug(meta.slug); if (m) errors.push({ field: 'slug', message: m }); }
  if (meta.date) { const m = checkDate(meta.date); if (m) errors.push({ field: 'date', message: m }); }
  if (!(TRADES as readonly string[]).includes(String(meta.realm))) errors.push({ field: 'realm', message: '行當必須是 跑、雪、鐵馬、探幽 其中之一' });
  if (meta.elapsed && !/^P/.test(meta.elapsed)) errors.push({ field: 'elapsed', message: '用時要是 ISO 8601 格式，例如 PT21H47M' });
  if (meta.note && meta.note.length > 200) errors.push({ field: 'note', message: '備註最多 200 字' });
  return errors;
}

/** GPX + 表單欄位 → routes 文件的資料。回傳欄位錯誤時不建任何東西。純函式。 */
export function prepareRoute(meta: Partial<RouteMeta>, gpxText: string):
  | { ok: true; data: Record<string, unknown>; stats: { distanceKm: number; gainM: number | null; points: number } }
  | { ok: false; errors: FieldIssue[] } {
  const errors = validateMeta(meta);
  if (gpxText.length > MAX_GPX_BYTES) errors.push({ field: 'gpx', message: 'GPX 檔案太大（上限 20 MB）' });

  let built: ReturnType<typeof buildRoute> | null = null;
  if (!errors.some((e) => e.field === 'gpx')) {
    try { built = buildRoute(gpxText); } catch (e) { errors.push({ field: 'gpx', message: (e as Error).message }); }
  }
  if (errors.length || !built) return { ok: false, errors };

  const opt = <T,>(v: T | undefined) => (v === undefined || v === '' ? null : v);
  return {
    ok: true,
    stats: { distanceKm: built.distanceKm, gainM: built.gainM, points: built.pointCount },
    data: {
      name: meta.name!.trim(), slug: meta.slug, nameEn: opt(meta.nameEn), realm: meta.realm, date: meta.date, region: meta.region!.trim(),
      distanceKm: built.distanceKm, gainM: built.gainM, elapsed: opt(meta.elapsed), result: opt(meta.result), badge: opt(meta.badge), note: opt(meta.note),
      downloadable: true, svgTrack: built.svg.track, svgThumb: built.svg.thumb, svgProfile: built.svg.profile,
    },
  };
}
