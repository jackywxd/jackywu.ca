import type { AuthStrategy } from 'payload';
import { AccessError, resolveIdentity, type AccessConfig } from './access-jwt';

export function accessConfigFromEnv(env: Record<string, string | undefined>): AccessConfig {
  return {
    teamDomain: env.ACCESS_TEAM_DOMAIN ?? '',
    aud: env.ACCESS_AUD ?? '',
    allowedEmails: (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    devBypassEmail: env.ADMIN_DEV_BYPASS_EMAIL || undefined,
  };
}

const hostnameOf = (headers: Headers) =>
  (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(':')[0]!.toLowerCase() || 'unknown';

/**
 * Payload 的自訂驗證：身分一律來自 Access JWT。
 * 驗證失敗回 user: null（Payload 會回 401）；設定事故（bypass 出現在非 localhost）直接 throw。
 */
export const accessStrategy: AuthStrategy = {
  name: 'cloudflare-access',
  authenticate: async ({ payload, headers }) => {
    const cfg = accessConfigFromEnv(process.env);
    let id;
    try {
      id = await resolveIdentity({ headers, hostname: hostnameOf(headers) }, cfg);
    } catch (e) {
      if (e instanceof AccessError) return { user: null };
      throw e;
    }

    const email = id.kind === 'user' ? id.email : `${id.clientId}@service.invalid`;
    const role = id.kind === 'user' ? 'owner' : 'reader';

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
