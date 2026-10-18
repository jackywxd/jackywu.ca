/** 顯示層格式化。數字一律走 tabular-nums，配速距離爬升才會對齊。 */

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/** 2026-08-22 → 「八月廿二日」 */
const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cnDay(d: number): string {
  if (d <= 10) return d === 10 ? '十' : CN_NUM[d]!;
  if (d < 20) return `十${CN_NUM[d - 10]!}`;
  if (d === 20) return '廿';
  if (d < 30) return `廿${CN_NUM[d - 20]!}`;
  if (d === 30) return '卅';
  return `卅${CN_NUM[d - 30]!}`;
}

export const monthDay = (d: Date) => `${MONTHS[d.getUTCMonth()]}月${cnDay(d.getUTCDate())}日`;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const year = (d: Date) => d.getUTCFullYear();

/** 天干地支。2026 = 丙午 */
const STEM = '甲乙丙丁戊己庚辛壬癸';
const BRANCH = '子丑寅卯辰巳午未申酉戌亥';
export const ganzhi = (y: number) => `${STEM[(y - 4) % 10]}${BRANCH[(y - 4) % 12]}`;

/** PT21H47M → 「21:47」；PT58M30S → 「58:30」 */
export function duration(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  const [, d, h, mi, s] = m;
  const hours = (Number(d ?? 0) * 24) + Number(h ?? 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(Number(mi ?? 0))}` : `${Number(mi ?? 0)}:${pad(Number(s ?? 0))}`;
}

/** ISO 8601 時長 → 秒；不是合法格式回 undefined */
export function seconds(iso: string | undefined): number | undefined {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0);
}

/**
 * 配速：跑步與探險（走路的速度）用每公里幾分鐘，滑雪與摩托用時速。
 * 用移動時間（不含停下來的時間）；沒有的話用總時間。距離或時間缺一個就不顯示。
 */
export function pace(distanceKm: number | undefined, movingTime: string | undefined, elapsed: string | undefined, realm: string): string | undefined {
  const t = seconds(movingTime) ?? seconds(elapsed);
  if (!distanceKm || !t) return undefined;
  if (realm === 'snow' || realm === 'road') return `${(distanceKm / (t / 3600)).toFixed(1)} km/h`;
  const perKm = Math.round(t / distanceKm);
  return `${Math.floor(perKm / 60)}:${String(perKm % 60).padStart(2, '0')} /km`;
}

/** 2026-08-16T06:05-07:00 → 「06:05」：當地時間，原樣顯示，不換成讀者的時區 */
export const clock = (startedAt: string | undefined) => startedAt?.slice(11, 16);

export const km = (n: number | undefined) => (n == null ? undefined : `${n % 1 === 0 ? n : n.toFixed(1)} km`);
export const vert = (n: number | undefined) => (n == null ? undefined : `${n.toLocaleString('en-US')} m↑`);
export const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`;
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
