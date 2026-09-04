/**
 * postbuild：掃 dist 的 HTML，找出「實際渲染出來、但不在子集裡」的中文字。
 *
 * build-fonts.mjs 掃的是原始碼，這支掃的是真正送到瀏覽器的東西 ——
 * 補上「掃原始碼會漏掉」的那個缺口。漏字不會變成豆腐塊（有系統字兜底），
 * 所以沒有這支檢查就是靜默降級，看不出來。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;
const MANIFEST = 'src/assets/fonts/generated/manifest.json';
const strict = process.argv.includes('--strict');

if (!existsSync(MANIFEST)) {
  console.error('✗ 找不到字型 manifest —— 先跑 pnpm fonts:build');
  process.exit(1);
}
const { body } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const covered = new Set(body);

function html(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) html(p, out);
    else if (extname(p) === '.html') out.push(p);
  }
  return out;
}

const missing = new Map();   // 字 → 出現的檔案
let scanned = 0, totalCjk = 0;
for (const f of html('dist')) {
  scanned++;
  // 去掉標籤與 script/style，只看真的會被排版的文字
  const text = readFileSync(f, 'utf8')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  for (const ch of text) {
    if (!CJK.test(ch)) continue;
    totalCjk++;
    if (!covered.has(ch)) {
      if (!missing.has(ch)) missing.set(ch, new Set());
      missing.get(ch).add(f.replace(/^dist\//, ''));
    }
  }
}

console.log(`掃 ${scanned} 個 HTML，${totalCjk} 個中文字，子集覆蓋 ${covered.size} 字`);
if (missing.size === 0) {
  console.log('✓ 沒有漏字');
  process.exit(0);
}
console.error(`✗ ${missing.size} 個字不在子集裡（會靜默退回系統字）：`);
for (const [ch, files] of [...missing].slice(0, 40)) {
  console.error(`   ${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}  ← ${[...files].slice(0,3).join(', ')}`);
}
if (missing.size > 40) console.error(`   …另外 ${missing.size - 40} 個`);
console.error('\n修法：把來源加進 build-fonts.mjs 掃描範圍，或加進 ALWAYS 常數。');
process.exit(strict ? 1 : 0);
