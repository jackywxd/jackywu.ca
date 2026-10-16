import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GitHub, DispatchPayload } from '../src/lib/github-app';
import type { RunConclusion } from '../src/lib/publish-queue';
import { dispatchNext, handleCallback, loadActive, loadOne, requestChange, sweep, type Deps, type Notice } from '../src/lib/publish-service';
import { bootPayload, resetQueue } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
beforeAll(async () => { t = await bootPayload(); });
afterAll(async () => { await t?.close(); });

beforeEach(() => { fake.reset(); });

const fake = (() => {
  let dispatched: DispatchPayload[] = [];
  let conclusions: Record<string, RunConclusion> = {};
  let failNext = 0;
  let notices: Notice[] = [];
  let live: string | null = null;
  let onLookup: (() => Promise<void>) | null = null;
  let clock = 1_000_000;
  let n = 0;
  const github: GitHub = {
    async dispatch(p) { if (failNext > 0) { failNext--; throw new Error('GitHub 503'); } dispatched.push(p); },
    // 結論以「請求 id + 第幾次嘗試」為鍵：重送後，舊的那個 run 不能被當成這一次的
    async runConclusion(id, attempt) { const h = onLookup; onLookup = null; await h?.(); return conclusions[`${id}#${attempt}`] ?? conclusions[id] ?? 'in_progress'; },
  };
  return {
    github,
    get dispatched() { return dispatched; },
    get notices() { return notices; },
    setConclusion(id: string, c: RunConclusion, attempt?: number) { conclusions[attempt ? `${id}#${attempt}` : id] = c; },
    failDispatchOnce() { failNext = 1; },
    failDispatch(n: number) { failNext = n; },
    setLive(id: string | null) { live = id; },
    /** 下一次查詢 run 時，先做這件事（模擬「看門狗讀完佇列之後、寫回之前」別人改了狀態） */
    duringLookup(fn: () => Promise<void>) { onLookup = fn; },
    advance(ms: number) { clock += ms; },
    deps(): Deps {
      return {
        payload: t.payload, github, now: () => clock, newId: () => `req${String(++n).padStart(20, '0')}`, notify: async (x) => { notices.push(x); },
        liveManifest: async () => (live ? { requestId: live, promoted: [] } : null),
      };
    },
    reset() { dispatched = []; conclusions = {}; failNext = 0; notices = []; live = null; onLookup = null; },
  };
})();

const good = (slug: string, extra: Record<string, unknown> = {}) => ({
  title: `文章 ${slug}`, slug, date: '2026-04-01', realm: 'run' as const,
  excerpt: '一段足夠長的摘要，讓它通過顯示寬度的下限檢查，也方便辨認這是哪一篇。', shareable: true, ...extra,
});
async function draft(slug: string, extra: Record<string, unknown> = {}) {
  const d = await t.payload.create({ collection: 'tales', draft: true, overrideAccess: true, data: good(slug, extra) as never });
  return String(d.id);
}
const status = async (id: string) => (await t.payload.findByID({ collection: 'tales', id, draft: true, overrideAccess: true, depth: 0 }))._status;
const publishedTitle = async (id: string) => {
  const r = await t.payload.find({ collection: 'tales', where: { id: { equals: id }, _status: { equals: 'published' } }, overrideAccess: true, depth: 0 });
  return r.docs[0]?.title;
};
const okBody = (requestId: string, extra = {}) => ({ requestId, ok: true, ...extra });

beforeEach(async () => { await resetQueue(t.payload); });

describe('發佈請求', () => {
  it('不合格的稿子：回欄位錯誤，沒有排隊、沒有 dispatch', async () => {
    const id = await draft('bad-one', { realm: 'still', shareable: true });
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.map((e) => e.field)).toContain('shareable');
    expect(fake.dispatched).toHaveLength(0);
    expect(await loadActive(t.payload)).toHaveLength(0);
  });
  it('合格：排隊並立刻送出一筆，內容還是草稿（部署成功前不上線）', async () => {
    const id = await draft('ok-one');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(r.ok).toBe(true);
    expect(fake.dispatched).toHaveLength(1);
    expect(fake.dispatched[0]).toMatchObject({ kind: 'publish', collection: 'tales', docId: id });
    expect(await publishedTitle(id)).toBeUndefined();
  });
  it('連按兩次發佈（同一版本）只會有一筆請求', async () => {
    const id = await draft('twice');
    const a = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    const b = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(a.ok && b.ok && a.requestId === b.requestId).toBe(true);
    expect(await loadActive(t.payload)).toHaveLength(1);
    expect(fake.dispatched).toHaveLength(1);
  });
});

describe('佇列：一次一筆，壞稿擋不到別人', () => {
  it('三筆依序送出；第 2 筆失敗，第 1、3 筆照常上線，第 2 筆維持草稿', async () => {
    const [a, b, c] = [await draft('seq-a'), await draft('seq-b'), await draft('seq-c')];
    const ra = await requestChange(fake.deps(), { collection: 'tales', docId: a, kind: 'publish' });
    const rb = await requestChange(fake.deps(), { collection: 'tales', docId: b, kind: 'publish' });
    const rc = await requestChange(fake.deps(), { collection: 'tales', docId: c, kind: 'publish' });
    if (!ra.ok || !rb.ok || !rc.ok) throw new Error('排隊失敗');
    expect(fake.dispatched.map((d) => d.docId)).toEqual([a]); // b、c 還在排隊

    await handleCallback(fake.deps(), okBody(ra.requestId));
    expect(fake.dispatched.map((d) => d.docId)).toEqual([a, b]);

    await handleCallback(fake.deps(), { requestId: rb.requestId, ok: false, check: 'verify-og-crop', summary: '標題超出中央 560px', runUrl: 'https://x/run/1' });
    expect(fake.dispatched.map((d) => d.docId)).toEqual([a, b, c]);

    await handleCallback(fake.deps(), okBody(rc.requestId));
    expect(await publishedTitle(a)).toBe('文章 seq-a');
    expect(await publishedTitle(b)).toBeUndefined();
    expect(await status(b)).toBe('draft');
    expect(await publishedTitle(c)).toBe('文章 seq-c');
    expect(await loadOne(t.payload, rb.requestId)).toMatchObject({ status: 'failed', failure: { check: 'verify-og-crop', runUrl: 'https://x/run/1' } });
  });
});

describe('回呼', () => {
  it('冪等：同一個成功回呼送兩次，只發佈一次、只通知一次', async () => {
    const id = await draft('idem');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    const first = await handleCallback(fake.deps(), okBody(r.requestId));
    const again = await handleCallback(fake.deps(), okBody(r.requestId));
    expect(first.applied).toBe(true);
    expect(again).toMatchObject({ applied: false, status: 'deployed' });
    expect(fake.notices.filter((n) => n.kind === 'published')).toHaveLength(1);
  });
  it('先被判失敗、之後才收到成功回呼：改判已上線並真的發佈', async () => {
    const id = await draft('late-cb');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    fake.setConclusion(r.requestId, 'success');
    await sweep(fake.deps());
    expect((await loadOne(t.payload, r.requestId))?.status).toBe('failed');
    const res = await handleCallback(fake.deps(), okBody(r.requestId));
    expect(res).toMatchObject({ status: 'deployed', applied: true });
    expect(await publishedTitle(id)).toBe('文章 late-cb');
  });
  it('已定案後來了相反的結果 → 忽略，不會把已上線的撤掉', async () => {
    const id = await draft('flip');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    await handleCallback(fake.deps(), okBody(r.requestId));
    await handleCallback(fake.deps(), { requestId: r.requestId, ok: false, check: 'x', summary: 'y' });
    expect(await publishedTitle(id)).toBe('文章 flip');
  });
  it('失敗的回呼也記下這次搬出去的 key；同一次 run 已經撤回的就不留（之後才撤得掉沒撤回的）', async () => {
    const keys = async () => (await t.payload.find({ collection: 'promoted', limit: 0, pagination: false, overrideAccess: true })).docs.map((d) => d.key).sort();
    const before = await keys();
    const id = await draft('fail-keys');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    await handleCallback(fake.deps(), { requestId: r.requestId, ok: false, check: 'smoke', summary: 'x', promoteKeys: ['video/fk1/1080p.mp4', 'gpx/fk2.gpx'], revoked: ['video/fk1/1080p.mp4'] });
    expect((await keys()).filter((k) => !before.includes(k))).toEqual(['gpx/fk2.gpx']);
  });
  it('撤回被比例上限擋下 → 通知本人（不再只寫一個沒人讀的檔案）', async () => {
    const id = await draft('rev-abort');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    await handleCallback(fake.deps(), { ...okBody(r.requestId), revokeAborted: '要撤回 9 個，超過上限 4' });
    expect(fake.notices.find((n) => n.kind === 'revoke-aborted')).toMatchObject({ detail: '要撤回 9 個，超過上限 4' });
  });
  it('不存在的請求 → 丟錯', async () => {
    await expect(handleCallback(fake.deps(), okBody('nope'))).rejects.toThrow(/找不到請求/);
  });
  it('請求綁定送出那一刻的版本：之後再編輯，不會改到這次上線的內容', async () => {
    const id = await draft('bound');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    await t.payload.update({ collection: 'tales', id, draft: true, overrideAccess: true, data: { title: '送出之後才改的標題' } });
    await handleCallback(fake.deps(), okBody(r.requestId));
    expect(await publishedTitle(id)).toBe('文章 bound');
    // 線上看到的是送出當時的版本；送出之後的編輯另存為草稿，等下一次發佈
    const latest = await t.payload.findByID({ collection: 'tales', id, draft: true, overrideAccess: true, depth: 0 });
    expect(latest.title).toBe('送出之後才改的標題');
    expect(latest._status).toBe('draft');
  });
  it('promoted 記錄：成功時新增、撤回時精確刪除', async () => {
    const id = await draft('prom');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    await handleCallback(fake.deps(), okBody(r.requestId, { promoteKeys: ['video/a/1080p.mp4', 'video/b/1080p.mp4'] }));
    const has = async (k: string) => (await t.payload.count({ collection: 'promoted', where: { key: { equals: k } }, overrideAccess: true })).totalDocs;
    expect([await has('video/a/1080p.mp4'), await has('video/b/1080p.mp4')]).toEqual([1, 1]);
    // 下一筆成功時撤回 a
    const id2 = await draft('prom2');
    const r2 = await requestChange(fake.deps(), { collection: 'tales', docId: id2, kind: 'publish' });
    if (!r2.ok) throw new Error();
    await handleCallback(fake.deps(), okBody(r2.requestId, { promoteKeys: ['video/b/1080p.mp4'], revoked: ['video/a/1080p.mp4'] }));
    expect([await has('video/a/1080p.mp4'), await has('video/b/1080p.mp4')]).toEqual([0, 1]);
  });
});

describe('撤下與刪除', () => {
  it('unpublish：成功後轉回草稿，頁面不再是 published', async () => {
    const id = await draft('down');
    const p = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!p.ok) throw new Error();
    await handleCallback(fake.deps(), okBody(p.requestId));
    expect(await publishedTitle(id)).toBe('文章 down');
    const u = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'unpublish' });
    if (!u.ok) throw new Error();
    expect(await publishedTitle(id)).toBe('文章 down'); // 部署成功前仍然在線
    await handleCallback(fake.deps(), okBody(u.requestId));
    expect(await publishedTitle(id)).toBeUndefined();
  });
  it('delete：成功後文件真的被刪掉；失敗時文件原封不動', async () => {
    const keep = await draft('del-keep');
    const gone = await draft('del-gone');
    const k = await requestChange(fake.deps(), { collection: 'tales', docId: keep, kind: 'delete' });
    if (!k.ok) throw new Error();
    await handleCallback(fake.deps(), { requestId: k.requestId, ok: false, check: 'x', summary: 'y' });
    expect(await status(keep)).toBe('draft');
    const g = await requestChange(fake.deps(), { collection: 'tales', docId: gone, kind: 'delete' });
    if (!g.ok) throw new Error();
    await handleCallback(fake.deps(), okBody(g.requestId));
    await expect(t.payload.findByID({ collection: 'tales', id: gone, overrideAccess: true })).rejects.toBeTruthy();
  });
});

describe('依賴閉包', () => {
  it('發佈文章時，它引用、還沒上線的路線也一起標成 published', async () => {
    const route = await t.payload.create({
      collection: 'routes', draft: true, overrideAccess: true,
      data: { name: '依賴路線', slug: 'dep-route', realm: 'run', date: '2026-04-01', region: '卑詩', distanceKm: 12 } as never,
    });
    const id = await draft('with-dep', { route: route.id });
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    await handleCallback(fake.deps(), okBody(r.requestId));
    const dep = await t.payload.find({ collection: 'routes', where: { id: { equals: route.id }, _status: { equals: 'published' } }, overrideAccess: true });
    expect(dep.totalDocs).toBe(1);
  });
});

describe('依賴的檢查在送出時就做', () => {
  it('引用了還沒轉碼完成的影片 → 送出就被擋下，指向 video 欄位，沒有排隊', async () => {
    const reel = await t.payload.create({ collection: 'reels', draft: true, overrideAccess: true, data: { title: '還在轉', videoId: 'dep-wip', transcode: { status: 'running', attempts: 1 } } as never });
    const id = await draft('dep-reel-wip', { video: reel.id });
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(r).toMatchObject({ ok: false, errors: [{ field: 'video', message: expect.stringContaining('還沒轉碼完成') }] });
    expect(await loadActive(t.payload)).toHaveLength(0);
    expect(fake.dispatched).toHaveLength(0);
  });
  it('影片轉好了但資料不完整（沒有行當、日期）→ 列出缺哪些', async () => {
    const reel = await t.payload.create({ collection: 'reels', draft: true, overrideAccess: true, data: { title: '缺資料', videoId: 'dep-incomplete', duration: 5, bytes: 9, transcode: { status: 'done', attempts: 1 } } as never });
    const id = await draft('dep-reel-inc', { video: reel.id });
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(r.ok === false && r.errors[0]!.message).toMatch(/行當.*日期|日期.*行當/);
  });
  it('影片完整 → 通過，並且跟著這篇一起上線', async () => {
    const reel = await t.payload.create({ collection: 'reels', draft: true, overrideAccess: true, data: { title: '完整', videoId: 'dep-ok', realm: 'snow', date: '2026-02-08', posterAlt: '封面', duration: 5, bytes: 9, ratio: '16/9', transcode: { status: 'done', attempts: 1 } } as never });
    const media = await t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'p', kind: 'img' }, file: { data: await (await import('sharp')).default({ create: { width: 8, height: 8, channels: 3, background: '#789' } }).jpeg().toBuffer(), mimetype: 'image/jpeg', name: 'dep-ok.jpg', size: 1 } });
    await t.payload.update({ collection: 'reels', id: reel.id, draft: true, overrideAccess: true, data: { poster: media.id } as never });
    const id = await draft('dep-reel-ok', { video: reel.id });
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(r.ok).toBe(true);
    if (r.ok) await handleCallback(fake.deps(), okBody(r.requestId));
    const live = await t.payload.find({ collection: 'reels', where: { id: { equals: reel.id }, _status: { equals: 'published' } }, overrideAccess: true });
    expect(live.totalDocs).toBe(1);
  });
  it('路線資料不完整（沒有距離）→ 擋下，指向 route 欄位', async () => {
    const route = await t.payload.create({ collection: 'routes', draft: true, overrideAccess: true, data: { name: '沒距離', slug: 'dep-nodist', realm: 'run', date: '2026-04-01', region: 'x' } as never });
    const id = await draft('dep-route-inc', { route: route.id });
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(r.ok === false && r.errors[0]).toMatchObject({ field: 'route', message: expect.stringContaining('距離') });
  });
});

describe('dispatch 失敗與看門狗', () => {
  it('GitHub 暫時失敗：請求維持 queued 並通知；sweep 會重試成功', async () => {
    const id = await draft('retry');
    fake.failDispatchOnce();
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    expect(fake.dispatched).toHaveLength(0);
    expect((await loadOne(t.payload, r.requestId))?.status).toBe('queued');
    expect(fake.notices.some((n) => n.kind === 'dispatch-error')).toBe(true);
    await sweep(fake.deps());
    expect(fake.dispatched.map((d) => d.docId)).toEqual([id]);
    expect((await loadOne(t.payload, r.requestId))?.status).toBe('dispatched');
  });
  it('run 被 GitHub 取消：自動重送，不算失敗', async () => {
    const id = await draft('cancelled');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    fake.setConclusion(r.requestId, 'cancelled');
    await sweep(fake.deps());
    expect(fake.dispatched.filter((d) => d.docId === id)).toHaveLength(2);
    expect(await loadOne(t.payload, r.requestId)).toMatchObject({ status: 'dispatched', attempts: 2 });
  });
  it('run 還在跑（例如在 concurrency 群組裡排隊）：等多久都不判失敗，也不放行下一筆', async () => {
    const [a, b] = [await draft('slow-a'), await draft('slow-b')];
    const ra = await requestChange(fake.deps(), { collection: 'tales', docId: a, kind: 'publish' });
    await requestChange(fake.deps(), { collection: 'tales', docId: b, kind: 'publish' });
    if (!ra.ok) throw new Error();
    fake.advance(2 * 60 * 60 * 1000);
    await sweep(fake.deps());
    expect(await loadOne(t.payload, ra.requestId)).toMatchObject({ status: 'dispatched' });
    expect(fake.dispatched.map((d) => d.docId)).toEqual([a]);
    // 之後它照樣成功回呼：已上線，接著才輪到下一筆
    await handleCallback(fake.deps(), okBody(ra.requestId));
    expect(await publishedTitle(a)).toBe('文章 slow-a');
    expect(fake.dispatched.map((d) => d.docId)).toEqual([a, b]);
  });
  it('重送之後，GitHub 還沒建出新的 run：不能把舊的 cancelled 當成這一次的結論', async () => {
    const id = await draft('rerun');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    fake.setConclusion(r.requestId, 'cancelled', 1);
    fake.setConclusion(r.requestId, 'unknown', 2);
    await sweep(fake.deps()); // 第 1 次被取消 → 重送第 2 次
    await sweep(fake.deps()); // 第 2 次的 run 還沒出現：什麼都不做
    await sweep(fake.deps());
    expect(await loadOne(t.payload, r.requestId)).toMatchObject({ status: 'dispatched', attempts: 2 });
    expect(fake.dispatched.map((d) => d.attempt)).toEqual([1, 2]);
  });
  it('run 結束卻沒有回呼，但線上的 manifest 就是這一筆：判已上線並發佈（網站與後台一致）', async () => {
    const id = await draft('late-live');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    fake.setConclusion(r.requestId, 'failure');
    fake.setLive(r.requestId);
    await sweep(fake.deps());
    expect(await loadOne(t.payload, r.requestId)).toMatchObject({ status: 'deployed', late: true });
    expect(await publishedTitle(id)).toBe('文章 late-live');
  });
  it('看門狗讀完佇列之後、寫回之前，回呼先把它定案為已上線：看門狗不能用舊資料蓋掉', async () => {
    const id = await draft('race');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    fake.setConclusion(r.requestId, 'success');
    fake.duringLookup(async () => { await handleCallback(fake.deps(), okBody(r.requestId)); });
    await sweep(fake.deps());
    expect(await loadOne(t.payload, r.requestId)).toMatchObject({ status: 'deployed' });
    expect(await publishedTitle(id)).toBe('文章 race');
  });
  it('workflow 顯示成功卻沒有回呼：不能當成已發佈', async () => {
    const id = await draft('no-callback');
    const r = await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    if (!r.ok) throw new Error();
    fake.setConclusion(r.requestId, 'success');
    await sweep(fake.deps());
    expect(await loadOne(t.payload, r.requestId)).toMatchObject({ status: 'failed', failure: { check: 'callback-missing' } });
    expect(await publishedTitle(id)).toBeUndefined();
  });
});

describe('dispatchNext', () => {
  it('佇列是空的 → 什麼都不做', async () => {
    expect(await dispatchNext(fake.deps())).toBeNull();
    expect(fake.dispatched).toHaveLength(0);
  });
  it('兩個同時呼叫（例如回呼與排程同時到）：只送出一次', async () => {
    fake.failDispatchOnce(); // 讓請求先留在 queued
    const id = await draft('concurrent');
    await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    expect(fake.dispatched).toHaveLength(0);
    await Promise.all([dispatchNext(fake.deps()), dispatchNext(fake.deps()), dispatchNext(fake.deps())]);
    expect(fake.dispatched).toHaveLength(1);
    expect((await loadActive(t.payload)).filter((r) => r.status === 'dispatched')).toHaveLength(1);
  });
  it('GitHub 一直送不出去：只在第一次通知，不會每次重試都寄信', async () => {
    fake.failDispatch(5);
    const id = await draft('storm');
    await requestChange(fake.deps(), { collection: 'tales', docId: id, kind: 'publish' });
    for (let i = 0; i < 4; i++) await sweep(fake.deps());
    expect(fake.notices.filter((n) => n.kind === 'dispatch-error')).toHaveLength(1);
  });
});
