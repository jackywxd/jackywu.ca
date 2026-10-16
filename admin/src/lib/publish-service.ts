/**
 * 發佈服務：把狀態機（publish-queue.ts）接上 Payload 與 GitHub。
 * 判斷全部在狀態機裡；這裡只做「讀進來、轉移、寫回去、做副作用」。
 */
import type { Payload, Where } from 'payload';
import { validateTale } from '@content-rules';
import type { GitHub } from './github-app';
import { bindings } from './bindings';
import {
  applyResult, enqueue, markDispatched, nextToDispatch, watchdog,
  type Kind, type PublishRequest, type Result,
} from './publish-queue';

export interface Notice { kind: 'published' | 'failed' | 'watchdog' | 'dispatch-error' | 'revoke-aborted'; request?: PublishRequest; detail?: string }
export interface Deps {
  payload: Payload;
  github: GitHub;
  now: () => number;
  newId: () => string;
  notify: (n: Notice) => Promise<void>;
  /**
   * 線上的 content-manifest.json（requestId：哪一筆請求建出來的；promoted：那次 run 實際搬到公開端的 key）。
   * run 結束卻沒有回呼時，用它判斷是否其實已經上線。讀不到回 null。
   */
  liveManifest?: () => Promise<{ requestId?: string | null; promoted?: string[] } | null>;
}

const COLLECTIONS = ['tales', 'pages', 'routes', 'reels'] as const;
export type PublishCollection = (typeof COLLECTIONS)[number];
export const isPublishCollection = (c: string): c is PublishCollection => (COLLECTIONS as readonly string[]).includes(c);

/* ───────── 持久化 ───────── */

type Row = {
  id: number | string; requestId: string; kind: Kind; collectionSlug: string; docId: string; versionId: string;
  status: PublishRequest['status']; attempts: number; createdAtMs: number; dispatchedAtMs?: number | null;
  finishedAtMs?: number | null; failure?: PublishRequest['failure'] | null; late?: boolean | null;
};
const toReq = (r: Row): PublishRequest => ({
  id: r.requestId, kind: r.kind, collection: r.collectionSlug, docId: String(r.docId), versionId: String(r.versionId),
  status: r.status, attempts: r.attempts, createdAt: r.createdAtMs,
  ...(r.dispatchedAtMs != null ? { dispatchedAt: r.dispatchedAtMs } : {}),
  ...(r.finishedAtMs != null ? { finishedAt: r.finishedAtMs } : {}),
  ...(r.failure ? { failure: r.failure } : {}),
  ...(r.late ? { late: true } : {}),
});
const toRow = (r: PublishRequest) => ({
  requestId: r.id, kind: r.kind, collectionSlug: r.collection, docId: r.docId, versionId: r.versionId, status: r.status,
  attempts: r.attempts, createdAtMs: r.createdAt, dispatchedAtMs: r.dispatchedAt ?? null, finishedAtMs: r.finishedAt ?? null,
  failure: r.failure ?? null, late: r.late ?? false,
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

/**
 * 狀態轉移一律是 compare-and-set：只有在資料庫裡的那一列仍是「我讀到的狀態與嘗試次數」時才寫入。
 * 回呼、排程、兩個分頁可能同時處理同一筆；誰先寫入誰算，後到的拿到 false，不會用舊資料蓋掉。
 * 「最多一筆 dispatched」另由部分唯一索引保證（migrations/20261016_155309_publish_queue_cas.ts）。
 */
async function cas(from: Pick<PublishRequest, 'id' | 'status' | 'attempts'>, next: PublishRequest): Promise<boolean> {
  const D1 = bindings().D1;
  if (!D1) throw new Error('沒有 D1 綁定，無法更新發佈佇列');
  const r = toRow(next);
  try {
    const res = await D1.prepare(
      `UPDATE publish_requests SET status = ?, attempts = ?, dispatched_at_ms = ?, finished_at_ms = ?, failure = ?, late = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE request_id = ? AND status = ? AND attempts = ?`,
    ).bind(r.status, r.attempts, r.dispatchedAtMs, r.finishedAtMs, r.failure ? JSON.stringify(r.failure) : null, r.late ? 1 : 0, from.id, from.status, from.attempts).run();
    return res.meta.changes === 1;
  } catch (e) {
    // 另一筆已經是 dispatched（部分唯一索引）：這次沒搶到，不是錯誤
    if (/UNIQUE constraint failed/i.test(String((e as Error).message))) return false;
    throw e;
  }
}

/* ───────── 發佈請求 ───────── */

export type RequestOutcome =
  | { ok: true; requestId: string }
  | { ok: false; errors: { field: string; message: string }[] };

/**
 * 文章引用的影片、路線會跟著一起上線（依賴閉包）。它們的必填欄位要在「送出」時就檢查：
 * 等到部署完成、要把它們標成 published 才發現缺欄位，網站已經上線了，後台卻是半套狀態。
 */
export async function validateDependencies(payload: Payload, doc: Record<string, unknown>): Promise<{ field: string; message: string }[]> {
  const out: { field: string; message: string }[] = [];
  const idOf = (v: unknown) => (v && typeof v === 'object' ? String((v as { id: unknown }).id) : v == null ? null : String(v));
  const load = async (c: 'reels' | 'routes', id: string) => {
    try { return (await payload.findByID({ collection: c, id, draft: true, depth: 0, overrideAccess: true })) as unknown as Record<string, unknown>; } catch { return null; }
  };
  const need = (d: Record<string, unknown>, keys: [string, string][]) => keys.filter(([k]) => d[k] == null || d[k] === '').map(([, label]) => label);

  const reelId = idOf(doc.video);
  if (reelId) {
    const r = await load('reels', reelId);
    if (!r) out.push({ field: 'video', message: '選的影片已經不存在' });
    else if ((r.transcode as { status?: string } | null)?.status !== 'done') out.push({ field: 'video', message: `影片「${String(r.title)}」還沒轉碼完成，不能發佈` });
    else {
      const miss = need(r, [['realm', '行當'], ['date', '日期'], ['posterAlt', '封面替代文字'], ['poster', '封面'], ['duration', '時長'], ['bytes', '大小']]);
      if (miss.length) out.push({ field: 'video', message: `影片「${String(r.title)}」的資料不完整：${miss.join('、')}` });
    }
  }
  const routeId = idOf(doc.route);
  if (routeId) {
    const r = await load('routes', routeId);
    if (!r) out.push({ field: 'route', message: '選的路線已經不存在' });
    else {
      const miss = need(r, [['name', '名稱'], ['slug', '網址代稱'], ['realm', '行當'], ['date', '日期'], ['region', '地區'], ['distanceKm', '距離']]);
      if (miss.length) out.push({ field: 'route', message: `路線「${String(r.name)}」的資料不完整：${miss.join('、')}` });
    }
  }
  return out;
}

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
      const depErrors = await validateDependencies(payload, doc);
      if (depErrors.length) return { ok: false, errors: depErrors };
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
  const same = (r: PublishRequest) => r.collection === args.collection && r.docId === args.docId && r.versionId === versionId && r.kind === args.kind && (r.status === 'queued' || r.status === 'dispatched');
  let requestId = after.find(same)?.id ?? id;
  const fresh = after.find((r) => r.id === id);
  if (fresh) {
    try {
      await payload.create({ collection: 'publish-requests', data: toRow(fresh), overrideAccess: true });
    } catch (e) {
      // 另一個分頁剛好同時送出同一份（部分唯一索引擋下）：用它那一筆
      const other = (await loadActive(payload)).find(same);
      if (!other) throw e;
      requestId = other.id;
    }
  }
  await dispatchNext(deps);
  return { ok: true, requestId };
}

/* ───────── 送出下一筆 ───────── */

/**
 * 先在資料庫裡搶到這一筆（queued → dispatched），才去叫 GitHub：
 * 兩個同時的呼叫只有一個搶得到，另一個什麼都不做，所以同一筆不會被送兩次。
 * 送不出去就放回 queued（不算一次嘗試）；同一筆連續送不出去只通知一次。
 */
export async function dispatchNext(deps: Deps): Promise<PublishRequest | null> {
  const queue = await loadActive(deps.payload);
  const next = nextToDispatch(queue);
  if (!next) return null;
  const claimed: PublishRequest = { ...markDispatched(queue, next.id, deps.now()).find((r) => r.id === next.id)!, failure: undefined };
  if (!(await cas(next, claimed))) return null;
  try {
    await deps.github.dispatch({ requestId: next.id, kind: next.kind, collection: next.collection, docId: next.docId, versionId: next.versionId, attempt: claimed.attempts });
  } catch (e) {
    const detail = (e as Error).message;
    await cas(claimed, { ...next, failure: { check: 'dispatch-error', summary: detail.slice(0, 500) } });
    if (next.failure?.check !== 'dispatch-error') await deps.notify({ kind: 'dispatch-error', request: next, detail });
    return null;
  }
  return claimed;
}

/* ───────── 回呼 ───────── */

export interface CallbackBody { requestId: string; ok: boolean; check?: string; summary?: string; runUrl?: string; promoteKeys?: string[]; revoked?: string[]; revokeAborted?: string }

/** 這次 run 實際搬到公開端的 key：不論成敗都記下來，之後不再被引用時才撤得掉 */
async function recordPromoted(payload: Payload, requestId: string, keys: readonly string[]) {
  for (const key of keys) {
    const has = await payload.count({ collection: 'promoted', where: { key: { equals: key } }, overrideAccess: true });
    if (!has.totalDocs) await payload.create({ collection: 'promoted', data: { key, requestId }, overrideAccess: true });
  }
}

/**
 * 定案一筆請求。成功時先把內容標成 published（finalize 可重複執行），再以 compare-and-set 寫入狀態：
 * 這樣回呼重送、回呼與看門狗同時到，都只會有一個寫入成功，而且內容一定已經是 published。
 */
async function settle(deps: Deps, current: PublishRequest, result: Result, keys: { promoted?: readonly string[]; revoked?: readonly string[] } = {}, late = false) {
  const { payload } = deps;
  // 公開端的帳：不論成敗、不論這筆是否已定案，都照 run 的實際動作記（搬出去的記下，撤回的刪掉）
  await recordPromoted(payload, current.id, keys.promoted ?? []);
  for (const key of keys.revoked ?? []) {
    // 逐 key、精確比對
    const hit = await payload.find({ collection: 'promoted', where: { key: { equals: key } }, limit: 2, depth: 0, overrideAccess: true });
    for (const d of hit.docs) await payload.delete({ collection: 'promoted', id: d.id, overrideAccess: true });
  }
  const applied = applyResult([current], current.id, result, deps.now())[0]!;
  const done = late && applied.status === 'deployed' ? { ...applied, late: true } : applied;
  if (JSON.stringify(done) === JSON.stringify(current)) return { status: current.status, applied: false };
  if (done.status === 'deployed') await finalize(payload, done);
  if (!(await cas(current, done))) {
    // 別人先定案了：以資料庫為準
    return { status: (await loadOne(payload, current.id))?.status ?? current.status, applied: false };
  }
  await deps.notify({ kind: done.status === 'deployed' ? 'published' : 'failed', request: done });
  await dispatchNext(deps); // 一筆結束，換下一筆
  return { status: done.status, applied: true };
}

export class UnknownRequestError extends Error {}

export async function handleCallback(deps: Deps, body: CallbackBody): Promise<{ status: PublishRequest['status']; applied: boolean }> {
  const current = await loadOne(deps.payload, body.requestId);
  if (!current) throw new UnknownRequestError(`找不到請求 ${body.requestId}`);
  const result: Result = body.ok ? { ok: true } : { ok: false, check: body.check ?? 'unknown', summary: body.summary ?? '', runUrl: body.runUrl };
  const r = await settle(deps, current, result, { promoted: body.promoteKeys, revoked: body.revoked });
  if (body.revokeAborted) await deps.notify({ kind: 'revoke-aborted', request: current, detail: body.revokeAborted });
  return r;
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
    // 回呼重送時文件已經刪掉了：視為完成（finalize 必須可以重複執行）
    try { await payload.delete({ collection: col, id: r.docId, overrideAccess: true }); }
    catch (e) { if ((e as { status?: number }).status !== 404) throw e; }
  }
}

/* ───────── 看門狗 ───────── */

const COMPLETED = new Set(['success', 'failure', 'timed_out']);

/** 只由排程（cron Worker）呼叫；狀態頁只讀，不會每 4 秒觸發一次 */
export async function sweep(deps: Deps): Promise<{ changed: number }> {
  let changed = 0;
  for (const r of (await loadActive(deps.payload)).filter((x) => x.status === 'dispatched')) {
    let c: Awaited<ReturnType<GitHub['runConclusion']>>;
    // 查不到 GitHub（API 暫時壞掉）不是「找不到 run」：這一輪不判斷
    try { c = await deps.github.runConclusion(r.id, r.attempts); } catch { continue; }
    let live: Awaited<ReturnType<NonNullable<Deps['liveManifest']>>> = null;
    if (COMPLETED.has(c)) live = await deps.liveManifest?.().catch(() => null) ?? null;
    const next = watchdog([r], { [r.id]: c }, deps.now(), live?.requestId)[0]!;
    if (JSON.stringify(next) === JSON.stringify(r)) continue;
    if (next.status === 'deployed') {
      // run 沒能回呼，但線上就是這一筆：照成功處理（含它搬到公開端的 key）
      const res = await settle(deps, r, { ok: true }, { promoted: live?.promoted }, true);
      if (res.applied) changed++;
      continue;
    }
    if (!(await cas(r, next))) continue;
    changed++;
    if (next.status === 'failed') await deps.notify({ kind: 'watchdog', request: next, detail: next.failure?.summary });
  }
  await dispatchNext(deps); // 放行下一筆（或重送被取消的）
  return { changed };
}
