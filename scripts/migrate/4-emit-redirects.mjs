/**
 * 遷移第四階段：產生 public/_redirects。
 *
 * 兩條硬規則：
 * 1. 只輸出實測 liveStatus === 200 的來源。轉址到一個從來沒上線過的 URL
 *    沒有意義，只是浪費 Cloudflare 的 2000 條靜態規則額度。
 * 2. 來源一律 percent-encode。_redirects 以空白分欄，舊站的
 *    /blog/2020/2020-08-03 Castle Tower 若寫成真空白會整行解析錯誤 ——
 *    這是靜態站最常踩的轉址坑。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

const OUT = 'public/_redirects';
const dry = process.argv.includes('--dry-run');
const manifest = JSON.parse(readFileSync('migration/content-manifest.json', 'utf8'));
const decisions = YAML.parse(readFileSync('migration-decisions.yaml', 'utf8'));
const byFile = new Map(manifest.posts.map((p) => [p.file, p]));

/** 行當 → 落腳頁，給「舊站公開但新站是草稿」的文章當暫時去處 */
const REALM_PATH = { run: '/run/', snow: '/snow/', road: '/road/', wild: '/wild/', forge: '/forge/', still: '/' };

const rules = [];
const skipped = { notLive: [], held: [], retired: [] };
const draftDetour = [];

for (const d of decisions) {
  const p = byFile.get(d.old);
  if (!p) continue;
  if (p.liveStatus !== 200) { skipped.notLive.push(`${p.oldUrl} (${p.liveStatus})`); continue; }
  if (d.action === 'HOLD')   { skipped.held.push(p.oldUrl); continue; }
  if (d.action === 'retire') { skipped.retired.push(p.oldUrl); continue; }
  // 舊站標了 draft 的文章在 production 不出頁 —— 直接 301 過去就是轉到 404。
  // 先導到該行當的落腳頁，用 302（目的地是暫時的，發表後就該指回文章）。
  if (p.draft) {
    const to = REALM_PATH[d.action === 'archive' ? 'forge' : d.realm] ?? '/';
    rules.push([encodeURI(decodeURIComponent(p.oldUrl)), to, 302]);
    draftDetour.push(`${p.oldUrl} → ${to}（${d.slug} 是草稿，不出頁）`);
    continue;
  }
  rules.push([encodeURI(decodeURIComponent(p.oldUrl)), `/tales/${d.slug}/`, 301]);
}
rules.sort((a, b) => a[0].localeCompare(b[0]));

const extra = [
  ['/blog', '/', 301],
  ['/blog/page/:n', '/', 301],
  ['/feed.xml', '/rss.xml', 301],
  ['/sitemap.xml', '/sitemap-index.xml', 301],
];

const all = [...rules, ...extra];
// padEnd 只在寬度不足時補空白 —— 目標超長時狀態碼會黏上去，整條規則失效。
// 兩欄寬度都取實際最大值 + 2，保證永遠至少有一個空白。
const w1 = Math.max(...all.map((r) => r[0].length)) + 2;
const w2 = Math.max(...all.map((r) => r[1].length)) + 2;
const body = [
  '# 由 scripts/migrate/4-emit-redirects.mjs 產生，不要手改。',
  '# 來源一律 percent-encoded —— _redirects 以空白分欄，真空白會讓整行失效。',
  '',
  ...rules.map(([f, t, c]) => `${f.padEnd(w1)}${t.padEnd(w2)}${c}`),
  '',
  '# 舊站的其他入口',
  ...extra.map(([f, t, c]) => `${f.padEnd(w1)}${t.padEnd(w2)}${c}`),
  '',
].join('\n');

if (!dry) writeFileSync(OUT, body);

console.log(`${dry ? '[dry-run] ' : ''}轉址表`);
console.log(`  文章轉址   ${rules.length} 條`);
console.log(`  其他入口   ${extra.length} 條`);
console.log(`  合計       ${rules.length + extra.length} 條（Cloudflare 上限：靜態 2000 + 動態 100）`);
if (skipped.notLive.length) console.log(`\n  跳過（從未上線）${skipped.notLive.length}:\n${skipped.notLive.map((x) => '     ' + x).join('\n')}`);
if (draftDetour.length) {
  console.log(`\n  ⚠ ${draftDetour.length} 條指向草稿，改用 302 導到行當頁：`);
  for (const x of draftDetour) console.log(`     ${x}`);
  console.log('     （這幾篇舊站標了 draft 卻線上公開。發表後重跑本腳本就會指回文章。）');
}
if (skipped.held.length) {
  console.log(`\n  ⚠ HOLD 但線上仍是 200 的 ${skipped.held.length} 條 —— 切網域後這些 URL 會變 404：`);
  for (const u of skipped.held) console.log(`     ${u}`);
  console.log('     （要嘛給它一個去處，要嘛明確接受它消失。這是你的決定，腳本不代決。）');
}
if (!dry) console.log(`\n寫入 ${OUT}`);
