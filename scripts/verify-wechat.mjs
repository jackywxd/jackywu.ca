/**
 * postbuild：檢查每個有分享圖的頁面，其 <body> 裡第一張 <img> 符合微信的挑圖規則。
 *
 * 微信不讀 og:image —— 它取 <title> 與「DOM 順序第一張、寬高皆 ≥300px 的 <img>」。
 * 這三條錯一條就抓不到圖，而且完全靜默：頁面看起來正常，只有分享出去才發現縮圖是空的。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const strict = process.argv.includes('--strict');
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : extname(p) === '.html' && out.push(p);
  }
  return out;
}

const problems = [];
let checked = 0;
for (const f of walk('dist')) {
  const html = readFileSync(f, 'utf8');
  if (!/property="og:image"/.test(html)) continue;   // 沒宣告分享圖的頁面不管
  checked++;
  const body = html.slice(html.indexOf('<body'));
  const first = body.match(/<img[^>]*>/)?.[0] ?? '';
  const name = f.replace(/^dist\//, '');
  if (!first) problems.push(`${name}: <body> 裡沒有任何 <img>`);
  else if (!/\/wx\//.test(first)) problems.push(`${name}: 第一張圖不是 /wx/ 縮圖 → ${first.slice(0, 90)}`);
  else if (!/width="600"/.test(first) || !/height="600"/.test(first)) problems.push(`${name}: 縮圖不是 600×600`);
  else if (/loading="lazy"/.test(first)) problems.push(`${name}: 縮圖用了 loading="lazy"（移出視窗的 lazy 圖永遠不會載入）`);
  else if (/srcset=/.test(first)) problems.push(`${name}: 縮圖用了 srcset（微信只看 src）`);
  else if (!/\.jpe?g|\.png/.test(first)) problems.push(`${name}: 縮圖不是 JPEG/PNG（舊版 X5 內核對 WebP 不穩）`);
}

console.log(`微信首圖：檢查 ${checked} 個有分享圖的頁面`);
if (!problems.length) { console.log('✓ 全部符合挑圖規則'); process.exit(0); }
console.error(`✗ ${problems.length} 個問題：`);
for (const p of problems) console.error(`   ${p}`);
process.exit(strict ? 1 : 0);
