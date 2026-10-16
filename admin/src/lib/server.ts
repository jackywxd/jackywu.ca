import { headers } from 'next/headers';
import { getPayload } from 'payload';
import config from '@payload-config';

/** 伺服端頁面用：取得 payload 與目前登入者（Access 的身分）。沒有登入或不是本人 → user = null */
export async function ctx() {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await headers() });
  const owner = (user as { role?: string } | null)?.role === 'owner' ? user : null;
  return { payload, user: owner };
}
