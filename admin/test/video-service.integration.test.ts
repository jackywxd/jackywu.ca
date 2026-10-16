import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bindings } from '../src/lib/bindings';
import { signToken } from '../src/lib/internal-token';
import * as V from '../src/lib/video-service';
import { bootPayload } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
let clock = 1_700_000_000_000;
const SECRET = 'video-test-secret';
const started: { jobId: string; env: Record<string, string> }[] = [];
let transcoderFails = false;

beforeAll(async () => {
  t = await bootPayload();
  (bindings() as { TRANSCODER?: unknown }).TRANSCODER = {
    fetch: async (req: Request) => {
      if (transcoderFails) return new Response('boom', { status: 503 });
      started.push(await req.json() as never);
      return new Response('started', { status: 202 });
    },
  };
});
afterAll(async () => { await t?.close(); });
beforeEach(() => { started.length = 0; transcoderFails = false; });

const deps = (): V.VideoDeps => ({ payload: t.payload, b: bindings(), now: () => clock, secret: SECRET, adminUrl: 'https://admin.example', accessHeaders: () => ({ 'CF-Access-Client-Id': 'cid', 'CF-Access-Client-Secret': 'sec' }) });
const reel = async (id: string | number) => (await t.payload.findByID({ collection: 'reels', id, draft: true, depth: 0, overrideAccess: true })) as unknown as { videoId: string; title: string; poster?: unknown; duration?: number; bytes?: number; ratio?: string; transcode: { status: string; attempts: number; error?: string; sourceKey: string } };

async function uploaded(body = new Uint8Array(1000).fill(7)) {
  const init = await V.initUpload(deps(), { filename: 'My Trip 2026.MOV', size: body.length, contentType: 'video/quicktime' });
  if ('error' in init) throw new Error(init.error);
  const p = await V.uploadPart(deps(), String(init.reelId), init.uploadId, 1, body.buffer.slice(0) as ArrayBuffer);
  if ('error' in p) throw new Error(p.error);
  const c = await V.completeUpload(deps(), String(init.reelId), init.uploadId, [{ partNumber: 1, etag: p.etag }]);
  if ('error' in c) throw new Error(c.error);
  return { id: String(init.reelId), videoId: init.videoId };
}
/** 模擬容器：寫成品，然後回報 */
async function containerOk(id: string, videoId: string, over: Partial<V.DoneBody> = {}) {
  const mp4 = new Uint8Array(2048).fill(1);
  await bindings().R2.put(`video/${videoId}/1080p.mp4`, mp4);
  const jpg = (await (await import('sharp')).default({ create: { width: 32, height: 18, channels: 3, background: '#789' } }).jpeg().toBuffer());
  await bindings().R2.put(`video/${videoId}/poster.jpg`, jpg);
  return V.internalDone(deps(), id, { ok: true, duration: 12.4 as never, bytes: mp4.length, width: 1920, height: 1080, ...over });
}

describe('上傳', () => {
  it('不支援的格式、太大的檔案 → 在開始之前就拒絕，沒有建立任何東西', async () => {
    const before = (await t.payload.count({ collection: 'reels', overrideAccess: true })).totalDocs;
    expect(await V.initUpload(deps(), { filename: 'a.avi', size: 10, contentType: 'video/x-msvideo' })).toMatchObject({ error: expect.stringContaining('不支援') });
    expect(await V.initUpload(deps(), { filename: 'a.mp4', size: V.MAX_VIDEO_BYTES + 1, contentType: 'video/mp4' })).toMatchObject({ error: expect.stringContaining('4 GB') });
    expect((await t.payload.count({ collection: 'reels', overrideAccess: true })).totalDocs).toBe(before);
  });
  it('完整流程：分段上傳 → 原檔在私有 bucket → 狀態變排隊 → 叫轉碼容器，網址只對這支影片有效', async () => {
    const { id, videoId } = await uploaded();
    expect(videoId).toMatch(/^my-trip-2026-[0-9a-z]{4}$/);
    expect(await (await bindings().R2.get(`video-src/${videoId}/original.mov`))!.arrayBuffer()).toHaveProperty('byteLength', 1000);
    expect((await reel(id)).transcode).toMatchObject({ status: 'running', attempts: 1 });
    expect(started).toHaveLength(1);
    const env = started[0]!.env;
    expect(env.SRC_URL).toContain(`reel=${id}`); expect(env.OUT_URL).toContain('name={name}'); expect(env.DONE_URL).toContain('/api/video/internal/done');
    expect(JSON.parse(env.HEADERS)).toEqual({ 'CF-Access-Client-Id': 'cid', 'CF-Access-Client-Secret': 'sec' });
  });
  it('videoId 是公開網址的一部分：只含小寫英數與連字號，即使檔名全是中文或符號', async () => {
    const init = await V.initUpload(deps(), { filename: '雪山之巔！.mp4', size: 10, contentType: 'video/mp4' });
    if ('error' in init) throw new Error(init.error);
    expect(init.videoId).toMatch(/^[a-z0-9-]+$/);
    await V.abortUpload(deps(), String(init.reelId), init.uploadId);
  });
  it('放棄上傳：收掉分段與這個還沒用的 reel；別人（錯的 uploadId）不能動它', async () => {
    const init = await V.initUpload(deps(), { filename: 'x.mp4', size: 10, contentType: 'video/mp4' });
    if ('error' in init) throw new Error(init.error);
    expect(await V.abortUpload(deps(), String(init.reelId), 'wrong')).toMatchObject({ error: expect.any(String) });
    expect(await V.abortUpload(deps(), String(init.reelId), init.uploadId)).toEqual({ ok: true });
    await expect(t.payload.findByID({ collection: 'reels', id: init.reelId, overrideAccess: true })).rejects.toBeTruthy();
  });
  it('分段編號不合法、上傳已結束 → 拒絕', async () => {
    const { id } = await uploaded();
    expect(await V.uploadPart(deps(), id, 'whatever', 1, new ArrayBuffer(1))).toMatchObject({ error: expect.any(String) });
  });
});

describe('轉碼結果', () => {
  it('成功：poster 進媒體庫、時長／大小／比例寫回，狀態 done，可以發佈', async () => {
    const { id, videoId } = await uploaded();
    const r = await containerOk(id, videoId);
    expect(r.status).toBe('done');
    const doc = await reel(id);
    expect(doc).toMatchObject({ duration: 12, bytes: 2048, ratio: '16/9', transcode: { status: 'done' } });
    expect(doc.poster).toBeTruthy();
    expect((await t.payload.count({ collection: 'media', where: { filename: { equals: `${videoId}-poster.jpg` } }, overrideAccess: true })).totalDocs).toBe(1);
  });
  it('回報成功但成品其實不在 R2：不能信，當成失敗並重試', async () => {
    const { id } = await uploaded();
    const r = await V.internalDone(deps(), id, { ok: true, duration: 5, bytes: 100 });
    expect(r.status).toBe('queued');
    expect((await reel(id)).transcode.error).toMatch(/不在儲存空間/);
    expect(started.length).toBeGreaterThanOrEqual(2); // 又叫了一次
  });
  it('回報的大小與 R2 上的不符 → 不信', async () => {
    const { id, videoId } = await uploaded();
    expect((await containerOk(id, videoId, { bytes: 999 })).status).toBe('queued');
  });
  it('失敗：自動重試兩次，第三次才標成失敗；失敗後按「重新轉碼」可以再來', async () => {
    const { id } = await uploaded();
    expect((await V.internalDone(deps(), id, { ok: false, error: 'ffmpeg 結束碼 1' })).status).toBe('queued');
    expect((await V.internalDone(deps(), id, { ok: false, error: 'ffmpeg 結束碼 1' })).status).toBe('queued');
    expect((await V.internalDone(deps(), id, { ok: false, error: '壞檔' })).status).toBe('failed');
    expect((await reel(id)).transcode).toMatchObject({ status: 'failed', attempts: 3, error: '壞檔' });
    expect(await V.retryVideo(deps(), id)).toBe('started');
    expect((await reel(id)).transcode).toMatchObject({ status: 'running', attempts: 1 });
  });
  it('冪等：已完成之後又來一次回報，什麼都不變（不會多建一張 poster）', async () => {
    const { id, videoId } = await uploaded();
    await containerOk(id, videoId);
    const n = (await t.payload.count({ collection: 'media', overrideAccess: true })).totalDocs;
    expect((await containerOk(id, videoId)).status).toBe('done');
    expect((await t.payload.count({ collection: 'media', overrideAccess: true })).totalDocs).toBe(n);
  });
  it('比例：直拍、方形、4:3 都認得，介於之間的取最近', () => {
    expect(V.ratioOf(1920, 1080)).toBe('16/9'); expect(V.ratioOf(1080, 1920)).toBe('9/16'); expect(V.ratioOf(1080, 1080)).toBe('1/1');
    expect(V.ratioOf(1440, 1080)).toBe('4/3'); expect(V.ratioOf(1920, 800)).toBe('16/9');
  });
});

describe('容器看到的介面', () => {
  it('寫成品：只允許兩個檔名；影片不在轉碼中就不能寫', async () => {
    const { id, videoId } = await uploaded();
    expect(await V.internalOut(deps(), id, '../../evil', new TextEncoder().encode('x').buffer, 1)).toMatchObject({ error: expect.stringContaining('不允許') });
    expect(await V.internalOut(deps(), id, '1080p.mp4', new TextEncoder().encode('data').buffer, 4)).toEqual({ ok: true });
    expect(await (await bindings().R2.get(`video/${videoId}/1080p.mp4`))!.text()).toBe('data');
    await containerOk(id, videoId);
    expect(await V.internalOut(deps(), id, '1080p.mp4', new TextEncoder().encode('x').buffer, 1)).toMatchObject({ error: expect.stringContaining('不在轉碼中') });
  });
  it('讀原檔支援 Range（容器可以斷點續傳）', async () => {
    const { id } = await uploaded(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const obj = await V.internalSource(deps(), id, 'bytes=2-5');
    expect([...new Uint8Array(await obj!.arrayBuffer())]).toEqual([2, 3, 4, 5]);
    expect([...new Uint8Array(await (await V.internalSource(deps(), id, 'bytes=8-'))!.arrayBuffer())]).toEqual([8, 9]);
  });
  it('簽章檢查：不同影片、不同動作、過期都不行', async () => {
    const now = Math.floor(clock / 1000);
    const a = await signToken(SECRET, '5', 'src', now);
    expect((await V.checkToken(deps(), '5', 'src', String(a.exp), a.sig)).ok).toBe(true);
    expect((await V.checkToken(deps(), '6', 'src', String(a.exp), a.sig)).ok).toBe(false);
    expect((await V.checkToken(deps(), '5', 'out', String(a.exp), a.sig)).ok).toBe(false);
    expect((await V.checkToken(deps(), 'abc', 'src', String(a.exp), a.sig)).ok).toBe(false);
    clock += 5 * 3600 * 1000;
    expect((await V.checkToken(deps(), '5', 'src', String(a.exp), a.sig)).ok).toBe(false);
  });
});

describe('看門狗與叫不動容器', () => {
  it('轉碼服務暫時叫不動：維持排隊，sweep 之後補叫', async () => {
    transcoderFails = true;
    const { id } = await uploaded();
    expect((await reel(id)).transcode.status).toBe('queued');
    transcoderFails = false;
    await V.sweepVideos(deps());
    expect((await reel(id)).transcode.status).toBe('running');
  });
  it('進行中太久沒回報：看門狗收回並重派', async () => {
    const { id } = await uploaded();
    const before = started.length;
    clock += V_STALE() + 1000;
    expect((await V.sweepVideos(deps())).changed).toBeGreaterThanOrEqual(1);
    expect(started.length).toBeGreaterThan(before);
    expect((await reel(id)).transcode.attempts).toBe(2);
  });
});
const V_STALE = () => 30 * 60 * 1000;
