/**
 * 一次性：把扁平的內容目錄改成以年分層。
 *
 *   src/content/tales/<slug>/          → src/content/tales/<年>/<slug>/
 *   src/content/routes/<slug>.*        → src/content/routes/<年>/<slug>.*
 *   src/content/reel/<slug>.*          → src/content/reel/<年>/<slug>.*
 *
 * 年份取自每筆內容自己的 date，不是猜的。
 * 用 git mv 保住檔案歷史 —— 這些文章有些是九年前的，歷史比檔案本身值錢。
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const dry = process.argv.includes('--dry-run');
const git = (...a) => execFileSync('git', a, { stdio: dry ? 'pipe' : 'inherit' });
const mkdir = (d) => { if (!dry) execFileSync('mkdir', ['-p', d]); };

const yearOf = (v) => String(v).slice(0, 4);
const moves = [];

// ── tales：資料夾 ──
for (const name of readdirSync('src/content/tales')) {
  const dir = join('src/content/tales', name);
  if (!statSync(dir).isDirectory()) continue;
  if (/^\d{4}$/.test(name)) continue;                      // 已經是年份層
  const entry = ['index.mdx', 'index.md'].map((f) => join(dir, f)).find(existsSync);
  if (!entry) { console.warn(`跳過（沒有 index）：${dir}`); continue; }
  const date = readFileSync(entry, 'utf8').match(/^date:\s*['"]?(\d{4}-\d{2}-\d{2})/m)?.[1];
  if (!date) { console.warn(`跳過（讀不到 date）：${entry}`); continue; }
  moves.push([dir, join('src/content/tales', yearOf(date), name)]);
}

// ── routes / reel：檔案（同一個 slug 有多個副檔名，要一起搬） ──
for (const coll of ['routes', 'reel']) {
  const base = join('src/content', coll);
  const yamls = readdirSync(base).filter((f) => f.endsWith('.yaml'));
  for (const y of yamls) {
    const slug = y.replace(/\.yaml$/, '');
    const data = YAML.parse(readFileSync(join(base, y), 'utf8'));
    const date = data?.date && yearOf(data.date);
    if (!date) { console.warn(`跳過（沒有 date）：${join(base, y)}`); continue; }
    // 同 slug 的所有檔：x.yaml / x.svg / x.thumb.svg / x.profile.svg / x-poster.jpg …
    for (const f of readdirSync(base)) {
      if (statSync(join(base, f)).isDirectory()) continue;
      if (f === slug + extOf(f, slug) || f.startsWith(slug + '.') || f.startsWith(slug + '-')) {
        moves.push([join(base, f), join(base, date, f)]);
      }
    }
  }
}
function extOf(f, slug) { return f.slice(slug.length); }

console.log(`${dry ? '[dry-run] ' : ''}以年分層：${moves.length} 個搬移\n`);
const byYear = {};
for (const [from, to] of moves) {
  const y = to.split('/')[3];
  (byYear[y] ??= []).push(basename(from));
}
for (const [y, items] of Object.entries(byYear).sort()) {
  console.log(`  ${y}  ${items.length} 個`);
}

if (dry) { console.log('\n（--dry-run，沒有實際搬動）'); process.exit(0); }

const dirs = new Set(moves.map(([, to]) => to.split('/').slice(0, -1).join('/')));
for (const d of dirs) mkdir(d);
for (const [from, to] of moves) git('mv', from, to);
console.log(`\n完成。用 git mv 搬的，檔案歷史保住了。`);
