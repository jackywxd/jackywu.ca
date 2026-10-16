/**
 * 發佈服務：把狀態機（publish-queue.ts）接上 Payload 與 GitHub。
 * 判斷全部在狀態機裡；這裡只做「讀進來、轉移、寫回去、做副作用」。
 */
import type { Payload, Where } from 'payload';
import { validateTale } from '@content-rules';
import type { GitHub } from './github-app';
import {
  applyResult, enqueue, markDispatched, nextToDispatch, watchdog,
  type Kind, type PublishRequest, type Result,
} from './publish-queue';

export interface Notice { kind: 'published' | 'failed' | 'watchdog' | 'dispatch-error'; request?: PublishRequest; detail?: string }
export interface Deps {
  payload: Payload;
  github: GitHub;
  now: () => number;
  newId: () => string;
  notify: (n: Notice) => Promise<void>;
}

const COLLECTIONS = ['tales', 'pages', 'routes', 'reels'] as const;
export type PublishCollection = (typeof COLLECTIONS)[number];
export const isPublishCollection = (c: string): c is PublishCollection => (COLLECTIONS as readonly string[]).includes(c);

/* ───────── 持久化 ───────── */

type Row = {
  id: number | string; requestId: string; kind: Kind; collectionSlug: string; docId: string; versionId: string;
  status: PublishRequest['status']; attempts: number; createdAtMs: number; dispatchedAtMs?: number | null;
  finishedAtMs?: number | null; failure?: PublishRequest['failure'] | null;
};
const toReq = (r: Row): PublishRequest => ({
  id: r.requestId, kind: r.kind, collection: r.collectionSlug, docId: String(r.docId), versionId: String(r.versionId),
  status: r.status, attempts: r.attempts, createdAt: r.createdAtMs,
  ...(r.dispatchedAtMs != null ? { dispatchedAt: r.dispatchedAtMs } : {}),
  ...(r.finishedAtMs != null ? { finishedAt: r.finishedAtMs } : {}),
  ...(r.failure ? { failure: r.failure } : {}),
});
const toRow = (r: PublishRequest) => ({
  requestId: r.id, kind: r.kind, collectionSlug: r.collection, docId: r.docId, versionId: r.versionId, status: r.status,
  attempts: r.attempts, createdAtMs: r.createdAt, dispatchedAtMs: r.dispatchedAt ?? null, finishedAtMs: r.finishedAt ?? null,
  failure: r.failure ?? null,
});

async function loadRows(payload: Payload, where: Where) {
  // 先來先送：依建立時間，同一毫秒的再依 id。Payload 預設是「新的在前」，不指定排序會把順序顛倒
  return (await payload.find({ collection: 'publish-requests', where, sort: ['createdAtMs', 'id'], limit: 500, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as Row[];
}
export async function loadActive(payload: Payload): Promise<PublishRequest[]> {
  return (await loadRows(payload, { status: { in: ['queued', 'dispatched'] } })).map(toReq);
}
export async function loadOne(payload: Payload, requestId: string): Promise<PublishRequest | null> {
  const r = (await loadRows(payload, { requestId: { equals: requestId } }))[0];
  return r ? toReq(r) : null;
}
export async function loadRecent(payload: Payload, limit = 20): Promise<PublishRequest[]> {
  const docs = (await payload.find({ collection: 'publish-requests', sort: '-createdAtMs', limit, depth: 0, overrideAccess: true })).docs as unknown as Row[];
  return docs.map(toReq);
}

/** 只寫有變的列；不存在就建立 */
async function persist(payload: Payload, before: readonly PublishRequest[], after: readonly PublishRequest[]) {
  for (const r of after) {
    const prev = before.find((b) => b.id === r.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(r)) continue;
    const existing = (await loadRows(payload, { requestId: { equals: r.id } }))[0];
    if (existing) await payload.update({ collection: 'publish-requests', id: existing.id, data: toRow(r), overrideAccess: true });
    else await payload.create({ collection: 'publish-requests', data: toRow(r), overrideAccess: true });
  }
}

/* ───────── 發佈請求 ───────── */

export type RequestOutcome =
  | { ok: true; requestId: string }
  | { ok: false; errors: { field: string; message: string }[] };

export async function requestChange(deps: Deps, args: { collection: string; docId: string; kind: Kind }): Promise<RequestOutcome> {
  const { payload } = deps;
  if (!isPublishCollection(args.collection)) return { ok: false, errors: [{ field: 'collection', message: `不支援的集合：${args.collection}` }] };

  let versionId = '';
  if (args.kind === 'publish') {
    const doc = (await payload.findByID({ collection: args.collection, id: args.docId, draft: true, depth: 0, overrideAccess: true })) as unknown as Record<string, unknown>;
    if (args.collection === 'tales') {
      const errors = validateTale({
        title: String(doc.title ?? ''), slug: String(doc.slug ?? ''), date: String(doc.date ?? ''), realm: String(doc.realm ?? ''),
        excerpt: String(doc.excerpt ?? ''), verse: (doc.verse as string | null) ?? null, shareable: (doc.shareable as boolean | null) ?? null,
        hero: doc.hero, heroAlt: (doc.heroAlt as string | null) ?? null,
      });
      if (errors.length) return { ok: false, errors };
    }
    const v = await payload.findVersions({ collection: args.collection, where: { parent: { equals: args.docId } }, sort: '-updatedAt', limit: 1, depth: 0, overrideAccess: true });
    if (!v.docs[0]) return { ok: false, errors: [{ field: 'version', message: '這篇還沒有存過任何版本，請先儲存' }] };
    versionId = String(v.docs[0].id);
  } else {
    versionId = 'none';
  }

  const before = await loadActive(payload);
  const id = deps.newId();
  const after = enqueue(before, { id, kind: args.kind, collection: args.collection, docId: args.docId, versionId }, deps.now());
  const existing = after.find((r) => r.collection === args.collection && r.docId === args.docId && r.versionId === versionId && r.kind === args.kind && (r.status === 'queued' || r.status === 'dispatched'));
  await persist(payload, before, after);
  await dispatchNext(deps);
  return { ok: true, requestId: existing?.id ?? id };
}

/* ───────── 送出下一筆 ───────── */

export async function dispatchNext(deps: Deps): Promise<PublishRequest | null> {
  const queue = await loadActive(deps.payload);
  const next = nextToDispatch(queue);
  if (!next) return null;
  try {
    await deps.github.dispatch({ requestId: next.id, kind: next.kind, collection: next.collection, docId: next.docId, versionId: next.versionId });
  } catch (e) {
    // 送不出去就維持 queued：下一次 sweep 會重試。不改狀態、不吞掉錯誤
    await deps.notify({ kind: 'dispatch-error', request: next, detail: (e as Error).message });
    return null;
  }
  const after = markDispatched(queue, next.id, deps.now());
  await persist(deps.payload, queue, after);
  return after.find((r) => r.id === next.id)!;
}

/* ───────── 回呼 ───────── */

export interface CallbackBody { requestId: string; ok: boolean; check?: string; summary?: string; runUrl?: string; promoteKeys?: string[]; revoked?: string[] }

export async function handleCallback(deps: Deps, body: CallbackBody): Promise<{ status: PublishRequest['status']; applied: boolean }> {
  const { payload } = deps;
  const current = await loadOne(payload, body.requestId);
  if (!current) throw new Error(`找不到請求 ${body.requestId}`);
  if (current.status === 'deployed' || current.status === 'failed') {
    // 冪等：已定案就原樣忽略，不重複發佈、不重複通知
    return { status: current.status, applied: false };
  }
  const result: Result = body.ok ? { ok: true } : { ok: false, check: body.check ?? 'unknown', summary: body.summary ?? '', runUrl: body.runUrl };
  const before = [current];
  const after = applyResult(before, current.id, result, deps.now());
  const done = after[0]!;

  if (body.ok) {
    // 部署成功之後才把內容標成 published（失敗時 Payload 的已上線狀態完全不動）
    await finalize(payload, done);
    for (const key of body.promoteKeys ?? []) {
      const has = await payload.count({ collection: 'promoted', where: { key: { equals: key } }, overrideAccess: true });
      if (!has.totalDocs) await payload.create({ collection: 'promoted', data: { key, requestId: done.id }, overrideAccess: true });
    }
    for (const key of body.revoked ?? []) {
      // 逐 key、精確比對
      const hit = await payload.find({ collection: 'promoted', where: { key: { equals: key } }, limit: 2, depth: 0, overrideAccess: true });
      for (const d of hit.docs) await payload.delete({ collection: 'promoted', id: d.id, overrideAccess: true });
    }
  }
  await persist(payload, before, after);
  await deps.notify({ kind: body.ok ? 'published' : 'failed', request: done });
  await dispatchNext(deps); // 一筆結束，換下一筆
  return { status: done.status, applied: true };
}

async function latestVersionId(payload: Payload, collection: PublishCollection, id: string) {
  const v = await payload.findVersions({ collection, where: { parent: { equals: id } }, sort: '-updatedAt', limit: 1, depth: 0, overrideAccess: true });
  return v.docs[0] ? String(v.docs[0].id) : null;
}

/**
 * 把「指定的那一個版本」發佈出去。
 * 不能用 restoreVersion：它會原樣保留版本當時的 _status（草稿版本還原後仍是草稿），
 * 所以改成讀出版本內容，連同 _status: published 寫回主文件。
 */
async function versionData(payload: Payload, collection: PublishCollection, versionId: string, status: 'published' | 'draft') {
  const v = await payload.findVersionByID({ collection, id: versionId, depth: 0, overrideAccess: true });
  const data: Record<string, unknown> = { ...(v.version as unknown as Record<string, unknown>), _status: status };
  for (const k of ['id', 'createdAt', 'updatedAt']) delete data[k];
  return data as never;
}

async function publishVersion(payload: Payload, collection: PublishCollection, docId: string, versionId: string) {
  // 送出之後使用者可能又改了：發佈會產生一個「更新」的已發佈版本，把那份較新的草稿壓到歷史裡，
  // 編輯畫面（永遠顯示最新版本）就看不到它了——等於默默弄丟一次編輯。所以發佈完把它重新蓋回最上面。
  const newer = await latestVersionId(payload, collection, docId);
  await payload.update({ collection, id: docId, data: await versionData(payload, collection, versionId, 'published'), draft: false, overrideAccess: true });
  if (newer && newer !== versionId) {
    await payload.update({ collection, id: docId, data: await versionData(payload, collection, newer, 'draft'), draft: true, overrideAccess: true });
  }
}

async function finalize(payload: Payload, r: PublishRequest) {
  const col = r.collection as PublishCollection;
  if (r.kind === 'publish') {
    await publishVersion(payload, col, r.docId, r.versionId);
    // 依賴閉包：這篇引用、剛跟著一起上線的路線／影片，也要標成 published
    if (col === 'tales') {
      const doc = (await payload.findByID({ collection: 'tales', id: r.docId, depth: 0, overrideAccess: true })) as unknown as { route?: unknown; video?: unknown };
      const idOf = (v: unknown) => (v && typeof v === 'object' ? String((v as { id: unknown }).id) : v == null ? null : String(v));
      for (const [c, ref] of [['routes', idOf(doc.route)], ['reels', idOf(doc.video)]] as const) {
        if (!ref) continue;
        const dep = (await payload.findByID({ collection: c, id: ref, draft: true, depth: 0, overrideAccess: true })) as unknown as { _status?: string };
        if (dep._status !== 'published') {
          const vid = await latestVersionId(payload, c, ref);
          if (vid) await publishVersion(payload, c, ref, vid);
        }
      }
    }
  } else if (r.kind === 'unpublish') {
    await payload.update({ collection: col, id: r.docId, data: { _status: 'draft' } as never, overrideAccess: true });
  } else {
    await payload.delete({ collection: col, id: r.docId, overrideAccess: true });
  }
}

/* ───────── 看門狗 ───────── */

export async function sweep(deps: Deps): Promise<{ changed: number }> {
  const queue = await loadActive(deps.payload);
  const runs: Record<string, Awaited<ReturnType<GitHub['runConclusion']>>> = {};
  for (const r of queue.filter((x) => x.status === 'dispatched')) {
    try { runs[r.id] = await deps.github.runConclusion(r.id); } catch { runs[r.id] = 'unknown'; }
  }
  const after = watchdog(queue, runs, deps.now());
  const changed = after.filter((r, i) => JSON.stringify(r) !== JSON.stringify(queue[i]));
  await persist(deps.payload, queue, after);
  for (const r of changed) if (r.status === 'failed') await deps.notify({ kind: 'watchdog', request: r, detail: r.failure?.summary });
  await dispatchNext(deps); // 放行下一筆（或重送被取消的）
  return { changed: changed.length };
}
