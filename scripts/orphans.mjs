/**
 * 清點孤兒檔案 —— 只報告，不刪。
 *
 * 刪東西的後果在這個站是看不見的：
 *   · R2 上的影片刪了條目還在，繼續佔儲存費
 *   · 路線的衍生 SVG（輪廓/縮圖/剖面）不會跟著 yaml 一起消失
 *   · 文章資料夾裡沒被引用的圖會一直躺在 git 裡
 *
 * 這支只列出「疑似沒人用」的東西並印出刪除指令，**不代你執行**。
 * 刪除按 id 逐一進行，絕不用萬用字元 —— 模糊比對用在查詢頂多是找錯，
 * 用在刪除是直接毀掉東西。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

import YAML from 'yaml';

const IMG = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

/** 遞迴列出某副檔名的檔案（內容目錄已以年分層） */
const walkFiles = (dir, test, out = [], base = dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkFiles(p, test, out, base);
    else if (test(e)) out.push({ path: p, rel: p.slice(base.length + 1) });
  }
  return out;
};

const report = { images: [], routeFiles: [], reelFiles: [], r2: [] };

// ── 文章資料夾裡沒被 index.mdx 引用的圖 ──
const TALES = 'src/content/tales';
// 內容已以年分層，文章資料夾在 tales/<年>/<slug>/
for (const { path: entry } of walkFiles(TALES, (f) => /^index\.mdx?$/.test(f))) {
  const dir = join(entry, '..');
  const text = readFileSync(entry, 'utf8');
  for (const f of readdirSync(dir)) {
    if (!IMG.test(f)) continue;
    // markdown ![](./x)、HTML src="./x"、frontmatter hero: ./x、import x from './y'
    if (!text.includes(f)) report.images.push(join(dir, f));
  }
}

// ── 路線的衍生檔沒有對應的 yaml ──
const ROUTES = 'src/content/routes';
const routeIds = new Set(
  walkFiles(ROUTES, (f) => f.endsWith('.yaml')).map((x) => x.rel.replace(/\.yaml$/, '')),
);
for (const { path, rel } of walkFiles(ROUTES, (f) => !f.endsWith('.yaml'))) {
  const id = rel.replace(/\.(thumb\.svg|profile\.svg|svg|gpx)$/, '');
  if (!routeIds.has(id)) report.routeFiles.push(path);
}

// ── 影片 poster 沒有對應的 yaml ──
const REEL = 'src/content/reel';
const reelEntries = walkFiles(REEL, (f) => f.endsWith('.yaml'))
  .map((x) => YAML.parse(readFileSync(x.path, 'utf8')));
const reelIds = new Set(reelEntries.map((e) => e.id));
const posterNames = new Set(reelEntries.map((e) => basename(String(e.poster ?? ''))));
for (const { path } of walkFiles(REEL, (f) => !f.endsWith('.yaml'))) {
  if (!posterNames.has(basename(path))) report.reelFiles.push(path);
}

// ── R2 上有物件但站上沒有條目 ──
if (!process.argv.includes('--no-r2')) {
  const { execSync } = await import('node:child_process');
  try {
    const out = execSync(
      'npx --no-install wrangler r2 bucket object list zhuiyunzhuxue-media --prefix video/ --remote 2>/dev/null',
      { encoding: 'utf8' },
    );
    const keys = [...out.matchAll(/"key"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const k of keys) {
      const id = k.split('/')[1];
      if (id && !reelIds.has(id)) report.r2.push(k);
    }
  } catch {
    console.log('（跳過 R2：wrangler 查詢失敗，用 --no-r2 可靜音）\n');
  }
}

// ── 報告 ──
const bytes = (p) => { try { return statSync(p).size; } catch { return 0; } };
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
let total = 0;

const section = (title, items, cmd) => {
  if (!items.length) { console.log(`✓ ${title}：無`); return; }
  const size = items.reduce((a, p) => a + (typeof p === 'string' && existsSync(p) ? bytes(p) : 0), 0);
  total += size;
  console.log(`\n⚠ ${title}：${items.length} 個${size ? `（${kb(size)}）` : ''}`);
  for (const p of items) console.log(`     ${p}`);
  console.log(`\n   確認要刪的話，逐個執行：`);
  for (const p of items) console.log(`     ${cmd(p)}`);
};

console.log('孤兒清點（只報告，不刪）\n');
section('文章資料夾裡沒被引用的圖', report.images, (p) => `rm ${JSON.stringify(p)}`);
section('沒有 yaml 的路線衍生檔', report.routeFiles, (p) => `rm ${JSON.stringify(p)}`);
section('沒有 yaml 的影片 poster', report.reelFiles, (p) => `rm ${JSON.stringify(p)}`);
section('R2 上沒有對應條目的物件', report.r2,
  (k) => `npx wrangler r2 object delete zhuiyunzhuxue-media/${k} --remote`);

const n = report.images.length + report.routeFiles.length + report.reelFiles.length + report.r2.length;
console.log(n ? `\n合計 ${n} 個疑似孤兒${total ? `，本地佔 ${kb(total)}` : ''}。` : '\n乾淨。');
console.log('刪之前先確認 —— 這支不會替你動手。');
