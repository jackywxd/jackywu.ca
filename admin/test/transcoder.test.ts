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
});

/** 假的後台：原檔從這裡讀，成品寫到這裡，結果回報到這裡 */
function fakeAdmin(source: Buffer | null) {
  const stored = new Map<string, Buffer>(); let done: Record<string, unknown> | null = null;
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.pathname === '/src') return source ? new Response(new Uint8Array(source), { headers: { 'content-length': String(source.length) } }) : new Response('nope', { status: 404 });
    if (u.pathname === '/out' && init.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const c of init.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      stored.set(u.searchParams.get('name')!, Buffer.concat(chunks));
      return new Response('ok');
    }
    if (u.pathname === '/done') { done = JSON.parse(String(init.body)); return new Response('ok'); }
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, stored, get done() { return done; } };
}
const envFor = () => ({ SRC_URL: 'http://a/src', OUT_URL: 'http://a/out?name={name}', DONE_URL: 'http://a/done', WORK_DIR: path.join(dir, 'work'), HEADERS: JSON.stringify({ 'CF-Access-Client-Id': 'x' }) });
const probeFile = (file: string) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }).stdout);

describe.skipIf(!haveFfmpeg)('真的跑 ffmpeg（用合成的短片）', () => {
  let hevc: Buffer, h264: Buffer, tiny: Buffer;
  beforeAll(() => {
    const mk = (name: string, args: string[]) => { const p = path.join(dir, name); expect(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, p]).status).toBe(0); return readFileSync(p); };
    const src = ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=duration=3'];
    hevc = mk('hevc.mov', [...src, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac', '-shortest']);
    h264 = mk('h264.mp4', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
    tiny = mk('tiny.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
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
