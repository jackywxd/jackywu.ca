import type { Access, FieldAccess, PayloadRequest } from 'payload';

export type Role = 'owner' | 'reader';
const roleOf = (req: PayloadRequest): Role | null =>
  ((req.user as { role?: Role } | null)?.role ?? null);

/** 本人：什麼都能做 */
export const isOwner: Access = ({ req }) => roleOf(req) === 'owner';

/** 本人讀全部；CI 的唯讀服務憑證只讀「已發佈」的內容 */
export const readPublishedOrOwner: Access = ({ req }) => {
  const r = roleOf(req);
  if (r === 'owner') return true;
  if (r === 'reader') return { _status: { equals: 'published' } };
  return false;
};

/** 非版本化的集合（媒體、redirects）：reader 可讀，匿名不行 */
export const readAnyAuthed: Access = ({ req }) => roleOf(req) !== null;

export const ownerOnlyField: FieldAccess = ({ req }) => roleOf(req) === 'owner';
