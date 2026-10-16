import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegArgs, isCompatible, parseProbe, posterArgs, run } from '../transcoder/container/transcode.mjs';

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dir = mkdtempSync(path.join(tmpdir(), 'transcoder-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const probeOf = (v: Partial<Record<string, unknown>>) => ({ vcodec: 'h264', pixfmt: 'yuv420p', width: 1280, height: 720, acodec: 'aac', duration: 10, ...v });

describe('決定要不要重新編碼（與 encode-video.sh 相同的規則）', () => {
  it('H.264 + yuv420p + ≤1920 + AAC → 相容，只 remux', () => expect(isCompatible(probeOf({}))).toBe(true));
  it('沒有音軌也算相容', () => expect(isCompatible(probeOf({ acodec: 'none' }))).toBe(true));
  it.each([[{ vcodec: 'hevc' }], [{ pixfmt: 'yuv444p' }], [{ width: 3840 }], [{ acodec: 'opus' }], [{ acodec: 'mp3' }]])('%j → 要重新編碼', (v) => expect(isCompatible(probeOf(v))).toBe(false));
  it('remux 用 -c copy，重編碼用 libx264 與 faststart、yuv420p', () => {
    expect(ffmpegArgs('i', 'o', probeOf({}))).toEqual(expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart']));
    const a = ffmpegArgs('i', 'o', probeOf({ vcodec: 'hevc' }));
    expect(a).toEqual(expect.arrayContaining(['libx264', '-crf', '23', '+faststart', 'yuv420p']));
    expect(a).not.toContain('copy');
  });
  it('poster：長影片取第 2 秒；短影片取開頭（不能因為影片太短就失敗）', () => {
    expect(posterArgs('i', 'o', 30)).toContain('00:00:02');
    expect(posterArgs('i', 'o', 1.2)).toContain('00:00:00');
  });
  it('parseProbe：沒有影像軌 → 丟錯', () => expect(() => parseProbe({ streams: [{ codec_type: 'audio' }] })).toThrow(/沒有影像軌/));
  it('parseProbe：手機直拍的影片編碼是橫的、旋轉記在 side data → 回傳顯示的寬高（比例才不會存成 16/9）', () => {
    const rotated = { streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] }], format: { duration: '5' } };
    expect(parseProbe(rotated)).toMatchObject({ width: 1080, height: 1920 });
    const tagged = { streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, tags: { rotate: '270' } }], format: { duration: '5' } };
    expect(parseProbe(tagged)).toMatchObject({ width: 1080, height: 1920 });
    expect(parseProbe({ ...rotated, streams: [{ ...rotated.streams[0], side_data_list: [{ rotation: 180 }] }] })).toMatchObject({ width: 1920, height: 1080 });
  });
  it('直拍 1080×1920 的 H.264 也算相容（看長邊，不是寬）', () => expect(isCompatible(probeOf({ width: 1080, height: 1920 }))).toBe(true));
  it('直拍 4K（2160×3840）→ 重編碼並縮到長邊 1920，不是寬 1920（那會變成 1920×3414，超出 H.264 level 4.1）', () => {
    const a = ffmpegArgs('in', 'out', probeOf({ vcodec: 'hevc', width: 2160, height: 3840 }));
    expect(a[a.indexOf('-vf') + 1]).toBe("scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'");
  });
  it('輸入只允許本機檔案（不讓特製的影片去讀網路或其他協定）', () => {
    for (const a of [ffmpegArgs('in', 'out', probeOf({})), posterArgs('in', 'out', 10)]) {
      expect(a.indexOf('-protocol_whitelist')).toBeGreaterThan(-1);
      expect(a[a.indexOf('-protocol_whitelist') + 1]).toBe('file');
      expect(a.indexOf('-protocol_whitelist')).toBeLessThan(a.indexOf('-i'));
    }
  });
});

/** 假的後台：原檔從這裡讀，成品寫到這裡（poster 單次 PUT、mp4 分段），心跳與結果回報到這裡 */
function fakeAdmin(source: Buffer | null) {
  const stored = new Map<string, Buffer>(); let done: Record<string, unknown> | null = null;
  const parts = new Map<number, Buffer>(); const events: string[] = []; let beats = 0;
  const body = async (b: unknown) => {
    if (b instanceof Uint8Array) return Buffer.from(b); // 分段上傳送的是 Buffer
    const c: Buffer[] = []; for await (const x of b as AsyncIterable<Uint8Array>) c.push(Buffer.from(x)); return Buffer.concat(c);
  };
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.pathname === '/src') return source ? new Response(new Uint8Array(source), { headers: { 'content-length': String(source.length) } }) : new Response('nope', { status: 404 });
    if (u.pathname === '/out' && init.method === 'PUT') { stored.set(u.searchParams.get('name')!, await body(init.body)); return new Response('ok'); }
    if (u.pathname === '/out-start') { parts.clear(); return Response.json({ uploadId: 'up1' }); }
    if (u.pathname === '/out-part') { const n = Number(u.searchParams.get('part')); parts.set(n, await body(init.body)); return Response.json({ etag: `e${n}`, partNumber: n }); }
    if (u.pathname === '/out-complete') {
      const ps = (JSON.parse(String(init.body)) as { parts: { partNumber: number }[] }).parts;
      stored.set(u.searchParams.get('name')!, Buffer.concat(ps.map((p) => parts.get(p.partNumber)!)));
      events.push(`complete:${ps.length}`); return new Response('ok');
    }
    if (u.pathname === '/beat') { beats++; return new Response('ok'); }
    if (u.pathname === '/done') { events.push('done'); done = JSON.parse(String(init.body)); return new Response('ok'); }
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, stored, events, get beats() { return beats; }, get done() { return done; } };
}
const envFor = (over: Record<string, string> = {}) => ({
  SRC_URL: 'http://a/src', OUT_URL: 'http://a/out?name={name}', OUT_MP_URL: 'http://a/{op}?name={name}', BEAT_URL: 'http://a/beat', DONE_URL: 'http://a/done',
  WORK_DIR: path.join(dir, 'work'), HEADERS: JSON.stringify({ 'CF-Access-Client-Id': 'x' }), ...over,
});
const probeFile = (file: string) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }).stdout);

describe.skipIf(!haveFfmpeg)('真的跑 ffmpeg（用合成的短片）', () => {
  let hevc: Buffer, h264: Buffer, tiny: Buffer, rotated: Buffer;
  beforeAll(() => {
    const mk = (name: string, args: string[]) => { const p = path.join(dir, name); expect(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, p]).status).toBe(0); return readFileSync(p); };
    const src = ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=duration=3'];
    hevc = mk('hevc.mov', [...src, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac', '-shortest']);
    h264 = mk('h264.mp4', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    tiny = mk('tiny.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    // 手機直拍：編碼成橫的 320×180，加上「顯示時轉 90 度」的旋轉資訊
    const landscape = path.join(dir, 'landscape.mp4');
    expect(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x180:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', landscape]).status).toBe(0);
    rotated = mk('rotated.mp4', ['-display_rotation:v:0', '90', '-i', landscape, '-c', 'copy']);
  });

  it('HEVC（iPhone 預設）→ 轉成 H.264 yuv420p、faststart，並產出 poster 與回報', async () => {
    const a = fakeAdmin(hevc);
    const r = await run(envFor(), { fetch: a.f });
    expect(r).toEqual({ ok: true, mode: 'transcode' });
    const mp4 = path.join(dir, 'out-hevc.mp4'); await import('node:fs').then((fs) => fs.writeFileSync(mp4, a.stored.get('1080p.mp4')!));
    const p = probeFile(mp4);
    const v = p.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect(v).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p' });
    // faststart：moov 在 mdat 之前
    const b = a.stored.get('1080p.mp4')!;
    expect(b.indexOf('moov')).toBeGreaterThan(0); expect(b.indexOf('moov')).toBeLessThan(b.indexOf('mdat'));
    expect(a.stored.get('poster.jpg')!.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(a.done).toMatchObject({ ok: true, mode: 'transcode', width: 320, height: 240, duration: 3 });
    expect((a.done as { bytes: number }).bytes).toBe(b.length);
  });
  it('本來就相容的 H.264 → 只 remux（不重編碼）', async () => {
    const a = fakeAdmin(h264);
    expect(await run(envFor(), { fetch: a.f })).toEqual({ ok: true, mode: 'remux' });
    expect(a.done).toMatchObject({ ok: true, mode: 'remux' });
  });
  it('手機直拍（旋轉資訊）→ remux，回報的寬高是直的（比例存成 9/16，不是 16/9）', async () => {
    const a = fakeAdmin(rotated);
    expect(await run(envFor(), { fetch: a.f })).toEqual({ ok: true, mode: 'remux' });
    expect(a.done).toMatchObject({ ok: true, width: 180, height: 320 });
  });
  it('成品 mp4 分段上傳（每段不超過 PART_BYTES）：不再一次 PUT，超過 Workers 的請求大小上限也上得去', async () => {
    const a = fakeAdmin(hevc);
    const r = await run(envFor({ PART_BYTES: String(16 * 1024) }), { fetch: a.f });
    expect(r.ok).toBe(true);
    const n = Number(a.events.find((e) => e.startsWith('complete:'))!.split(':')[1]);
    expect(n).toBeGreaterThan(1);
    expect((a.done as { bytes: number }).bytes).toBe(a.stored.get('1080p.mp4')!.length);
  });
  it('轉碼期間送心跳（後台的看門狗靠它分辨「慢」和「死」）', async () => {
    const a = fakeAdmin(hevc);
    await run(envFor({ BEAT_MS: '20' }), { fetch: a.f });
    expect(a.beats).toBeGreaterThan(0);
  });
  it('回報結果之前先放掉「忙碌」：後台收到失敗而立刻重派時，容器不能回 409', async () => {
    const a = fakeAdmin(Buffer.from('壞的'));
    const order: string[] = [];
    await run(envFor(), { fetch: (async (u: string, i?: RequestInit) => { if (String(u).endsWith('/done')) order.push('report'); return a.f(u as never, i); }) as never, beforeReport: () => order.push('idle') });
    expect(order).toEqual(['idle', 'report']);
  });
  it('比 2 秒短的影片也能出 poster', async () => {
    const a = fakeAdmin(tiny);
    expect((await run(envFor(), { fetch: a.f })).ok).toBe(true);
    expect(a.stored.has('poster.jpg')).toBe(true);
  });
  it('原檔不是影片 → 回報失敗與原因（不是默默結束）', async () => {
    const a = fakeAdmin(Buffer.from('這不是影片'));
    const r = await run(envFor(), { fetch: a.f });
    expect(r.ok).toBe(false);
    expect(a.done).toMatchObject({ ok: false, error: expect.stringContaining('ffprobe') });
    expect(a.stored.size).toBe(0);
  });
  it('下載失敗 → 回報失敗', async () => {
    const a = fakeAdmin(null);
    expect((await run(envFor(), { fetch: a.f })).ok).toBe(false);
    expect(a.done).toMatchObject({ ok: false, error: expect.stringContaining('下載原檔失敗 404') });
  });
  it('跑完不留工作檔', async () => {
    await run(envFor(), { fetch: fakeAdmin(h264).f });
    const w = path.join(dir, 'work');
    expect(!existsSync(w) || (await import('node:fs')).readdirSync(w).length === 0).toBe(true);
    void statSync;
  });
});
