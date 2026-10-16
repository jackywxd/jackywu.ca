import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

/**
 * Cloudflare Access 身分驗證。
 *
 * Access 擋在最外面，但 Worker 不能只信「請求能到這裡」：
 * 任何繞過 Access 的路徑（workers.dev、路由設定錯誤）都會讓整個後台裸奔。
 * 所以這裡再驗一次 JWT 的簽章、aud、iss、exp。
 */
export interface AccessConfig {
  /** 例如 https://xxx.cloudflareaccess.com */
  teamDomain: string;
  /** Access application 的 AUD tag */
  aud: string;
  /** 允許的人類使用者 email（小寫）。 */
  allowedEmails: string[];
  /** 只給 localhost 開發用：直接當成這個 email。 */
  devBypassEmail?: string;
}

export type Identity =
  | { kind: 'user'; email: string }
  | { kind: 'service'; clientId: string };

export class AccessError extends Error {
  readonly status = 401;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const jwksCache = new Map<string, JWTVerifyGetKey>();
const remoteKeys = (teamDomain: string): JWTVerifyGetKey => {
  if (!/^https:\/\/[^/]+$/.test(teamDomain)) {
    throw new Error(`ACCESS_TEAM_DOMAIN 未設定或格式不對（需要 https://<team>.cloudflareaccess.com），目前是「${teamDomain}」`);
  }
  let k = jwksCache.get(teamDomain);
  if (!k) {
    k = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, k);
  }
  return k;
};

export async function resolveIdentity(
  req: { headers: Headers; hostname: string },
  cfg: AccessConfig,
  getKey?: JWTVerifyGetKey,
): Promise<Identity> {
  if (cfg.devBypassEmail) {
    // 在任何非本機主機上設了 bypass，就是設定事故：寧可整個掛掉，也不能放行。
    if (!LOCAL_HOSTS.has(req.hostname)) {
      throw new Error(
        `ADMIN_DEV_BYPASS_EMAIL 只能在 localhost 使用，目前主機是 ${req.hostname}。` +
          `請從這個環境的設定移除它。`,
      );
    }
    return { kind: 'user', email: cfg.devBypassEmail.toLowerCase() };
  }

  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token) throw new AccessError('缺少 Access JWT');
  const key = getKey ?? remoteKeys(cfg.teamDomain);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: cfg.teamDomain,
      audience: cfg.aud,
    }));
  } catch (e) {
    throw new AccessError(`Access JWT 無效：${(e as Error).message}`);
  }

  // 人類：有 email。服務憑證：沒有 email，只有 common_name（= client id）。
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (email) {
    if (!cfg.allowedEmails.map((e) => e.toLowerCase()).includes(email)) {
      throw new AccessError('這個帳號不在允許名單內');
    }
    return { kind: 'user', email };
  }
  const cn = payload.common_name;
  if (typeof cn === 'string' && cn) return { kind: 'service', clientId: cn };
  throw new AccessError('JWT 沒有可辨識的身分');
}
