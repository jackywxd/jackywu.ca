import { describe, expect, it } from 'vitest';
import { onExpiry, MAX_RUN_MS } from '../transcoder/worker/lifecycle';

describe('容器閒置到期時要不要停（sleepAfter）', () => {
  // 先前直接停：/run 回 202 之後沒有任何請求進容器，10 分鐘一到 ffmpeg 就被殺掉，什麼都不會回報
  it('還在轉 → 不停', () => expect(onExpiry({ busy: true, since: 0 }, 60 * 60_000)).toBe('keep'));
  it('沒在轉 → 停', () => expect(onExpiry({ busy: false, since: null }, 1)).toBe('stop'));
  it('問不到狀態 → 停（不能因為壞掉而永遠燒錢）', () => expect(onExpiry(null, 1)).toBe('stop'));
  it('轉了超過上限 → 停（簽章網址也已經過期，繼續也寫不回去）', () => expect(onExpiry({ busy: true, since: 0 }, MAX_RUN_MS + 1)).toBe('stop'));
});
