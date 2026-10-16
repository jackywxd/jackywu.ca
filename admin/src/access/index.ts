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

/**
 * 版本表裡是每一份草稿的全文。Payload 沒設 readVersions 時「任何登入者都能讀」，所以一定要明確給：
 * 只有本人。CI 要建置的內容由發佈請求的快照提供（/api/publish/snapshot），不需要讀版本表。
 */
export const readVersionsOwnerOnly: Access = ({ req }) => roleOf(req) === 'owner';

/** 非版本化的集合（媒體、redirects）：reader 可讀，匿名不行 */
export const readAnyAuthed: Access = ({ req }) => roleOf(req) !== null;

export const ownerOnlyField: FieldAccess = ({ req }) => roleOf(req) === 'owner';
