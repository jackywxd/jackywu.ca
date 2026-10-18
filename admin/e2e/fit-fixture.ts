/**
 * E2E 用的 FIT 檔：用 Garmin 官方 SDK 的 Encoder 當場產生（不提交真實的 FIT，那會帶著家門口的座標）。
 * 從 (49.25, -123.10) 往北走，每點約 111 m、每 10 秒一點、海拔每點 +5 m。
 */
import { Encoder, Profile, type ActivityMesg, type FileIdMesg, type Mesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';

const SEMI = 2 ** 31 / 180;
const FIT_EPOCH_MS = 631065600000;

export function makeFit({ n = 40, gps = true, start = '2026-08-16T13:05:00Z', offsetS = -7 * 3600, movingS = 3000, elapsedS = 3300 } = {}): Buffer {
  const e = new Encoder();
  const put = <T extends Mesg>(num: number, m: T) => e.onMesg(num, m);
  const t0 = Date.parse(start);
  put<FileIdMesg>(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: new Date(t0), type: 'activity' });
  for (let i = 0; i < n; i++) {
    put<RecordMesg>(Profile.MesgNum.RECORD, {
      timestamp: new Date(t0 + i * 10_000),
      ...(gps ? { positionLat: Math.round((49.25 + i * 0.001) * SEMI), positionLong: Math.round(-123.1 * SEMI) } : {}),
      enhancedAltitude: 100 + i * 5,
    });
  }
  const end = t0 + elapsedS * 1000;
  put<SessionMesg>(Profile.MesgNum.SESSION, { timestamp: new Date(end), startTime: new Date(t0), sport: 'running', totalTimerTime: movingS, totalElapsedTime: elapsedS });
  put<ActivityMesg>(Profile.MesgNum.ACTIVITY, { timestamp: new Date(end), localTimestamp: (end - FIT_EPOCH_MS) / 1000 + offsetS, numSessions: 1, type: 'manual' });
  return Buffer.from(e.close());
}
