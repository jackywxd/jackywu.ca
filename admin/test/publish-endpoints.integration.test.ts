import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PayloadRequest } from 'payload';
import { publishEndpoints } from '../src/endpoints/publish';
import { sign } from '../src/lib/hmac';
import { loadOne, type Deps } from '../src/lib/publish-service';
import type { DispatchPayload } from '../src/lib/github-app';
import { bootPayload, resetQueue } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
const dispatched: DispatchPayload[] = [];
let n = 0;
const SECRET = 'endpoint-test-secret';
const SWEEP_SECRET = 'sweep-only-secret';
let deps: Deps;
let eps: ReturnType<typeof publishEndpoints>;

beforeAll(async () => {
  t = await bootPayload();
  deps = {
    payload: t.payload, now: () => Date.now(), newId: () => `ep${String(++n).padStart(20, '0')}`, notify: async () => {},
    github: { dispatch: async (p) => { dispatched.push(p); }, runConclusion: async () => 'in_progress' },
  };
  eps = publishEndpoints({ deps: () => deps, hmacSecret: () => SECRET, sweepSecret: () => SWEEP_SECRET });
});
afterAll(async () => { await t?.close(); });
beforeEach(async () => { dispatched.length = 0; await resetQueue(t.payload); });

const handler = (path: string) => eps.find((e) => e.path === path)!.handler;
const call = async (path: string, init: { method?: string; body?: string; headers?: Record<string, string>; user?: unknown }) => {
  const req = Object.assign(new Request('http://localhost/api' + path, { method: init.method ?? 'POST', body: init.body, headers: init.headers }), {
    payload: t.payload, user: init.user ?? null,
  }) as unknown as PayloadRequest;
  const res = await handler(path)(req) as Response;
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const owner = { id: 1, role: 'owner' };
const reader = { id: 2, role: 'reader' };

async function draft(slug: string, extra: Record<string, unknown> = {}) {
  const d = await t.payload.create({ collection: 'tales', draft: true, overrideAccess: true, data: {
    title: `t ${slug}`, slug, date: '2026-05-01', realm: 'run', shareable: true,
    excerpt: '一段足夠長的摘要，讓它通過顯示寬度的下限檢查，也方便辨認這是哪一篇。', ...extra,
  } as never });
  return String(d.id);
}

describe('POST /publish/request', () => {
  it('匿名與 reader 都是 401，且沒有 dispatch', async () => {
    const id = await draft('ep-auth');
    for (const user of [null, reader]) {
      const r = await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user });
      expect(r.status).toBe(401);
    }
    expect(dispatched).toHaveLength(0);
  });
  it.each([
    ['壞 JSON', '{nope'],
    ['集合不對', JSON.stringify({ collection: 'users', docId: '1', kind: 'publish' })],
    ['kind 不對', JSON.stringify({ collection: 'tales', docId: '1', kind: 'nuke' })],
    ['docId 缺', JSON.stringify({ collection: 'tales', kind: 'publish' })],
  ])('%s → 400', async (_n, body) => {
    expect((await call('/publish/request', { body, user: owner })).status).toBe(400);
  });
  it('不合格的稿子 → 422 與欄位錯誤', async () => {
    const id = await draft('ep-bad', { realm: 'still', shareable: true });
    const r = await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user: owner });
    expect(r.status).toBe(422);
    expect((r.body.errors as { field: string }[]).map((e) => e.field)).toContain('shareable');
  });
  it('合格 → 202 與 requestId，並送出 dispatch', async () => {
    const id = await draft('ep-ok');
    const r = await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user: owner });
    expect(r.status).toBe(202);
    expect(dispatched.at(-1)).toMatchObject({ requestId: r.body.requestId, docId: id });
  });
});

describe('POST /publish/callback', () => {
  const post = async (body: unknown, header?: string | null, raw?: string) => {
    const text = raw ?? JSON.stringify(body);
    return call('/publish/callback', { body: text, headers: header === null ? {} : { 'x-signature': header ?? (await sign(SECRET, text)) } });
  };
  it('沒有簽章、簽章錯、過期 → 401，狀態不變', async () => {
    const id = await draft('cb-auth');
    const rr = await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user: owner });
    const requestId = rr.body.requestId as string;
    const body = { requestId, ok: true };
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, 't=1,v1=' + 'a'.repeat(64))).status).toBe(401);
    expect((await post(body, await sign(SECRET, JSON.stringify(body), Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect((await sign('wrong-secret', JSON.stringify(body))).length).toBeGreaterThan(0);
    expect((await post(body, await sign('wrong-secret', JSON.stringify(body)))).status).toBe(401);
    expect((await loadOne(t.payload, requestId))?.status).toBe('dispatched');
  });
  it('簽章正確 → 200，內容才真的上線', async () => {
    const id = await draft('cb-ok');
    const rr = await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user: owner });
    const requestId = rr.body.requestId as string;
    const r = await post({ requestId, ok: true });
    expect(r.status).toBe(200);
    const live = await t.payload.find({ collection: 'tales', where: { id: { equals: id }, _status: { equals: 'published' } }, overrideAccess: true });
    expect(live.totalDocs).toBe(1);
  });
  it('requestId 格式不對 → 400（不是 500）', async () => {
    expect((await post({ requestId: "x'; DROP TABLE", ok: true })).status).toBe(400);
  });
  it('ok 不是布林 → 400', async () => {
    expect((await post({ requestId: 'a'.repeat(22), ok: 'yes' })).status).toBe(400);
  });
  it('不存在的請求 → 404', async () => {
    expect((await post({ requestId: 'z'.repeat(22), ok: true })).status).toBe(404);
  });
  it('後台內部出錯 → 500（不是 404）：CI 對 4xx 不重試，暫時的錯誤不能變成永久失敗', async () => {
    const id = await draft('cb-500');
    const rr = await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user: owner });
    const saved = deps.notify;
    deps.notify = async () => { throw new Error('D1 暫時忙碌'); };
    try { expect((await post({ requestId: rr.body.requestId, ok: true })).status).toBe(500); } finally { deps.notify = saved; }
  });
  it('排程的密鑰簽不了回呼（排程 Worker 不該能宣告「已上線」）', async () => {
    const body = JSON.stringify({ requestId: 'z'.repeat(22), ok: true });
    expect((await call('/publish/callback', { body, headers: { 'x-signature': await sign(SWEEP_SECRET, body) } })).status).toBe(401);
  });
  it('內容太大 → 413', async () => {
    expect((await post(null, undefined, 'x'.repeat(70 * 1024))).status).toBe(413);
  });
});

describe('其他', () => {
  it('GET /publish/status：匿名 401，本人拿得到列表', async () => {
    expect((await call('/publish/status', { method: 'GET' })).status).toBe(401);
    const r = await call('/publish/status', { method: 'GET', user: owner });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.requests)).toBe(true);
  });
  it('GET /publish/status 只讀：不跑看門狗、不送出 dispatch（以前每 4 秒輪詢都會觸發）', async () => {
    const saved = deps.github;
    deps.github = { ...saved, dispatch: async () => { throw new Error('GitHub 503'); } };
    const id = await draft('status-ro');
    await call('/publish/request', { body: JSON.stringify({ collection: 'tales', docId: id, kind: 'publish' }), user: owner });
    deps.github = saved;
    const before = dispatched.length;
    await call('/publish/status', { method: 'GET', user: owner });
    expect(dispatched.length).toBe(before);
  });
  it('POST /publish/sweep：沒簽章也不是本人 → 401；用排程的密鑰簽 → 200；用回呼的密鑰簽 → 401', async () => {
    expect((await call('/publish/sweep', { body: '' })).status).toBe(401);
    expect((await call('/publish/sweep', { body: '', headers: { 'x-signature': await sign(SWEEP_SECRET, '') } })).status).toBe(200);
    expect((await call('/publish/sweep', { body: '', headers: { 'x-signature': await sign(SECRET, '') } })).status).toBe(401);
  });
  it('設定檔真的掛上了這四個端點', async () => {
    const paths = (t.payload.config.endpoints ?? []).map((e) => `${e.method} ${e.path}`);
    for (const p of ['post /publish/request', 'get /publish/status', 'post /publish/callback', 'post /publish/sweep']) expect(paths).toContain(p);
  });
});
