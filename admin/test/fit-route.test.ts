/**
 * FIT（packages/activity）→ GPX → 現有的 buildRoute：兩個套件接得起來。
 * 防的失敗：FIT 轉出的 GPX 進路線管線之後距離、爬升、點數對不上。
 */
import { Encoder, Profile, type ActivityMesg, type FileIdMesg, type Mesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';
import { fromFit, toGpx } from '../../packages/activity/index';
import { buildRoute } from '../../packages/gpx/index';

const SEMI = 2 ** 31 / 180;
function fit() {
  const e = new Encoder();
  // 型別參數讓每一則訊息照 SDK 的型別檢查欄位名（onMesg 本身只收寬鬆的 Mesg）
  const put = <T extends Mesg>(n: number, m: T) => e.onMesg(n, m);
  const t0 = Date.parse('2026-08-16T13:05:00Z');
  put<FileIdMesg>(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: new Date(t0), type: 'activity' });
  for (let i = 0; i < 11; i++) {
    put<RecordMesg>(Profile.MesgNum.RECORD, { timestamp: new Date(t0 + i * 10_000), positionLat: Math.round((49.25 + i * 0.001) * SEMI), positionLong: Math.round(-123.1 * SEMI), enhancedAltitude: 100 + i * 5 });
  }
  return e.close();
}

describe('FIT → buildRoute', () => {
  it('距離、爬升、點數對得上', () => {
    const r = fromFit(fit());
    if (!r.ok) throw new Error(r.error);
    const b = buildRoute(toGpx(r.points));
    expect(b.pointCount).toBe(11);
    expect(b.distanceKm).toBeCloseTo(1.11, 1); // 10 段 × 0.001° 緯度 ≈ 1.112 km
    expect(b.gainM).toBe(50);
  });
});
