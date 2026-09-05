/**
 * 驗證 README、CLAUDE.md 與 docs/ 的相對連結（含錨點）真的指向存在的東西。
 * 跳過程式碼區塊 —— 裡面的 ./foo.jpg 是示範語法，不是連結。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const files = ['README.md', 'CLAUDE.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
const slugify = (h) => h.replace(/[^\w一-鿿\- ]/g, '').trim().toLowerCase().replace(/\s+/g, '-');

const bad = [];
let n = 0;
for (const file of files) {
  // 先把 fenced code block 與 inline code 拿掉，避免示範語法被誤判
  const text = readFileSync(file, 'utf8')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');

  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|#|mailto:)/.test(href)) continue;
    n++;
    const [path, frag] = href.split('#');
    if (!path) continue;
    const target = resolve(dirname(file), path);
    if (!existsSync(target)) { bad.push(`${file} → ${href}`); continue; }
    if (frag && target.endsWith('.md')) {
      const heads = [...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map((h) => slugify(h[1]));
      if (!heads.includes(frag.toLowerCase())) bad.push(`${file} → ${href}（錨點不存在）`);
    }
  }
}

console.log(`文檔連結 ${n} 個`);
if (!bad.length) { console.log('✓ 全部有效'); process.exit(0); }
console.error(`✗ ${bad.length} 個問題：`);
for (const b of bad) console.error(`   ${b}`);
process.exit(1);
