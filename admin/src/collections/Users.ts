import type { CollectionConfig } from 'payload';
import { isOwner } from '../access';
import { accessStrategy } from '../lib/access-strategy';

/**
 * 只有兩種人：
 *  · owner：本人，由 Cloudflare Access 的 email 識別
 *  · reader：CI 用的 Access 服務憑證，只讀已發佈內容
 * 不開放密碼登入：身分的唯一來源是 Access。
 */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', hidden: true },
  auth: {
    disableLocalStrategy: { enableFields: true, optionalPassword: true },
    strategies: [accessStrategy],
  },
  access: {
    read: isOwner, create: () => false, update: isOwner, delete: () => false,
    admin: ({ req }) => (req.user as { role?: string } | null)?.role === 'owner',
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'owner',
      options: ['owner', 'reader'],
      saveToJWT: true,
    },
  ],
};
