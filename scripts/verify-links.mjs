/**
 * postbuild：檢查 dist 裡所有內部連結都真的有對應檔案。
 * 斷鏈在靜態站是靜默的 —— 建置成功不代表連結通。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const strict = process.argv.includes('--strict');
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const all = walk('dist');
const pages = all.filter((p) => extname(p) === '.html');

const exists = (href) => {
  const clean = decodeURIComponent(href.split(/[?#]/)[0]);
  if (!clean.startsWith('/')) return true;
  const base = `dist${clean}`;
  return existsSync(base) || existsSync(base.replace(/\/$/, '') + '/index.html') || existsSync(base + 'index.html');
};

const broken = new Map();
for (const f of pages) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const href = m[1];
    if (href.startsWith('//')) continue;
    if (!exists(href)) {
      if (!broken.has(href)) broken.set(href, new Set());
      broken.get(href).add(f.replace(/^dist\//, ''));
    }
  }
}

const linkCount = pages.reduce((n, f) => n + [...readFileSync(f, 'utf8').matchAll(/(?:href|src)="\/[^"]*"/g)].length, 0);
console.log(`掃 ${pages.length} 頁，${linkCount} 個站內連結`);
if (broken.size === 0) { console.log('✓ 沒有斷鏈'); process.exit(0); }
console.error(`✗ ${broken.size} 個斷鏈：`);
for (const [href, from] of broken) console.error(`   ${href.padEnd(46)} ← ${[...from].slice(0, 3).join(', ')}`);
process.exit(strict ? 1 : 0);
