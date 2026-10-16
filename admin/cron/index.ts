/**
 * 排程 Worker：每 5 分鐘叫後台掃一次看門狗（發佈佇列、影片轉碼）。
 * 經由 service binding 呼叫後台，不走網路、不經過 Access；請求用 HMAC 簽章。
 * 密鑰是排程專用的 SWEEP_HMAC_SECRET，不是回呼的那一把：排程 Worker 只能叫看門狗，不能宣告「已上線」。
 * 後台掛掉或回錯誤只記 log 並重試一次，下一個 5 分鐘還會再來——不會因此停掉。
 */
interface Env { ADMIN: { fetch: (r: Request) => Promise<Response> }; SWEEP_HMAC_SECRET: string }

export const SWEEPS = ['/api/publish/sweep', '/api/video/sweep'] as const;

async function signature(secret: string, body: string, nowSec: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${nowSec}.${body}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `t=${nowSec},v1=${mac}`;
}

export async function runSweeps(env: Env, now = Date.now(), log: (m: string) => void = console.log): Promise<{ path: string; ok: boolean; status?: number }[]> {
  if (!env.SWEEP_HMAC_SECRET) throw new Error('SWEEP_HMAC_SECRET 沒有設定：排程無法簽章');
  const out: { path: string; ok: boolean; status?: number }[] = [];
  for (const path of SWEEPS) {
    let status: number | undefined, ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const sig = await signature(env.SWEEP_HMAC_SECRET, '', Math.floor(now / 1000));
        const r = await env.ADMIN.fetch(new Request(`https://admin.internal${path}`, { method: 'POST', body: '', headers: { 'x-signature': sig } }));
        status = r.status; ok = r.ok;
        if (!ok) log(JSON.stringify({ level: 'warn', msg: `sweep ${path} 回 ${r.status}`, attempt }));
      } catch (e) { log(JSON.stringify({ level: 'warn', msg: `sweep ${path} 失敗：${(e as Error).message}`, attempt })); }
    }
    out.push({ path, ok, status });
  }
  return out;
}

export default {
  async scheduled(_c: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runSweeps(env));
  },
};
