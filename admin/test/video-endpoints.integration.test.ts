import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PayloadRequest } from 'payload';
import { videoEndpoints } from '../src/endpoints/video';
import { bindings } from '../src/lib/bindings';
import { signToken, type Scope } from '../src/lib/internal-token';
import { sign } from '../src/lib/hmac';
import type { VideoDeps } from '../src/lib/video-service';
import { bootPayload } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
const SECRET = 'ep-video-secret', HMAC = 'ep-hmac';
const started: { jobId: string; env: Record<string, string> }[] = [];
beforeAll(async () => {
  t = await bootPayload();
  (bindings() as { TRANSCODER?: unknown }).TRANSCODER = { fetch: async (r: Request) => { started.push(await r.json() as never); return new Response('ok', { status: 202 }); } };
});
afterAll(async () => { await t?.close(); });

const eps = videoEndpoints((req) => ({
  payload: req.payload, b: bindings(), now: () => Date.now(), secret: SECRET, adminUrl: 'http://admin.test',
  accessHeaders: () => ({ 'CF-Access-Client-Id': 'c', 'CF-Access-Client-Secret': 's' }),
}) as VideoDeps, () => HMAC);
const h = (method: string, path: string) => eps.find((e) => e.method === method.toLowerCase() && e.path === path)!.handler;
const owner = { id: 1, role: 'owner' };

async function call(method: string, path: string, o: { query?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string>; user?: unknown } = {}) {
  const init: RequestInit = { method, headers: { ...(o.json !== undefined ? { 'content-type': 'application/json' } : {}), ...o.headers }, body: o.json !== undefined ? JSON.stringify(o.json) : o.body };
  const req = Object.assign(new Request(`http://localhost/api${path}${o.query ?? ''}`, init), { payload: t.payload, user: o.user ?? null }) as unknown as PayloadRequest;
  const res = await h(method, path)(req) as Response;
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() as Record<string, unknown> : null, text: type.includes('json') ? '' : await res.text() };
}
const q = async (reel: string | number, scope: Scope, extra = '', attempt = 1) => { const s = await signToken(SECRET, String(reel), scope, attempt); return `?reel=${reel}&a=${attempt}&exp=${s.exp}&sig=${s.sig}${extra}`; };

describe('擁有者的端點', () => {
  it.each([['POST', '/video/init'], ['PUT', '/video/part'], ['POST', '/video/complete'], ['POST', '/video/abort'], ['POST', '/video/retry']])('%s %s：匿名與 reader 都是 401', async (m, p) => {
    expect((await call(m, p, { json: {} })).status).toBe(401);
    expect((await call(m, p, { json: {}, user: { id: 2, role: 'reader' } })).status).toBe(401);
  });
  it('init 參數不對 → 400；格式不支援 → 422 並說明', async () => {
    expect((await call('POST', '/video/init', { json: { filename: 1 }, user: owner })).status).toBe(400);
    const r = await call('POST', '/video/init', { json: { filename: 'a.avi', size: 5, contentType: 'video/x-msvideo' }, user: owner });
    expect(r.status).toBe(422); expect(r.json!.error).toMatch(/不支援/);
  });
  it('init → part → complete 經由 HTTP 走一遍，完成後叫了轉碼容器', async () => {
    const init = (await call('POST', '/video/init', { json: { filename: 'trip.mp4', size: 6, contentType: 'video/mp4' }, user: owner })).json!;
    const part = await call('PUT', '/video/part', { query: `?reel=${init.reelId}&uploadId=${init.uploadId}&part=1`, body: new Uint8Array([1, 2, 3, 4, 5, 6]), user: owner });
    expect(part.status).toBe(200);
    const done = await call('POST', '/video/complete', { json: { reel: String(init.reelId), uploadId: init.uploadId, parts: [{ partNumber: 1, etag: (part.json as { etag: string }).etag }] }, user: owner });
    expect(done.status).toBe(200);
    expect(started.at(-1)!.jobId).toBe(String(init.reelId));
  });
  it('complete 的 parts 格式不對 → 400（不是 500）', async () => {
    expect((await call('POST', '/video/complete', { json: { reel: '1', uploadId: 'x', parts: [{ partNumber: 'a' }] }, user: owner })).status).toBe(400);
  });
});

describe('容器的端點：簽章網址是唯一的授權', () => {
  async function running() {
    const init = (await call('POST', '/video/init', { json: { filename: 'c.mp4', size: 8, contentType: 'video/mp4' }, user: owner })).json!;
    const part = await call('PUT', '/video/part', { query: `?reel=${init.reelId}&uploadId=${init.uploadId}&part=1`, body: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), user: owner });
    await call('POST', '/video/complete', { json: { reel: String(init.reelId), uploadId: init.uploadId, parts: [{ partNumber: 1, etag: (part.json as { etag: string }).etag }] }, user: owner });
    return { id: String(init.reelId), videoId: String(init.videoId) };
  }
  it('沒有簽章、簽章錯、拿 src 的簽章去寫 out、拿別支影片的簽章 → 全部 401', async () => {
    const { id } = await running();
    expect((await call('GET', '/video/internal/src', { query: `?reel=${id}` })).status).toBe(401);
    expect((await call('GET', '/video/internal/src', { query: `?reel=${id}&exp=9999999999&sig=${'a'.repeat(64)}` })).status).toBe(401);
    expect((await call('PUT', '/video/internal/out', { query: (await q(id, 'src')) + '&name=1080p.mp4', body: 'x', headers: { 'content-length': '1' } })).status).toBe(401);
    const other = await signToken(SECRET, String(Number(id) + 999), 'src', 1); // 別支影片的簽章，拿來開這一支
    expect((await call('GET', '/video/internal/src', { query: `?reel=${id}&a=1&exp=${other.exp}&sig=${other.sig}` })).status).toBe(401);
    // 簽章是對的、但影片已經不存在 → 404，不是 500
    expect((await call('GET', '/video/internal/src', { query: await q(Number(id) + 999, 'src') })).status).toBe(404);
  });
  it('讀原檔、分段寫成品、寫 poster、送心跳、回報成功：一條龍', async () => {
    const { id, videoId } = await running();
    const src = await call('GET', '/video/internal/src', { query: await q(id, 'src'), headers: { range: 'bytes=2-4' } });
    expect(src.status).toBe(200); expect(src.text.length).toBe(8); // 不做 Range：回整個檔案，標頭與內容一致
    expect(src.headers.get('content-length')).toBe('8');

    expect((await call('POST', '/video/internal/beat', { query: await q(id, 'beat') })).status).toBe(200);
    const mp4 = new Uint8Array(64).fill(9);
    const st = await call('POST', '/video/internal/out-start', { query: (await q(id, 'out')) + '&name=1080p.mp4', json: {} });
    expect(st.status).toBe(200);
    const uploadId = (st.json as { uploadId: string }).uploadId;
    const pt = await call('PUT', '/video/internal/out-part', { query: (await q(id, 'out')) + `&name=1080p.mp4&uploadId=${uploadId}&part=1`, body: mp4, headers: { 'content-length': '64' } });
    expect(pt.status).toBe(200);
    expect((await call('POST', '/video/internal/out-complete', { query: (await q(id, 'out')) + `&name=1080p.mp4&uploadId=${uploadId}`, json: { parts: [pt.json] } })).status).toBe(200);
    const jpg = await (await import('sharp')).default({ create: { width: 16, height: 9, channels: 3, background: '#789' } }).jpeg().toBuffer();
    expect((await call('PUT', '/video/internal/out', { query: (await q(id, 'out')) + '&name=poster.jpg', body: new Uint8Array(jpg), headers: { 'content-length': String(jpg.length) } })).status).toBe(200);
    expect((await call('PUT', '/video/internal/out', { query: (await q(id, 'out')) + '&name=evil.sh', body: 'x', headers: { 'content-length': '1' } })).status).toBe(409);

    const done = await call('POST', '/video/internal/done', { query: await q(id, 'done'), json: { ok: true, duration: 7, bytes: 64, width: 1080, height: 1920 } });
    expect(done.json).toEqual({ status: 'done' });
    const doc = await t.payload.findByID({ collection: 'reels', id, draft: true, depth: 0, overrideAccess: true }) as unknown as { ratio: string; duration: number };
    expect(doc).toMatchObject({ ratio: '9/16', duration: 7 });
    expect(await bindings().R2.head(`video/${videoId}/1080p.mp4`)).not.toBeNull();
  });
  it('單次寫入超過 90MB → 413，說明要用分段（Workers 的請求大小上限）', async () => {
    const { id } = await running();
    expect((await call('PUT', '/video/internal/out', { query: (await q(id, 'out')) + '&name=1080p.mp4', body: 'x', headers: { 'content-length': String(200 * 1024 * 1024) } })).status).toBe(413);
  });
  it('用上一次嘗試的網址回報 → 409，狀態不變', async () => {
    const { id } = await running();
    // 第 1 次失敗 → 看門狗重派第 2 次
    await call('POST', '/video/internal/done', { query: await q(id, 'done'), json: { ok: false, error: 'x' } });
    await call('POST', '/video/sweep', { body: '', headers: { 'x-signature': await sign(HMAC, '') } });
    const late = await call('POST', '/video/internal/done', { query: await q(id, 'done'), json: { ok: true, bytes: 1 } });
    expect(late.json).toEqual({ status: 'running' });
    expect((await t.payload.findByID({ collection: 'reels', id, draft: true, depth: 0, overrideAccess: true }) as unknown as { transcode: { attempts: number } }).transcode.attempts).toBe(2);
  });
  it('寫成品沒有 content-length → 411（R2 串流寫入需要事先知道長度）', async () => {
    const { id } = await running();
    expect((await call('PUT', '/video/internal/out', { query: (await q(id, 'out')) + '&name=poster.jpg', body: 'x' })).status).toBe(411);
  });
  it('回報的內容不對 → 400', async () => {
    const { id } = await running();
    expect((await call('POST', '/video/internal/done', { query: await q(id, 'done'), json: { ok: 'yes' } })).status).toBe(400);
  });
});

describe('設定', () => {
  it('正式與 staging 都綁了轉碼服務（先前只有 e2e 綁了，線上的影片永遠停在排隊）', async () => {
    const { readFileSync } = await import('node:fs');
    const ts = (await import('typescript')).default;
    // jsonc：TypeScript 的設定檔解析器處理註解與結尾逗號
    const read = (f: string) => ts.parseConfigFileTextToJson(f, readFileSync(f, 'utf8')).config;
    const w = read('wrangler.jsonc'), tc = read('transcoder/worker/wrangler.jsonc');
    const bound = (svc: { binding: string; service: string }[] | undefined) => svc?.find((x) => x.binding === 'TRANSCODER')?.service;
    expect(bound(w.services)).toBe(tc.name);
    expect(bound(w.env.staging.services)).toBe(tc.env.staging.name);
  });
});

describe('排程', () => {
  it('sweep：沒有簽章也不是本人 → 401；簽章對 → 200', async () => {
    expect((await call('POST', '/video/sweep', { body: '' })).status).toBe(401);
    expect((await call('POST', '/video/sweep', { body: '', headers: { 'x-signature': await sign(HMAC, '') } })).status).toBe(200);
  });
});
