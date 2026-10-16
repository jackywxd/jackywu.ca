import type { Access, FieldAccess, PayloadRequest } from 'payload';
import { referencesOf, type CollectionName, type Snapshot } from '../../../packages/content-sync/request';

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

/**
 * 媒體：本人讀全部；CI 只讀建置需要的——已上線的文章、頁面、路線、影片引用的，加上正在建置的那一筆快照引用的。
 * 私有 bucket 裡有只出現在草稿裡的照片，CI 的憑證外洩時不能連它們一起外洩。
 */
export const readMediaOwnerOrNeeded: Access = async ({ req }) => {
  const r = roleOf(req);
  if (r === 'owner') return true;
  if (r !== 'reader') return false;
  const ids = new Set<string>();
  const add = (c: CollectionName, d: Record<string, unknown>) => { for (const m of referencesOf(c, d).media) ids.add(m); };
  for (const c of ['tales', 'pages', 'routes', 'reels'] as const) {
    const live = await req.payload.find({ collection: c, where: { _status: { equals: 'published' } }, limit: 0, pagination: false, depth: 0, overrideAccess: true, req });
    for (const d of live.docs) add(c, d as unknown as Record<string, unknown>);
  }
  const building = await req.payload.find({ collection: 'publish-requests', where: { status: { equals: 'dispatched' } }, limit: 0, pagination: false, depth: 0, overrideAccess: true, req });
  for (const b of building.docs) {
    const snap = (b as { snapshot?: Snapshot | null }).snapshot;
    if (!snap) continue;
    add(snap.doc.collection, snap.doc.data);
    for (const dep of snap.deps) add(dep.collection, dep.data);
  }
  return ids.size ? { id: { in: [...ids] } } : false;
};

/** 非版本化的集合（媒體、redirects）：reader 可讀，匿名不行 */
export const readAnyAuthed: Access = ({ req }) => roleOf(req) !== null;

export const ownerOnlyField: FieldAccess = ({ req }) => roleOf(req) === 'owner';
