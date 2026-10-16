/**
 * 發佈服務：把狀態機（publish-queue.ts）接上 Payload 與 GitHub。
 * 判斷全部在狀態機裡；這裡只做「讀進來、轉移、寫回去、做副作用」。
 */
import type { Payload, Where } from 'payload';
import { validateTale } from '@content-rules';
import { referencesOf, type Snapshot } from '../../../packages/content-sync/request';
import { taleUrl } from '../../../packages/content-sync/redirects';
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

type FieldError = { field: string; message: string };
type AnyDoc = Record<string, unknown> & { id: number | string };

/** 已上線＝主表那一列是 published（草稿存檔只寫版本表，不動主表） */
async function isLive(payload: Payload, collection: PublishCollection, id: string | number): Promise<boolean> {
  const r = await payload.find({ collection, where: { and: [{ id: { equals: id } }, { _status: { equals: 'published' } }] }, limit: 1, depth: 0, overrideAccess: true });
  return r.totalDocs > 0;
}

async function latestVersion(payload: Payload, collection: PublishCollection, id: string | number) {
  const v = await payload.findVersions({ collection, where: { parent: { equals: id } }, sort: '-updatedAt', limit: 1, depth: 0, overrideAccess: true });
  const d = v.docs[0];
  return d ? { versionId: String(d.id), data: { ...(d.version as unknown as Record<string, unknown>), id } as AnyDoc, updatedAt: String(d.updatedAt) } : null;
}

/** 依賴自己的必填欄位（它們會跟著這篇一起上線，所以送出時就要齊） */
function depProblems(collection: 'routes' | 'reels', d: Record<string, unknown>): string | null {
  const need = (keys: [string, string][]) => keys.filter(([k]) => d[k] == null || d[k] === '').map(([, label]) => label);
  if (collection === 'reels') {
    if ((d.transcode as { status?: string } | null)?.status !== 'done') return `影片「${String(d.title)}」還沒轉碼完成，不能發佈`;
    const miss = need([['realm', '行當'], ['date', '日期'], ['posterAlt', '封面替代文字'], ['poster', '封面'], ['duration', '時長'], ['bytes', '大小']]);
    return miss.length ? `影片「${String(d.title)}」的資料不完整：${miss.join('、')}` : null;
  }
  const miss = need([['name', '名稱'], ['slug', '網址代稱'], ['realm', '行當'], ['date', '日期'], ['region', '地區'], ['distanceKm', '距離']]);
  return miss.length ? `路線「${String(d.name)}」的資料不完整：${miss.join('、')}` : null;
}

const SNAPSHOT_MAX = 1_500_000; // D1 單列上限約 2MB

/**
 * 送出發佈那一刻的快照。依賴（frontmatter 與正文區塊引用的路線、影片）只收「還沒上線」的，
 * 而且送出時就檢查；已上線的依賴維持已上線的版本——它們的新草稿不會被順手發佈出去。
 */
export async function buildSnapshot(payload: Payload, collection: PublishCollection, docId: string): Promise<{ ok: true; snapshot: Snapshot } | { ok: false; errors: FieldError[] }> {
  const takenAt = new Date().toISOString();
  const v = await latestVersion(payload, collection, docId);
  if (!v) return { ok: false, errors: [{ field: 'version', message: '這篇還沒有存過任何版本，請先儲存' }] };
  const errors: FieldError[] = [];
  const deps: Snapshot['deps'] = [];
  const refs = referencesOf(collection, v.data);
  // 錯誤指向哪個欄位：frontmatter 的 route／video，否則是正文裡的區塊
  const fieldOf = (c: 'routes' | 'reels', id: string) => {
    const f = c === 'routes' ? 'route' : 'video';
    return refIdOf((v.data as Record<string, unknown>)[f]) === id ? f : 'content';
  };
  for (const c of ['routes', 'reels'] as const) {
    for (const id of refs[c]) {
      if (await isLive(payload, c, id)) continue;
      const dv = await latestVersion(payload, c, id);
      if (!dv) { errors.push({ field: fieldOf(c, id), message: `引用的${c === 'routes' ? '路線' : '影片'}（${id}）已經不存在` }); continue; }
      const problem = depProblems(c, dv.data);
      if (problem) errors.push({ field: fieldOf(c, id), message: problem });
      else deps.push({ collection: c, id, versionId: dv.versionId, data: dv.data });
    }
  }
  if (errors.length) return { ok: false, errors };
  const snapshot: Snapshot = { doc: { collection, id: docId, versionId: v.versionId, data: v.data }, deps, takenAt };
  if (JSON.stringify(snapshot).length > SNAPSHOT_MAX) return { ok: false, errors: [{ field: 'content', message: '這篇太長了（超過 1.5MB），請拆成兩篇' }] };
  return { ok: true, snapshot };
}
const refIdOf = (v: unknown) => (v && typeof v === 'object' ? String((v as { id: unknown }).id) : v == null ? null : String(v));

/** 已上線的文章裡，還有哪幾篇引用這個路線／影片（撤下它之前要先處理） */
async function liveUsers(payload: Payload, collection: 'routes' | 'reels', id: string): Promise<string[]> {
  const tales = await payload.find({ collection: 'tales', where: { _status: { equals: 'published' } }, limit: 0, pagination: false, depth: 0, overrideAccess: true });
  return tales.docs.filter((t) => referencesOf('tales', t as unknown as AnyDoc)[collection].has(id)).map((t) => `〈${String(t.title)}〉`);
}

/** deleted：從沒上線過的草稿直接刪掉了，沒有請求（requestId 是空字串） */
export type RequestOutcome =
  | { ok: true; requestId: string; deleted?: boolean }
  | { ok: false; errors: FieldError[] };

export async function requestChange(deps: Deps, args: { collection: string; docId: string; kind: Kind }): Promise<RequestOutcome> {
  const { payload } = deps;
  if (!isPublishCollection(args.collection)) return { ok: false, errors: [{ field: 'collection', message: `不支援的集合：${args.collection}` }] };
  const collection = args.collection;
  // 前台的頁面（掌櫃、凡例）仍從 git 的 MDX 建置（凡例頁是 MDX 元件的活範例）。後台發佈頁面不會有任何效果，所以直接說
  if (collection === 'pages') return { ok: false, errors: [{ field: 'collection', message: '頁面目前由 git 管理（src/content/pages），後台的修改不會上線。請在 git 裡改' }] };

  let versionId = 'none';
  let snapshot: Snapshot | null = null;
  if (args.kind === 'publish') {
    const doc = (await payload.findByID({ collection, id: args.docId, draft: true, depth: 0, overrideAccess: true })) as unknown as Record<string, unknown>;
    if (collection === 'tales') {
      const errors = validateTale({
        title: String(doc.title ?? ''), slug: String(doc.slug ?? ''), date: String(doc.date ?? ''), realm: String(doc.realm ?? ''),
        excerpt: String(doc.excerpt ?? ''), verse: (doc.verse as string | null) ?? null, shareable: (doc.shareable as boolean | null) ?? null,
        hero: doc.hero, heroAlt: (doc.heroAlt as string | null) ?? null,
      });
      if (errors.length) return { ok: false, errors };
    }
    const snap = await buildSnapshot(payload, collection, args.docId);
    if (!snap.ok) return snap;
    snapshot = snap.snapshot;
    versionId = snap.snapshot.doc.versionId;
  } else {
    const live = await isLive(payload, collection, args.docId);
    if (!live) {
      // 從沒上線過：網站上本來就沒有它，不需要建置
      if (args.kind === 'delete') {
        await payload.delete({ collection, id: args.docId, overrideAccess: true });
        return { ok: true, requestId: '', deleted: true };
      }
      return { ok: false, errors: [{ field: 'status', message: '這篇本來就沒有上線，不需要撤下' }] };
    }
    if (collection === 'routes' || collection === 'reels') {
      const users = await liveUsers(payload, collection, args.docId);
      if (users.length) return { ok: false, errors: [{ field: 'status', message: `還有已上線的文章引用它：${users.join('、')}。先改那幾篇或把它們撤下` }] };
    }
  }

  const before = await loadActive(payload);
  const id = deps.newId();
  const after = enqueue(before, { id, kind: args.kind, collection, docId: args.docId, versionId }, deps.now());
  const same = (r: PublishRequest) => r.collection === collection && r.docId === args.docId && r.versionId === versionId && r.kind === args.kind && (r.status === 'queued' || r.status === 'dispatched');
  let requestId = after.find(same)?.id ?? id;
  const fresh = after.find((r) => r.id === id);
  if (fresh) {
    try {
      await payload.create({ collection: 'publish-requests', data: { ...toRow(fresh), snapshot: snapshot as unknown as Record<string, unknown> | null }, overrideAccess: true });
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

/** CI 建置用：只在這一筆正在建置（dispatched）時給 */
export async function loadSnapshot(payload: Payload, requestId: string, opts: { onlyDispatched?: boolean } = {}): Promise<Snapshot | null> {
  const r = (await payload.find({ collection: 'publish-requests', where: { requestId: { equals: requestId } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as (Row & { snapshot?: Snapshot | null }) | undefined;
  if (!r || (opts.onlyDispatched && r.status !== 'dispatched')) return null;
  return r.snapshot ?? null;
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

const strip = (d: Record<string, unknown>) => { const x = { ...d }; for (const k of ['id', 'createdAt', 'updatedAt']) delete x[k]; return x; };

/** 某個時間之後存的最新草稿（送出之後、或撤下之前的編輯）。發佈／撤下會在版本表最上面放一個新版本，要把它蓋回去 */
async function draftSince(payload: Payload, collection: PublishCollection, id: string | number, since: string) {
  const v = await payload.findVersions({
    collection, sort: '-updatedAt', limit: 1, depth: 0, overrideAccess: true,
    where: { and: [{ parent: { equals: id } }, { 'version._status': { equals: 'draft' } }, { updatedAt: { greater_than: since } }] },
  });
  return v.docs[0] ? (v.docs[0].version as unknown as Record<string, unknown>) : null;
}

/**
 * 把快照裡的內容寫成 published。不讀版本表：綁定的版本可能已被版本數上限清掉。
 * 寫完之後，拍快照之後存的草稿要重新蓋回最上面——編輯畫面永遠顯示最新版本，否則等於默默弄丟一次編輯。
 * 「之後」用時間判斷，所以發佈期間才存進來的草稿也算得到（不是發佈前先讀一次）。
 */
async function publishData(payload: Payload, collection: PublishCollection, id: string | number, data: Record<string, unknown>, takenAt: string) {
  await payload.update({ collection, id, data: { ...strip(data), _status: 'published' } as never, draft: false, overrideAccess: true });
  const newer = await draftSince(payload, collection, id, takenAt);
  if (newer) await payload.update({ collection, id, data: { ...strip(newer), _status: 'draft' } as never, draft: true, overrideAccess: true });
}

/** 撤下或刪除文章：指向它的轉址一起移除，否則轉址指向不存在的頁面，下一次建置過不了 verify-links */
async function dropRedirectsTo(payload: Payload, url: string) {
  const hit = await payload.find({ collection: 'redirects', where: { to: { equals: url } }, limit: 0, pagination: false, depth: 0, overrideAccess: true });
  for (const d of hit.docs) await payload.delete({ collection: 'redirects', id: d.id, overrideAccess: true });
}

/** 部署成功之後才動 Payload。必須可以重複執行（回呼重送、看門狗與回呼同時到） */
async function finalize(payload: Payload, r: PublishRequest) {
  const col = r.collection as PublishCollection;
  if (r.kind === 'publish') {
    const snap = await loadSnapshot(payload, r.id);
    if (!snap) throw new Error(`請求 ${r.id} 沒有快照，無法定案`);
    await publishData(payload, col, r.docId, snap.doc.data, snap.takenAt);
    for (const d of snap.deps) await publishData(payload, d.collection, d.id, d.data, snap.takenAt);
    return;
  }
  const current = await payload.findByID({ collection: col, id: r.docId, depth: 0, overrideAccess: true }).catch((e: { status?: number }) => { if (e.status === 404) return null; throw e; }) as unknown as Record<string, unknown> | null;
  if (col === 'tales' && current) await dropRedirectsTo(payload, taleUrl(String(current.date), String(current.slug)));
  if (r.kind === 'unpublish') {
    if (!current) return;
    // 撤下前存過、比上線版本新的草稿會留在最上面（Payload 的行為，test：「unpublish 時有一份比上線版本新的草稿」）
    await payload.update({ collection: col, id: r.docId, data: { _status: 'draft' } as never, overrideAccess: true });
  } else {
    // 回呼重送時文件已經刪掉了：視為完成
    if (!current) return;
    await payload.delete({ collection: col, id: r.docId, overrideAccess: true });
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
