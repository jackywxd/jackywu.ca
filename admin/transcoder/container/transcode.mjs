/**
 * 轉碼器（在容器裡跑）。參數與 scripts/media/encode-video.sh 完全相同：
 *   已是 H.264 + yuv420p + 寬 ≤ 1920 + AAC（或沒有音軌）→ 只 remux（無損、瞬間）
 *   其他 → libx264 high@4.1 slow crf23、縮到 ≤1920、AAC 128k、faststart、yuv420p
 * 流程：從後台下載原檔 → 轉 → 抽 poster → 上傳成品 → 回報。任何一步失敗都回報（不是默默結束）。
 * 容器沒有任何 R2 憑證：只能用後台給的、有時效且只對這一個影片有效的簽章網址。
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

/** ffprobe -show_streams -show_format -of json 的輸出 → 我們要的欄位 */
export function parseProbe(json) {
  const v = json.streams?.find((s) => s.codec_type === 'video');
  const a = json.streams?.find((s) => s.codec_type === 'audio');
  if (!v) throw new Error('檔案裡沒有影像軌');
  return {
    vcodec: v.codec_name, pixfmt: v.pix_fmt, width: Number(v.width), height: Number(v.height),
    acodec: a?.codec_name ?? 'none', duration: Number(json.format?.duration ?? v.duration ?? 0),
  };
}

export const isCompatible = (p) => p.vcodec === 'h264' && p.pixfmt === 'yuv420p' && p.width <= 1920 && (p.acodec === 'aac' || p.acodec === 'none');

export function ffmpegArgs(input, output, p) {
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input];
  return isCompatible(p)
    ? [...base, '-c', 'copy', '-movflags', '+faststart', output]
    : [...base, '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'slow', '-crf', '23',
        '-vf', "scale='min(1920,iw)':-2", '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', output];
}

/** poster 取第 2 秒；比 2 秒短的影片取開頭（encode-video.sh 在這種情況會失敗，這裡不允許失敗） */
export const posterArgs = (input, output, duration) =>
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ss', duration >= 2.5 ? '00:00:02' : '00:00:00', '-frames:v', '1', '-q:v', '3', output];

function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} 結束碼 ${code}：${err.slice(-600)}`))));
  });
}

async function download(fetchFn, url, headers, dest) {
  const r = await fetchFn(url, { headers });
  if (!r.ok || !r.body) throw new Error(`下載原檔失敗 ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
  const want = Number(r.headers.get('content-length'));
  if (want && statSync(dest).size !== want) throw new Error(`下載不完整：${statSync(dest).size}/${want} 位元組`);
}

async function upload(fetchFn, url, headers, file, type) {
  const size = statSync(file).size;
  const r = await fetchFn(url, { method: 'PUT', headers: { ...headers, 'content-type': type, 'content-length': String(size) }, body: Readable.toWeb(createReadStream(file)), duplex: 'half' });
  if (!r.ok) throw new Error(`上傳 ${path.basename(file)} 失敗 ${r.status}：${(await r.text()).slice(0, 200)}`);
  return size;
}

/**
 * env: { SRC_URL, OUT_URL（含 {name} 佔位）, DONE_URL, HEADERS（JSON，Access 服務憑證）, WORK_DIR }
 * deps: { fetch, exec } 可注入，測試不必起伺服器
 */
export async function run(env, deps = {}) {
  const fetchFn = deps.fetch ?? fetch, sh = deps.exec ?? exec;
  const headers = env.HEADERS ? JSON.parse(env.HEADERS) : {};
  const work = path.join(env.WORK_DIR ?? '/tmp/work', String(Date.now()));
  mkdirSync(work, { recursive: true });
  const report = (body) => fetchFn(env.DONE_URL, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { if (!r.ok) throw new Error(`回報失敗 ${r.status}：${(await r.text()).slice(0, 200)}`); });
  try {
    const src = path.join(work, 'in'), mp4 = path.join(work, '1080p.mp4'), poster = path.join(work, 'poster.jpg');
    await download(fetchFn, env.SRC_URL, headers, src);
    const probe = parseProbe(JSON.parse(await sh('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', src])));
    const mode = isCompatible(probe) ? 'remux' : 'transcode';
    await sh('ffmpeg', ffmpegArgs(src, mp4, probe));
    await sh('ffmpeg', posterArgs(mp4, poster, probe.duration));
    const out = JSON.parse(await sh('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]));
    const final = parseProbe(out);
    const bytes = await upload(fetchFn, env.OUT_URL.replace('{name}', '1080p.mp4'), headers, mp4, 'video/mp4');
    await upload(fetchFn, env.OUT_URL.replace('{name}', 'poster.jpg'), headers, poster, 'image/jpeg');
    await report({ ok: true, mode, duration: Math.max(1, Math.round(final.duration)), bytes, width: final.width, height: final.height });
    return { ok: true, mode };
  } catch (e) {
    // 先回報再結束：後台才知道失敗與原因，而不是等看門狗逾時
    await report({ ok: false, error: String(e.message ?? e).slice(0, 500) }).catch(() => {});
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await run(process.env);
  process.exit(r.ok ? 0 : 1);
}
