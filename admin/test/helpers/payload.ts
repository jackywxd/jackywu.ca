import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Payload } from 'payload';

/**
 * 乾淨的基準：每個測試檔都在自己的暫存目錄裡起一份全新的 D1/R2（miniflare），
 * 從空庫套用「全部」migrations，結束後整個目錄刪掉。
 * 不讀、不寫開發用的 .wrangler 狀態，更不會碰線上資源。
 */
export async function bootPayload(env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hongchen-admin-test-'));
  const saved: Record<string, string | undefined> = {};
  const set = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };
  set('ADMIN_PERSIST_DIR', dir);
  set('PAYLOAD_SECRET', 'test-secret-test-secret-test-secret');
  set('ACCESS_ALLOWED_EMAILS', 'me@example.com');
  set('ADMIN_DEV_BYPASS_EMAIL', 'me@example.com');
  for (const [k, v] of Object.entries(env)) set(k, v);

  let payload: Payload | undefined;
  const rm = () => rmSync(dir, { recursive: true, force: true });
  // 最後一道保險：行程結束時（不論測試怎麼死的）再刪一次。miniflare 關閉時
  // 會在目錄被刪掉之後又把空的子目錄建回來，所以光刪一次不夠。
  process.once('exit', rm);
  // 無論開機失敗、測試失敗還是關閉時出錯，目錄都要刪掉
  async function close() {
    try {
      await payload?.destroy?.();
      await (globalThis as { __adminDispose?: () => Promise<void> }).__adminDispose?.();
    } finally {
      // 只刪這個測試自己建的目錄（路徑是 mkdtemp 回傳的，不是樣式比對）
      rm();
      // dispose 之後 workerd 還會晚幾秒把空的子目錄建回來（量到約 2–4 秒）。
      // 等它建回來、刪掉，再多等一下確認不再出現；最多等 6 秒。
      for (let waited = 0, quiet = 0; waited < 6000 && quiet < 600; waited += 100) {
        await new Promise((r) => setTimeout(r, 100));
        if (existsSync(dir)) { rm(); quiet = 0; } else if (waited > 0) quiet += 100;
        // 還沒出現過就不累計 quiet：先給 workerd 時間
        if (waited < 2000) quiet = 0;
      }
    }
  }
  try {
    const { getPayload } = await import('payload');
    const { default: config } = await import('@payload-config');
    payload = await getPayload({ config });
    // 與正式環境相同的來源：登記在 migrations/index.ts 的那一份陣列
    const { migrations } = await import('../../migrations');
    await payload.db.migrate({ migrations: migrations as never });
  } catch (e) {
    await close().catch(() => {});
    throw e;
  }
  return { payload: payload!, dir, close };
}

export const hdr = (host: string, extra: Record<string, string> = {}) =>
  new Headers({ host, ...extra });
