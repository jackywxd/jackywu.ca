/**
 * 遷移第三階段：圖片落地、失連稽核、連結改寫。
 *
 * （方案原本把「媒體」與「連結」分成兩階段，這裡合併 —— 它們改的是同一批
 * 檔案的正文，分開只是多讀寫一輪，沒有好處。）
 *
 * 本地圖  → 從舊 repo 複製進文章自己的資料夾，引用改成相對路徑
 * 遠端圖  → HEAD 稽核；活的下載落地，死的換成 <MissingImage> 並記進 frontmatter
 * 內鏈    → /blog/… 依 manifest 查到新 slug，改成 /tales/<slug>/
 * 外鏈    → 補 rel="noopener noreferrer"
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import YAML from 'yaml';

const OLD = process.env.OLD_SITE ?? '/Users/jackywxd/repos/jackywu.ca';
const DEST = 'src/content/tales';
const dry = process.argv.includes('--dry-run');
const offline = process.argv.includes('--offline');

const manifest = JSON.parse(readFileSync('migration/content-manifest.json', 'utf8'));
const decisions = YAML.parse(readFileSync('migration-decisions.yaml', 'utf8'));
const byFile = new Map(manifest.posts.map((p) => [p.file, p]));
/** 舊 URL（已解碼）→ 新路徑，供內鏈改寫 */
const urlMap = new Map();
for (const d of decisions) {
  if (d.action === 'HOLD' || d.action === 'retire') continue;
  const p = byFile.get(d.old);
  if (p) urlMap.set(decodeURIComponent(p.oldUrl), `/tales/${d.slug}/`);
}

/** /static/2020/x.png → 舊 repo 的 public/static/2020/x.png */
const resolveLocal = (ref, postFile) => {
  const clean = ref.split(/[?#]/)[0];
  const cands = clean.startsWith('/')
    ? [join(OLD, 'public', clean)]
    : [join(OLD, dirname(postFile), clean), join(OLD, 'public/static', clean.replace(/^\.\//, ''))];
  return cands.find(existsSync) ?? null;
};

const safeName = (p) => basename(p).replace(/[^\w.-]/g, '_');
const report = { copied: 0, missingLocal: [], alive: 0, dead: [], linksRewritten: 0, files: 0, gpxLinked: 0, gpxUnmapped: [] };

/** 已升格為 routes 條目的 GPX：檔名 → route id */
const gpxToRoute = new Map();
{
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync('src/content/routes').filter((x) => x.endsWith('.yaml'))) {
    const y = YAML.parse(readFileSync(join('src/content/routes', f), 'utf8'));
    if (y?.gpx) gpxToRoute.set(String(y.gpx).split('/').pop(), f.replace(/\.yaml$/, ''));
  }
  // 舊站的檔名與新條目的檔名不同，補上對照
  gpxToRoute.set('chakamus-helm-glacier-castle-tower-panorama-ridge.gpx', 'castle-tower-loop');
}
const brokenByPost = new Map();

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const { createHash } = await import('node:crypto');

/** 下載遠端圖到文章資料夾。Google 相簿的 URL 沒有副檔名，靠 content-type 判斷。 */
const download = async (url, outDir, dryRun) => {
  try {
    // 已抓過就不再抓 —— 檔名是 URL 的雜湊，重跑管線不該再打 21 次外部請求
    const guess = `remote-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
    const hit = existsSync(outDir) && (await import('node:fs')).readdirSync(outDir).find((f) => f.startsWith(guess));
    if (hit) return hit;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!r.ok) return null;
    const ext = EXT[(r.headers.get('content-type') ?? '').split(';')[0]] ?? '.jpg';
    const name = `remote-${createHash('sha1').update(url).digest('hex').slice(0, 8)}${ext}`;
    if (!dryRun) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, name), Buffer.from(await r.arrayBuffer()));
    }
    return name;
  } catch { return null; }
};

const head = async (url) => {
  if (offline) return 0;
  for (let i = 0; i < 3; i++) {
    try {
      const c = AbortSignal.timeout(5000);
      const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: c, redirect: 'follow' });
      if (r.ok || r.status === 206) return r.status;
      if (r.status === 403 || r.status === 404) return r.status;
    } catch { /* 重試 */ }
  }
  return 0;
};

for (const d of decisions) {
  if (d.action === 'HOLD' || d.action === 'retire') continue;
  const p = byFile.get(d.old);
  const outDir = join(DEST, d.slug);
  const outFile = join(outDir, 'index.mdx');
  if (!existsSync(outFile)) continue;

  const whole = readFileSync(outFile, 'utf8');
  // frontmatter 與正文分開處理：legacy.url 存的就是舊網址，
  // 連結改寫若掃到它會把轉址表的來源自己改掉。
  const fmMatch = whole.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  let fm = fmMatch ? fmMatch[1] : '';
  let text = fmMatch ? fmMatch[2] : whole;
  const before = whole;
  const broken = [];

  // ── 本地圖：複製進文章資料夾，改成相對引用 ──
  for (const ref of new Set(p.localImages)) {
    const src = resolveLocal(ref, d.old);
    if (!src) { report.missingLocal.push(`${d.slug}: ${ref}`); continue; }
    const name = safeName(src);
    if (!dry) { mkdirSync(outDir, { recursive: true }); copyFileSync(src, join(outDir, name)); }
    text = text.split(ref).join(`./${name}`);
    report.copied++;
  }

  // ── 遠端圖：稽核 ──
  for (const url of (offline ? [] : new Set(p.remoteImages))) {
    const status = await head(url);
    if (status === 200 || status === 206) {
      // 活的就下載落地。熱鏈到別人的 CDN 本來就脆弱 ——
      // 現在能開不代表明年能開，而且那是 Google 相簿不是圖床。
      const local = await download(url, outDir, dry);
      if (local) { text = text.split(url).join(`./${local}`); report.alive++; continue; }
      report.dead.push(`${d.slug}: 下載失敗 ${url.slice(0, 72)}…`);
    }
    report.dead.push(`${d.slug}: ${status} ${url.slice(0, 72)}…`);
    broken.push(url);
    // 整個 <img …src="url"…/> 或 markdown 圖語法換成佔位
    const placeholder = `<MissingImage original="${url}" hint="${(d._title ?? '').replace(/"/g, '')}" />`;
    text = text
      .replace(new RegExp(`<(?:img|Image)\\b[^>]*?src=["']${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?/?>`, 'g'), placeholder)
      .replace(new RegExp(`!\\[[^\\]]*\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^)]*\\)`, 'g'), placeholder);
  }
  if (broken.length) brokenByPost.set(d.slug, broken);

  // ── GPX 引用 → 輿圖條目 ──
  // 舊站把 GPX 當附件放在 /static/files/。新站的軌跡是 routes collection 的
  // 一級條目（有路線圖、海拔剖面、統計），文章應該連過去而不是連檔案。
  for (const m of [...text.matchAll(/[^\s"'()]*\.gpx/gi)]) {
    const base = m[0].split('/').pop();
    const routeId = gpxToRoute.get(base);
    if (routeId) {
      text = text.split(m[0]).join(`/routes/${routeId}/`);
      report.gpxLinked++;
    } else {
      report.gpxUnmapped.push(`${d.slug}: ${base}`);
    }
  }

  // ── 內鏈改寫 ──
  for (const [oldUrl, newUrl] of urlMap) {
    const enc = encodeURI(oldUrl);
    for (const variant of new Set([oldUrl, enc])) {
      if (text.includes(variant)) {
        text = text.split(variant).join(newUrl.replace(/\/$/, ''));
        report.linksRewritten++;
      }
    }
  }

  // ── 失連清單寫回 frontmatter ──
  if (broken.length) {
    const list = broken.map((u) => `    - '${u}'`).join('\n');
    fm = fm.replace(/(\nlegacy:\n(?:  .*\n)*)/, `$1  brokenImages:\n${list}\n`);
  }

  // ── MissingImage 匯入 ──
  if (text.includes('<MissingImage') && !text.includes('import MissingImage')) {
    text = `\nimport MissingImage from '@/components/mdx/MissingImage.astro';\n${text}`;
  }

  const out = fm + text;
  if (out !== before) { report.files++; if (!dry) writeFileSync(outFile, out); }
}

console.log(`${dry ? '[dry-run] ' : ''}媒體與連結`);
console.log(`  本地圖落地      ${report.copied}`);
console.log(`  遠端圖仍活著    ${report.alive}`);
console.log(`  遠端圖已失連    ${report.dead.length}`);
console.log(`  內鏈改寫        ${report.linksRewritten}`);
console.log(`  GPX → 輿圖      ${report.gpxLinked}`);
console.log(`  改動檔案        ${report.files}`);
if (report.gpxUnmapped.length) {
  console.log(`\n  ⚠ 找不到對應輿圖條目的 GPX ${report.gpxUnmapped.length}（先跑 pnpm gpx 匯入）:`);
  for (const x of report.gpxUnmapped) console.log(`     ${x}`);
}
if (report.missingLocal.length) {
  console.log(`\n  ⚠ 找不到來源的本地圖 ${report.missingLocal.length}:`);
  for (const x of report.missingLocal.slice(0, 12)) console.log(`     ${x}`);
}
if (report.dead.length) {
  console.log(`\n  失連清單（已記進各文的 legacy.brokenImages，可從 Google 相簿撈回）:`);
  for (const x of report.dead.slice(0, 25)) console.log(`     ${x}`);
}
if (!dry) {
  mkdirSync('migration', { recursive: true });
  writeFileSync('migration/media-report.json', JSON.stringify({
    copied: report.copied, alive: report.alive,
    dead: report.dead, missingLocal: report.missingLocal,
    brokenByPost: Object.fromEntries(brokenByPost),
  }, null, 2));
  console.log('\n寫入 migration/media-report.json');
}
