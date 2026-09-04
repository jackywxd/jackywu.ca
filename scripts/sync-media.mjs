/**
 * 媒體雙向同步：讓 R2 與站上的內容彼此對齊。
 *
 *   pnpm sync            兩個方向都檢查，只報告（預設）
 *   pnpm sync --push     把站上有、R2 沒有的傳上去
 *   pnpm sync --pull     把 R2 有、站上沒有的補成內容條目
 *   pnpm sync --prune    刪掉 R2 上已經沒有條目的物件（破壞性，逐一列出後才刪）
 *
 * 「在不在」直接打公開網域驗 —— 那是使用者真正會走的路徑，不是代理指標。
 * 列舉需要 R2 存取金鑰（Cloudflare 的 REST 沒有物件列表端點）；沒有金鑰時
 * 自動降級成單向推送，並印出怎麼開啟。
 *
 * 刪除一律按確切的 key 逐一進行，絕不用萬用字元或前綴 ——
 * 模糊比對用在查詢頂多是找錯，用在刪除是直接毀掉東西。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { list, get, canList, HOWTO } from './lib/r2.mjs';

const REEL = 'src/content/reel';
const ORIGIN = 'https://media.jackywu.ca';
const BUCKET = 'zhuiyunzhuxue-media';
const SOURCE_DIR = process.env.MEDIA_SOURCE ?? 'media/source';
const arg = (k) => process.argv.includes(`--${k}`);
const [push, pull, prune] = [arg('push'), arg('pull'), arg('prune')];

// 內容已以年分層
const walkYaml = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walkYaml(p, out) : e.endsWith('.yaml') && out.push(p);
  }
  return out;
};
const entries = walkYaml(REEL).map((f) => ({ file: f, ...YAML.parse(readFileSync(f, 'utf8')) }));
const byId = new Map(entries.map((e) => [e.id, e]));

const head = async (key) => {
  try {
    const r = await fetch(`${ORIGIN}/${key}`, { method: 'HEAD', redirect: 'follow' });
    return { ok: r.ok, size: Number(r.headers.get('content-length') ?? 0) };
  } catch { return { ok: false, size: 0 }; }
};

const probe = (url) => {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
      '-of', 'default=nw=1', url], { encoding: 'utf8', timeout: 60000 });
    const n = (k) => Number(out.match(new RegExp(`${k}=([\\d.]+)`))?.[1] ?? 0);
    return { w: n('width'), h: n('height'), duration: Math.round(n('duration')) };
  } catch { return null; }
};

// ── 站 → R2 ──
const missing = [], mismatched = [], present = [];
for (const e of entries) {
  const key = `video/${e.id}/1080p.mp4`;
  const r = await head(key);
  if (!r.ok) { missing.push({ e, key }); continue; }
  if (e.bytes && Math.abs(r.size - e.bytes) > 1024) mismatched.push({ e, key, actual: r.size });
  else present.push({ e, size: r.size });
}

// ── R2 → 站（需要列舉） ──
let remoteOnly = [];
let remote = null;
if (canList()) {
  remote = await list(BUCKET, 'video/');
  const ids = new Set(remote.map((o) => o.key.split('/')[1]).filter(Boolean));
  remoteOnly = [...ids].filter((id) => !byId.has(id));
}

console.log(`媒體同步 · ${ORIGIN}\n`);
console.log(`  站上條目 ${entries.length} · 已對齊 ${present.length} · 站有R2無 ${missing.length}`
  + ` · 大小不符 ${mismatched.length}`
  + (canList() ? ` · R2有站無 ${remoteOnly.length}` : ' · R2→站 未檢查'));
console.log('');
for (const p of present) console.log(`  ✓ ${p.e.id.padEnd(24)} ${(p.size / 1048576).toFixed(1)} MB`);

if (mismatched.length) {
  console.log(`\n⚠ yaml 的 bytes 與實際不符（頁面會標錯大小）：`);
  for (const m of mismatched) console.log(`   ${m.e.id}: yaml ${m.e.bytes} → 實際 ${m.actual}（改 ${m.e.file}）`);
}

// ── 推 ──
if (missing.length) {
  console.log(`\n⚠ 站上有條目、R2 上沒有檔案：`);
  for (const m of missing) {
    const src = ['mp4', 'mov', 'MP4', 'MOV'].map((x) => join(SOURCE_DIR, `${m.e.id}.${x}`)).find(existsSync);
    console.log(`   ${m.e.id}  ${src ? `← ${src}` : `（把來源放到 ${SOURCE_DIR}/${m.e.id}.mp4）`}`);
    if (src && push) execFileSync('./scripts/media/encode-video.sh', [src, m.e.id], { stdio: 'inherit' });
  }
  if (!push) console.log(`   → pnpm sync --push`);
}

// ── 拉 ──
if (!canList()) {
  console.log(`\n⚠ R2 → 站 這個方向沒檢查（需要 R2 存取金鑰）`);
  console.log(HOWTO);
} else if (remoteOnly.length) {
  console.log(`\n⚠ R2 上有檔案、站上沒有條目：`);
  for (const id of remoteOnly) {
    const url = `${ORIGIN}/video/${id}/1080p.mp4`;
    const meta = probe(url);
    const size = remote.find((o) => o.key === `video/${id}/1080p.mp4`)?.size ?? 0;
    console.log(`   ${id}  ${(size / 1048576).toFixed(1)} MB${meta ? ` · ${meta.w}x${meta.h} · ${meta.duration}s` : ''}`);
    if (!pull) continue;

    const posterKey = `video/${id}/poster.jpg`;
    const poster = await get(BUCKET, posterKey);
    const yr = new Date().getFullYear();
    mkdirSync(join(REEL, String(yr)), { recursive: true });
    const posterName = `${id}-poster.jpg`;
    if (poster) writeFileSync(join(REEL, String(yr), posterName), poster);

    const g = (a, b) => (b ? g(b, a % b) : a);
    const d = meta ? g(meta.w, meta.h) : 0;
    const ratio = meta && d ? `${meta.w / d}/${meta.h / d}` : '16/9';
    writeFileSync(join(REEL, String(yr), `${id}.yaml`), [
      `title: ''                 # 待填`,
      `id: ${id}`,
      poster ? `poster: ./${posterName}` : `# poster: ./${id}-poster.jpg   # R2 上沒有 poster，自己補一張`,
      `posterAlt: ''             # 待填`,
      `duration: ${meta?.duration ?? 0}`,
      `bytes: ${size}`,
      `ratio: '${['16/9', '9/16', '4/3', '1/1'].includes(ratio) ? ratio : '16/9'}'`,
      `realm: snow               # run | snow | road | wild`,
      `date: ${new Date().toISOString().slice(0, 10)}   # 待確認`,
      '',
    ].join('\n'));
    console.log(`      → 已建 ${REEL}/${yr}/${id}.yaml${poster ? ` 與 ${posterName}` : ''}，填 title / posterAlt / realm / date`);
  }
  if (!pull) console.log(`   → pnpm sync --pull  會建好條目骨架`);
}

// ── 刪 ──
if (canList()) {
  const liveKeys = new Set(entries.flatMap((e) => [`video/${e.id}/1080p.mp4`, `video/${e.id}/poster.jpg`]));
  const orphan = remote.filter((o) => !liveKeys.has(o.key));
  if (orphan.length) {
    console.log(`\n⚠ R2 上沒有任何條目對應的物件：`);
    for (const o of orphan) console.log(`   ${o.key}  ${(o.size / 1048576).toFixed(1)} MB`);
    if (prune) {
      console.log(`\n   逐一刪除（按確切 key）：`);
      for (const o of orphan) {
        console.log(`   → ${o.key}`);
        execFileSync('npx', ['--no-install', 'wrangler', 'r2', 'object', 'delete', `${BUCKET}/${o.key}`, '--remote'], { stdio: 'inherit' });
      }
    } else {
      console.log(`\n   確認後執行：pnpm sync --prune`);
    }
  }
}

const drift = missing.length + mismatched.length + remoteOnly.length;
if (drift) process.exitCode = push || pull || prune ? 0 : 1;
else if (canList()) console.log(`\n✓ 兩個方向都已對齊。`);
// 沒金鑰時只檢查了一個方向 —— 不能說「已對齊」，那是報假的乾淨
else console.log(`\n✓ 站 → R2 已對齊（R2 → 站 未檢查，見上）。`);
