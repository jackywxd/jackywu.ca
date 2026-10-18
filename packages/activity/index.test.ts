/**
 * FIT → 軌跡點與活動數據。fixture 用 Garmin 官方 SDK 的 Encoder 在測試裡產生：
 * 不提交真實的 FIT 檔（帶著家門口的座標）。
 *
 * 防的失敗：
 *  · 座標沒從 semicircle 換成度 → 路線畫在非洲外海，距離是天文數字
 *  · 開始時間用了 UTC 而不是當地時間 → 溫哥華早上六點的跑步，網站上寫下午一點
 *  · 室內活動（沒有 GPS）建出一條空路線，或丟出看不懂的例外
 *  · 多項運動只算到第一段的時間
 */
import { describe, expect, it } from 'vitest';
import { Encoder, Profile, type ActivityMesg, type FileIdMesg, type Mesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { fromFit, isFit, isoDuration, toGpx } from './index';

const SEMI = 2 ** 31 / 180;
const T0 = new Date('2026-08-16T13:05:00Z'); // 溫哥華 06:05（-07:00）

interface Opts {
  type?: 'activity' | 'course';
  gps?: boolean;
  sessions?: { sport: string; timer: number; elapsed: number }[];
  offsetS?: number | null; // 當地時間 − UTC；null = 沒有 activity message
  n?: number;
}
/** 從 (49.25, -123.10) 往北走，每點約 111 m、每 10 秒一點、海拔每點 +5 m */
function fit({ type = 'activity', gps = true, sessions = [{ sport: 'running', timer: 3000, elapsed: 3300 }], offsetS = -7 * 3600, n = 11 }: Opts = {}) {
  const e = new Encoder();
  // 型別參數讓每一則訊息照 SDK 的型別檢查欄位名（onMesg 本身只收寬鬆的 Mesg）
  const put = <T extends Mesg>(n: number, m: T) => e.onMesg(n, m);
  put<FileIdMesg>(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: T0, type });
  for (let i = 0; i < n; i++) {
    put<RecordMesg>(Profile.MesgNum.RECORD, {
      timestamp: new Date(T0.getTime() + i * 10_000),
      ...(gps ? { positionLat: Math.round((49.25 + i * 0.001) * SEMI), positionLong: Math.round(-123.1 * SEMI) } : {}),
      enhancedAltitude: 100 + i * 5,
      distance: i * 111,
    });
  }
  let start = T0.getTime();
  for (const s of sessions) {
    put<SessionMesg>(Profile.MesgNum.SESSION, { timestamp: new Date(start + s.elapsed * 1000), startTime: new Date(start), sport: s.sport, totalTimerTime: s.timer, totalElapsedTime: s.elapsed });
    start += s.elapsed * 1000;
  }
  if (type === 'activity' && offsetS !== null) {
    const ts = (start - 631065600000) / 1000;
    put<ActivityMesg>(Profile.MesgNum.ACTIVITY, { timestamp: new Date(start), localTimestamp: ts + offsetS, numSessions: sessions.length, type: 'manual' });
  }
  return e.close();
}

describe('isFit', () => {
  it('看檔頭的 .FIT，不看副檔名', () => {
    expect(isFit(fit())).toBe(true);
    expect(isFit(new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>'))).toBe(false);
    expect(isFit(new Uint8Array(4))).toBe(false);
  });
});

describe('fromFit', () => {
  it('座標換成度、海拔、時間；移動時間與總時間來自 session', () => {
    const r = fromFit(fit());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('activity');
    expect(r.points).toHaveLength(11);
    expect(r.points[0]!.lat).toBeCloseTo(49.25, 5);
    expect(r.points[0]!.lon).toBeCloseTo(-123.1, 5);
    expect(r.points[10]!.ele).toBe(150);
    expect(r.points[1]!.t).toBe('2026-08-16T13:05:10.000Z');
    expect(r.movingS).toBe(3000);
    expect(r.elapsedS).toBe(3300);
    expect(r.sport).toBe('running');
  });

  it('開始時間是當地時間＋偏移（activity 的 local_timestamp − timestamp）', () => {
    const r = fromFit(fit());
    expect(r.ok && r.startedAt).toBe('2026-08-16T06:05-07:00');
    // 不是溫哥華：東京 +09:00
    const tokyo = fromFit(fit({ offsetS: 9 * 3600 }));
    expect(tokyo.ok && tokyo.startedAt).toBe('2026-08-16T22:05+09:00');
  });

  it('沒有 local_timestamp（有些手錶不寫 activity message）→ 用 UTC，並且標出來', () => {
    const r = fromFit(fit({ offsetS: null }));
    expect(r.ok && r.startedAt).toBe('2026-08-16T13:05+00:00');
    expect(r.ok && r.warnings.join()).toMatch(/時區/);
  });

  it('多項運動：時間是所有 session 的總和，sport 取第一段', () => {
    const r = fromFit(fit({ sessions: [{ sport: 'running', timer: 1000, elapsed: 1100 }, { sport: 'cycling', timer: 2000, elapsed: 2100 }] }));
    expect(r.ok && [r.movingS, r.elapsedS, r.sport]).toEqual([3000, 3200, 'running']);
  });

  it('course 檔（規劃路線）：有軌跡、沒有計時，是合法的路線', () => {
    const r = fromFit(fit({ type: 'course', sessions: [] }));
    expect(r.ok).toBe(true);
    expect(r.ok && [r.kind, r.movingS, r.elapsedS]).toEqual(['course', null, null]);
  });

  it('沒有 GPS（跑步機、室內）→ 明確的錯誤', () => {
    const r = fromFit(fit({ gps: false }));
    expect(r).toEqual({ ok: false, error: '這個 FIT 檔沒有 GPS 軌跡（室內或跑步機活動），沒辦法建立路線' });
  });

  it('不是 FIT、或截斷的檔案 → 明確的錯誤，不丟例外', () => {
    expect(fromFit(new TextEncoder().encode('hello'))).toEqual({ ok: false, error: '不是 FIT 檔' });
    const whole = fit();
    const cut = fromFit(whole.slice(0, Math.floor(whole.length / 2)));
    expect(cut.ok).toBe(false);
    expect(!cut.ok && cut.error).toMatch(/損壞|不完整/);
  });

  it('長度完整、但中間有一個 byte 壞掉（傳輸或儲存損壞）→ 校驗碼擋下，不建出錯的軌跡', () => {
    const bad = fit().slice();
    bad[60] = bad[60]! ^ 0xff;
    const r = fromFit(bad);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/損壞|不完整/);
  });
});

describe('toGpx', () => {
  it('帶時間（和上傳 GPX 一樣）', () => {
    const r = fromFit(fit());
    if (!r.ok) throw new Error(r.error);
    expect(toGpx(r.points)).toContain('<time>2026-08-16T13:05:00.000Z</time>');
  });
});

describe('isoDuration', () => {
  it('秒 → Routes 的時長格式（不帶多餘的 0 段）', () => {
    expect([isoDuration(9065), isoDuration(3600), isoDuration(125), isoDuration(0)]).toEqual(['PT2H31M5S', 'PT1H', 'PT2M5S', 'PT0S']);
  });
});
