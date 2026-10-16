import { describe, expect, it } from 'vitest';
import { PART_SIZE, planParts, uploadVideo } from '../src/lib/video-upload';

describe('planParts', () => {
  it('剛好整除、多一個位元組、不到一段', () => {
    expect(planParts(PART_SIZE * 2).map((p) => [p.start, p.end])).toEqual([[0, PART_SIZE], [PART_SIZE, PART_SIZE * 2]]);
    expect(planParts(PART_SIZE + 1)).toHaveLength(2);
    expect(planParts(5)).toEqual([{ number: 1, start: 0, end: 5 }]);
  });
  it('每個位元組恰好被涵蓋一次，編號從 1 連續', () => {
    const parts = planParts(PART_SIZE * 3 + 123);
    expect(parts.map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(parts.reduce((n, p) => n + (p.end - p.start), 0)).toBe(PART_SIZE * 3 + 123);
    for (let i = 1; i < parts.length; i++) expect(parts[i]!.start).toBe(parts[i - 1]!.end);
  });
  it('空檔案、太大的檔案 → 丟錯', () => {
    expect(() => planParts(0)).toThrow(/空的/);
    expect(() => planParts(10_001 * PART_SIZE)).toThrow(/10,000/);
  });
});

function fakeServer(opts: { failPart?: (n: number, attempt: number) => boolean } = {}) {
  const calls: string[] = [];
  const attempts = new Map<number, number>();
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, 'http://x');
    calls.push(`${init.method ?? 'GET'} ${u.pathname}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/api/video/init') return json({ reelId: 7, videoId: 'v-abcd', uploadId: 'up1', partSize: PART_SIZE }, 201);
    if (u.pathname === '/api/video/part') {
      const n = Number(u.searchParams.get('part'));
      const a = (attempts.get(n) ?? 0) + 1; attempts.set(n, a);
      return opts.failPart?.(n, a) ? json({ error: 'x' }, 503) : json({ etag: `e${n}`, partNumber: n });
    }
    if (u.pathname === '/api/video/complete') return json({ ok: true });
    if (u.pathname === '/api/video/abort') return json({ ok: true });
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { f, calls, attempts };
}
const file = (size: number) => new File([new Uint8Array(size)], 'a.mp4', { type: 'video/mp4' });
const noSleep = async () => {};

describe('uploadVideo', () => {
  it('依序 init → 每一段 → complete，進度單調遞增到 100%', async () => {
    const s = fakeServer(); const seen: number[] = [];
    const r = await uploadVideo(file(PART_SIZE * 2 + 10), { fetchFn: s.f, onProgress: (d) => seen.push(d), sleep: noSleep });
    expect(r).toEqual({ reelId: 7, videoId: 'v-abcd' });
    expect(s.calls).toEqual(['POST /api/video/init', 'PUT /api/video/part', 'PUT /api/video/part', 'PUT /api/video/part', 'POST /api/video/complete']);
    expect(seen).toEqual([PART_SIZE, PART_SIZE * 2, PART_SIZE * 2 + 10]);
  });
  it('某一段暫時失敗：重試之後成功，整個上傳不受影響', async () => {
    const s = fakeServer({ failPart: (n, a) => n === 2 && a < 3 });
    await uploadVideo(file(PART_SIZE * 2 + 1), { fetchFn: s.f, sleep: noSleep });
    expect(s.attempts.get(2)).toBe(3);
    expect(s.calls.at(-1)).toBe('POST /api/video/complete');
  });
  it('某一段失敗三次：整個上傳失敗、通知後台收掉，且不會呼叫 complete', async () => {
    const s = fakeServer({ failPart: (n) => n === 2 });
    await expect(uploadVideo(file(PART_SIZE * 2 + 1), { fetchFn: s.f, sleep: noSleep })).rejects.toThrow(/第 2 段/);
    expect(s.calls).toContain('POST /api/video/abort');
    expect(s.calls).not.toContain('POST /api/video/complete');
  });
  it('init 被拒（格式不支援）：把後台的原因原樣丟出來，也沒有東西需要收', async () => {
    const f = (async () => new Response(JSON.stringify({ error: '不支援的影片格式' }), { status: 422, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    await expect(uploadVideo(file(10), { fetchFn: f, sleep: noSleep })).rejects.toThrow('不支援的影片格式');
  });
});
