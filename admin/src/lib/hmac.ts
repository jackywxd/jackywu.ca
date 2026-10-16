/**
 * 回呼簽章：x-signature: t=<unix 秒>,v1=<hex>，簽 `${t}.${body}`。
 * 時間窗 ±5 分鐘擋舊封包；重放同一個封包的後果由佇列的冪等性吸收（已定案的請求忽略後續結果）。
 */
const enc = new TextEncoder();
export const WINDOW_SEC = 300;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function mac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

export async function sign(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!secret) throw new Error('HMAC secret 沒有設定');
  return `t=${nowSec},v1=${await mac(secret, `${nowSec}.${body}`)}`;
}

export async function verify(
  secret: string, body: string, header: string | null, nowSec = Math.floor(Date.now() / 1000),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: '伺服器沒有設定 HMAC secret' };
  const m = header?.match(/^t=(\d{1,12}),v1=([0-9a-f]{64})$/);
  if (!m) return { ok: false, reason: '簽章格式不對' };
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > WINDOW_SEC) return { ok: false, reason: '簽章已過期' };
  const expected = await mac(secret, `${t}.${body}`);
  // 常數時間比較
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: '簽章不符' };
}
