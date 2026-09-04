/**
 * postbuild：og 圖被置中裁成方形之後，關鍵內容還在不在。
 *
 * 微信取 og:image，然後裁成方形（1200×630 → 中央 630×630）才顯示。
 * 早一版的 og 把字全排在左邊 40%，裁完落在空白宣紙上 —— 微信卡片的縮圖
 * 是一張什麼都沒有的米色方塊，而站上每一項檢查都是綠的。
 *
 * 做法：數「真正的墨」（與背景亮度差 > 100 的像素，低對比浮水印不算），
 * 比較中央方形佔全圖的比例。中軸構圖會接近 100%，偏一邊的構圖會塌下來。
 *
 * 校準（實測）：舊版線上圖 首頁 12.7% / 文章 52.0%；新版全部 100.0%。
 */
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const strict = process.argv.includes('--strict');
const MIN = 0.90;
const CONTRAST = 100;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : p.endsWith('.png') && out.push(p);
  }
  return out;
}

async function inkIn(file, left, width, height) {
  const { data } = await sharp(file).extract({ left, top: 0, width, height })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  const bg = hist.indexOf(Math.max(...hist));
  let n = 0;
  for (const v of data) if (Math.abs(v - bg) > CONTRAST) n++;
  return n;
}

const files = walk('dist/og');
const bad = [];
let worst = 1;
for (const f of files) {
  const { width, height } = await sharp(f).metadata();
  const side = Math.min(width, height);
  const all = await inkIn(f, 0, width, height);
  const mid = await inkIn(f, Math.round((width - side) / 2), side, height);
  const r = all ? mid / all : 1;
  if (r < worst) worst = r;
  if (r < MIN) bad.push(`${f.replace(/^dist\//, '')}: 置中裁切只保住 ${(r * 100).toFixed(1)}% 的內容`);
}

console.log(`og 置中裁切：檢查 ${files.length} 張，最低保留 ${(worst * 100).toFixed(1)}%（門檻 ${MIN * 100}%）`);
if (!bad.length) { console.log('✓ 裁成方形後內容都還在'); process.exit(0); }
console.error(`✗ ${bad.length} 張裁完會缺內容：`);
for (const b of bad) console.error(`   ${b}`);
process.exit(strict ? 1 : 0);
