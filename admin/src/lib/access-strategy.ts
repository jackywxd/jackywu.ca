import type { AuthStrategy } from 'payload';
import { AccessError, resolveIdentity, type AccessConfig } from './access-jwt';

export function accessConfigFromEnv(env: Record<string, string | undefined>): AccessConfig & { ciClientId?: string } {
  return {
    teamDomain: env.ACCESS_TEAM_DOMAIN ?? '',
    aud: env.ACCESS_AUD ?? '',
    allowedEmails: (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    devBypassEmail: env.ADMIN_DEV_BYPASS_EMAIL || undefined,
    ciClientId: env.ACCESS_CI_CLIENT_ID || undefined,
  };
}

/**
 * 服務憑證的角色。只有登記過的 CI client id 是 reader；其他服務憑證（轉碼容器、日後新增的）
 * 一律沒有角色：它們過得了 Access 的門，但在 Payload 裡是匿名。轉碼容器只走簽章網址，不需要讀任何集合。
 */
export function serviceRole(clientId: string, cfg: { ciClientId?: string }): 'reader' | null {
  return cfg.ciClientId && clientId === cfg.ciClientId ? 'reader' : null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF：Access 的 cookie 會跟著任何網站發出的請求一起送來，所以「有 JWT」不代表「是本人在後台按的」。
 * 寫入請求只接受同源：瀏覽器送的 Sec-Fetch-Site 必須是 same-origin（或 none：使用者自己的動作），
 * Origin（有的話）必須就是這台主機。jackywu.ca、staging.jackywu.ca 也算外來：它們與後台同站，SameSite 擋不住。
 * 伺服器對伺服器的呼叫（Actions 回呼、cron、轉碼容器）不帶這兩個 header，它們另有 HMAC／簽章網址。
 */
export function isCrossSiteWrite(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = headers.get('origin');
  if (origin) {
    let host: string | null = null;
    try { host = new URL(origin).host; } catch { /* 'null' 之類 */ }
    if (host !== headers.get('host')) return true;
  }
  return false;
}

// 只看 Host。x-forwarded-host 是用戶端自己能帶的 header，拿它判斷「是不是本機」等於讓任何人自稱 localhost
const hostnameOf = (headers: Headers) =>
  (headers.get('host') ?? '').split(':')[0]!.toLowerCase() || 'unknown';

/**
 * Payload 的自訂驗證：身分一律來自 Access JWT。
 * 驗證失敗回 user: null（Payload 會回 401）；設定事故（bypass 出現在非 localhost）直接 throw。
 */
export const accessStrategy: AuthStrategy = {
  name: 'cloudflare-access',
  authenticate: async ({ payload, headers, req }) => {
    if (req?.method && isCrossSiteWrite(req.method, headers)) return { user: null };
    const cfg = accessConfigFromEnv(process.env);
    let id;
    try {
      id = await resolveIdentity({ headers, hostname: hostnameOf(headers) }, cfg);
    } catch (e) {
      if (e instanceof AccessError) return { user: null };
      throw e;
    }

    const role = id.kind === 'user' ? 'owner' : serviceRole(id.clientId, cfg);
    if (!role) return { user: null };
    const email = id.kind === 'user' ? id.email : `${id.clientId}@service.invalid`;

    const found = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });
    const user =
      found.docs[0] ??
      (await payload.create({
        collection: 'users',
        data: { email, role },
        overrideAccess: true,
        disableVerificationEmail: true,
      }));
    // role 以 Access 的判定為準，不信資料庫裡可能被改過的值
    return { user: { ...user, role, collection: 'users', _strategy: 'cloudflare-access' } };
  },
};
