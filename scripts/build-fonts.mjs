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
import { missingFrom } from './lib/ttf.mjs';

const SRC = 'src';
const OUT = 'src/assets/fonts/generated';
const EXT = new Set(['.astro', '.ts', '.tsx', '.mdx', '.md', '.yaml', '.yml', '.css', '.txt']);

/**
 * 收所有非 ASCII 字元，不只 CJK 區段。
 * 原因：第一版只挑 CJK 區段，漏掉了「·」(U+00B7)、「↑」、「—」這類符號，
 * satori 缺字是靜默的，海報上就直接開天窗。凡內容裡出現的非 ASCII 都要收。
 */
const NON_ASCII = (ch) => ch.codePointAt(0) > 0x7f && !/\s/u.test(ch);
/** emoji 不進海報語料：思源宋體沒有，且彩色 emoji 落在水墨海報上格格不入 */
const EMOJI = /\p{Extended_Pictographic}|\uFE0F|\u200D/u;

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
  for (const ch of text) if (NON_ASCII(ch)) body.add(ch);

  if (DISPLAY_FILES.test(f)) {
    for (const ch of text) if (NON_ASCII(ch)) display.add(ch);
  }
  for (const m of text.matchAll(DISPLAY_FIELD)) {
    for (const ch of m[1]) if (NON_ASCII(ch)) display.add(ch);
  }
}

/** 一定要有、但可能不在原始碼裡的字（日期、干支、單位） */
const ALWAYS = '〇一二三四五六七八九十廿卅百千萬年月日時分秒'
             + '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
             + '距離爬升用時結果公里米草稿篇條支已載入往下捲'
             + '·—–…、。「」『』（）：；？！／↑↓→←°';   // 標點與符號，海報上會用到
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
/* ── satori 用的 TTF 子集 ──
   satori 只吃 TTF/OTF/WOFF，不支援 WOFF2（README 原文），所以上面的 woff2
   餵不進去，必須另產一份。這份不進 dist，只在建置期由產圖端點讀取。 */
// 海報語料：剝掉 emoji（思源宋體沒有，satori 會靜默畫空白）
const posterText = [...body].filter((ch) => !EMOJI.test(ch)).join('') + LATIN;
const posterBuf = await subsetFont(
  readFileSync('src/assets/fonts/source/NotoSerifTC[wght].ttf'),
  posterText,
  { targetFormat: 'sfnt', variationAxes: { wght: 500 } },
);
writeFileSync(`${OUT}/poster.ttf`, posterBuf);
console.log(`poster   ${String(body.size).padStart(5)} 字  →  ${(posterBuf.length/1024).toFixed(1).padStart(7)} KB  (TTF，給 satori)`);

// satori 缺字是靜默的：不報錯、直接畫空白。必須真的翻開字型檔數一遍。
const miss = missingFrom(posterBuf, posterText);
if (miss.length) {
  console.error(`\n✗ 海報字型缺 ${miss.length} 個字，satori 會畫成空白且不報錯：`);
  for (const ch of miss.slice(0, 30)) {
    console.error(`   ${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
  process.exit(1);
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  display: [...display].sort().join(''),
  body: [...body].sort().join(''),
}, null, 0));
console.log(`合計 ${totalKB.toFixed(1)} KB`);

// CI 預算閘門
if (totalKB > 1200) { console.error(`✗ 中文字型 ${totalKB.toFixed(0)}KB 超過 1.2MB 預算`); process.exit(1); }
if (totalKB > 800) console.warn(`⚠ 中文字型 ${totalKB.toFixed(0)}KB 已超過 800KB，接近預算`);
