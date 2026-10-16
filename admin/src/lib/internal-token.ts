/**
 * 容器 → 後台 的簽章網址。容器沒有任何雲端憑證，只拿到「這支影片、這個動作、這段時間內有效」的網址。
 * 簽章內容：<reel>.<scope>.<attempt>.<exp>。scope 分 src（讀原檔）、out（寫成品）、done（回報）、beat（心跳），
 * 偷到其中一個也不能拿來做另外幾件事，也不能動別支影片。
 * attempt 是第幾次嘗試：重試之後，上一次（可能還在跑的舊容器）的網址就不能回報或寫成品。
 */
const enc = new TextEncoder();
export type Scope = 'src' | 'out' | 'done' | 'beat';
export const TOKEN_TTL_SEC = 4 * 60 * 60; // 轉一支長影片可能要好幾個小時

async function mac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function signToken(secret: string, reel: string, scope: Scope, attempt: number, nowSec = Math.floor(Date.now() / 1000), ttl = TOKEN_TTL_SEC): Promise<{ exp: number; sig: string }> {
  if (!secret) throw new Error('VIDEO_INTERNAL_SECRET 沒有設定');
  const exp = nowSec + ttl;
  return { exp, sig: await mac(secret, `${reel}.${scope}.${attempt}.${exp}`) };
}

export async function verifyToken(secret: string, reel: string, scope: Scope, attempt: number, exp: string | null, sig: string | null, nowSec = Math.floor(Date.now() / 1000)): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: '伺服器沒有設定簽章金鑰' };
  if (!exp || !/^\d{1,12}$/.test(exp) || !sig || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: '簽章格式不對' };
  if (Number(exp) < nowSec) return { ok: false, reason: '網址已過期' };
  const want = await mac(secret, `${reel}.${scope}.${attempt}.${exp}`);
  let d = 0;
  for (let i = 0; i < 64; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0 ? { ok: true } : { ok: false, reason: '簽章不符' };
}
