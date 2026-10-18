/**
 * 活動檔 → 軌跡點與活動數據。Garmin 與 COROS 都輸出同一種 FIT（Garmin FIT SDK 定義）。
 *
 * 可移植：只依賴 @garmin/fitsdk，不 import 這個 repo 的任何東西（verify-portable 會擋），
 * 之後可以原樣搬到 wildrunner。瀏覽器與 Node 都能跑；後台在瀏覽器裡解析，Worker 不必載入 SDK。
 */
import { Decoder, Stream } from '@garmin/fitsdk';
import { isFit } from './sniff';

export { isFit };

export interface Point { lat: number; lon: number; ele: number | null; t: string | null }

export type FitResult =
  | {
      ok: true;
      kind: 'activity' | 'course';
      points: Point[];
      /** 當地時間＋偏移，例如 2026-08-16T06:05-07:00；沒有時間（course）是 null */
      startedAt: string | null;
      movingS: number | null;
      elapsedS: number | null;
      sport: string | null;
      warnings: string[];
    }
  | { ok: false; error: string };

const DEG = 180 / 2 ** 31; // semicircle → 度
const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z


type Mesg = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (xs: (number | null)[]) => (xs.length && xs.every((x) => x != null) ? Math.round(xs.reduce((a, b) => a! + b!, 0)!) : null);
const pad = (n: number) => String(n).padStart(2, '0');

/** UTC 時刻＋偏移（秒）→「當地時間＋偏移」，精確到分 */
function localIso(utc: Date, offsetS: number): string {
  const d = new Date(utc.getTime() + offsetS * 1000);
  const sign = offsetS < 0 ? '-' : '+';
  const a = Math.abs(Math.round(offsetS / 60));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function fromFit(bytes: Uint8Array): FitResult {
  if (!isFit(bytes)) return { ok: false, error: '不是 FIT 檔' };
  let messages: Record<string, Mesg[] | undefined>;
  try {
    const decoder = new Decoder(Stream.fromByteArray(bytes));
    const r = decoder.read(); // read 本身會驗檔頭、長度與 CRC（decoder.js），不必另外 checkIntegrity 再讀一遍
    if (r.errors.length) return { ok: false, error: `FIT 檔已損壞：${String((r.errors[0] as Error)?.message ?? r.errors[0])}` };
    messages = r.messages as Record<string, Mesg[] | undefined>;
  } catch (e) {
    return { ok: false, error: `FIT 檔已損壞：${(e as Error).message}` };
  }

  const records = messages.recordMesgs ?? [];
  const points: Point[] = [];
  for (const m of records) {
    const lat = num(m.positionLat), lon = num(m.positionLong);
    if (lat == null || lon == null) continue; // 開始搜星前、隧道裡的點沒有座標
    const ele = num(m.enhancedAltitude) ?? num(m.altitude);
    const t = m.timestamp instanceof Date ? m.timestamp.toISOString() : null;
    points.push({ lat: lat * DEG, lon: lon * DEG, ele, t });
  }
  if (points.length < 2) return { ok: false, error: '這個 FIT 檔沒有 GPS 軌跡（室內或跑步機活動），沒辦法建立路線' };

  const fileType = String(messages.fileIdMesgs?.[0]?.type ?? 'activity');
  const kind = fileType === 'course' ? 'course' : 'activity';
  const sessions = messages.sessionMesgs ?? [];
  const warnings: string[] = [];

  let startedAt: string | null = null;
  const first = points.find((p) => p.t)?.t;
  if (kind === 'activity' && first) {
    const start = sessions[0]?.startTime instanceof Date ? (sessions[0].startTime as Date) : new Date(first);
    const act = messages.activityMesgs?.[0];
    const local = num(act?.localTimestamp);
    if (local != null && act?.timestamp instanceof Date) {
      const offsetS = local + FIT_EPOCH_S - act.timestamp.getTime() / 1000;
      startedAt = localIso(start, Math.round(offsetS / 900) * 900); // 時區偏移以 15 分鐘為單位
    } else {
      startedAt = localIso(start, 0);
      warnings.push('FIT 檔沒有記錄時區，開始時間以 UTC 表示，請自己改成當地時間');
    }
  }

  return {
    ok: true, kind, points, startedAt, warnings,
    movingS: kind === 'activity' ? sum(sessions.map((s) => num(s.totalTimerTime))) : null,
    elapsedS: kind === 'activity' ? sum(sessions.map((s) => num(s.totalElapsedTime))) : null,
    sport: sessions[0]?.sport != null ? String(sessions[0].sport) : null,
  };
}

/** 標準 GPX 1.1。帶時間，和直接上傳的 GPX 一樣。不寫名稱：路線名稱來自表單 */
export function toGpx(points: Point[]): string {
  const pts = points.map((p) =>
    `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}${p.t ? `<time>${p.t}</time>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hongchen" xmlns="http://www.topografix.com/GPX/1/1">
<trk><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
}

/** 秒 → ISO 8601 時長（和 Routes 的 elapsed 欄位同一格式），例如 PT2H31M5S */
export function isoDuration(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.round(s % 60);
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${r || (!h && !m) ? `${r}S` : ''}`;
}
