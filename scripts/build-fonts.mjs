/**
 * 中文字型子集化（prebuild）。
 *
 * 完整霞鶩文楷 TC 是 14.6MB，直接掛上去這個站就毀了。因為內容在建置期
 * 全部確定，我們確切知道用到哪些字，所以照實際字集切。
 *
 * 掃「原始碼」而不是「建置後的 HTML」，是為了讓 dev 與 production 用同一套字
 * —— 設計時看到的就是線上看到的。掃原始碼會漏掉的部分，由 postbuild 的
 * verify-fonts.mjs 掃 dist 補上檢查。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import subsetFont from 'subset-font';

const SRC = 'src';
const OUT = 'src/assets/fonts/generated';
const EXT = new Set(['.astro', '.ts', '.tsx', '.mdx', '.md', '.yaml', '.yml', '.css', '.txt']);

/** CJK 統一表意文字 + 擴充 A + 相容 + 全形標點 */
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'generated' || e === 'source' || e.startsWith('.')) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const body = new Set();
const display = new Set();

/** 標題級字集：UI 標籤（.astro / lib）＋ 內容的 title / name / verse / badge */
const DISPLAY_FILES = /\.astro$|src\/lib\//;
const DISPLAY_FIELD = /^\s*(?:title|name|nameEn|verse|badge|label|sub|glyph)\s*:\s*(.+)$/gm;

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const ch of text) if (CJK.test(ch)) body.add(ch);

  if (DISPLAY_FILES.test(f)) {
    for (const ch of text) if (CJK.test(ch)) display.add(ch);
  }
  for (const m of text.matchAll(DISPLAY_FIELD)) {
    for (const ch of m[1]) if (CJK.test(ch)) display.add(ch);
  }
}

/** 一定要有、但可能不在原始碼裡的字（日期、干支、單位） */
const ALWAYS = '〇一二三四五六七八九十廿卅百千萬年月日時分秒'
             + '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
             + '距離爬升用時結果公里米草稿篇條支已載入往下捲';
for (const ch of ALWAYS) { body.add(ch); display.add(ch); }

// display 是 body 的子集
for (const ch of display) body.add(ch);

const LATIN = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

mkdirSync(OUT, { recursive: true });
const jobs = [
  { name: 'display', src: 'src/assets/fonts/source/NotoSerifTC[wght].ttf',
    chars: display, opts: { variationAxes: { wght: 500 } } },
  { name: 'body', src: 'src/assets/fonts/source/LXGWWenKaiTC-Regular.ttf',
    chars: body, opts: {} },
];

let totalKB = 0;
for (const j of jobs) {
  const buf = readFileSync(j.src);
  const text = [...j.chars].join('') + LATIN;
  const out = await subsetFont(buf, text, { targetFormat: 'woff2', ...j.opts });
  writeFileSync(`${OUT}/${j.name}.woff2`, out);
  const kb = out.length / 1024;
  totalKB += kb;
  console.log(`${j.name.padEnd(8)} ${String(j.chars.size).padStart(5)} 字  →  ${kb.toFixed(1).padStart(7)} KB  (原始 ${(buf.length/1048576).toFixed(1)} MB)`);
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  display: [...display].sort().join(''),
  body: [...body].sort().join(''),
}, null, 0));
console.log(`合計 ${totalKB.toFixed(1)} KB`);

// CI 預算閘門
if (totalKB > 1200) { console.error(`✗ 中文字型 ${totalKB.toFixed(0)}KB 超過 1.2MB 預算`); process.exit(1); }
if (totalKB > 800) console.warn(`⚠ 中文字型 ${totalKB.toFixed(0)}KB 已超過 800KB，接近預算`);
