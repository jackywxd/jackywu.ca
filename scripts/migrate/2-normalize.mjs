/**
 * 遷移第二階段：正規化 frontmatter，寫出新檔。
 *
 * 舊站的 frontmatter 是九年三代工具疊出來的沉積層（Gatsby → Contentlayer →
 * 半改的 Next），這一步把它壓成新 schema 的形狀。正文一個字不動 ——
 * 圖片與連結交給第三階段。
 *
 * 冪等：重跑會覆寫自己產出的檔（帶 legacy 區塊的）；手改過、沒有 legacy
 * 區塊的檔會跳過並警告，不會把你的編輯蓋掉。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import YAML from 'yaml';
import { toTraditional } from '../lib/s2t.mjs';

const OLD = process.env.OLD_SITE ?? '/Users/jackywxd/repos/jackywu.ca';
const DEST = 'src/content/tales';
const dry = process.argv.includes('--dry-run');

const manifest = JSON.parse(readFileSync('migration/content-manifest.json', 'utf8'));
const decisions = YAML.parse(readFileSync('migration-decisions.yaml', 'utf8'));
const byFile = new Map(manifest.posts.map((p) => [p.file, p]));

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const firstSentence = (body) => {
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const s = text.split(/(?<=[。！？.!?])\s*/)[0] ?? text;
  return s.slice(0, 118);
};

// 先斷言 slug 唯一 —— 靜默覆蓋是會直接吃掉內容的那種錯，不能等寫到一半才發現
{
  const live = decisions.filter((d) => d.action !== 'HOLD' && d.action !== 'retire');
  const seen = new Map();
  for (const d of live) seen.set(d.slug, [...(seen.get(d.slug) ?? []), d.old]);
  const dup = [...seen.entries()].filter(([, v]) => v.length > 1);
  if (dup.length) {
    console.error('✗ slug 撞號，會互相覆蓋 —— 中止：');
    for (const [slug, files] of dup) console.error(`   ${slug}\n${files.map((f) => '      ← ' + f).join('\n')}`);
    console.error('\n改 migration-decisions.yaml 裡的 slug 欄位，或重跑 1-inventory.mjs。');
    process.exit(1);
  }
}

const report = { written: [], held: [], retired: [], skipped: [], warnings: [], converted: [] };

for (const d of decisions) {
  const p = byFile.get(d.old);
  if (!p) { report.warnings.push(`${d.old}: manifest 裡沒有這一筆`); continue; }

  if (d.action === 'HOLD') { report.held.push(d.old); continue; }
  if (d.action === 'retire') { report.retired.push(d.old); continue; }

  const src = readFileSync(join(OLD, d.old), 'utf8');
  let body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // 繁簡正規化：舊站的中文賽記是繁簡混排，而站上用的是 TC 字型，
  // 簡體專有字形不在字型裡會靜默退回系統字。在推導摘要之前先轉，
  // frontmatter 才會一併是繁體。只轉一對一無歧義的字。
  {
    // 不分語言都跑 —— 零寬字元跟中文無關，英文文章一樣會夾帶
    const conv = toTraditional(body);
    if (conv.changed.size || conv.strippedInvisible) {
      body = conv.text;
      report.converted.push(`${d.slug}: ${[...conv.changed.keys()].join('')}` +
        (conv.strippedInvisible ? `（另去掉 ${conv.strippedInvisible} 個零寬字元）` : ''));
    }
  }
  const realm = d.action === 'archive' ? 'forge' : d.realm;
  const outDir = join(DEST, String(d.date ?? p.date).slice(0, 4), d.slug);
  const outFile = join(outDir, 'index.mdx');

  if (existsSync(outFile) && !readFileSync(outFile, 'utf8').includes('legacy:')) {
    report.skipped.push(`${d.slug}（手改過，沒有 legacy 區塊）`);
    continue;
  }

  let excerpt = (d.excerpt || '').trim();
  let todo = false;
  // 舊站的 description 是人寫的，比機器截首句好用
  if (!excerpt && typeof p.raw.description === 'string' && p.raw.description.trim().length >= 20) {
    excerpt = p.raw.description.trim().slice(0, 118);
  }
  if (!excerpt) { excerpt = firstSentence(body); todo = true; }
  if (excerpt.length < 20) { excerpt = (excerpt + ' ' + (p.raw.description ?? p.title ?? '')).trim().slice(0, 118); todo = true; }
  if (excerpt.length < 20) { excerpt = `${p.title ?? d.slug} —— 待補摘要`; todo = true; }

  const title = String(d._title ?? p.title ?? d.slug);
  if (title.length > 60) report.warnings.push(`${d.slug}: 標題 ${title.length} 字，超過 schema 的 60 字上限`);

  const tags = Array.isArray(p.raw.tags) ? p.raw.tags : p.raw.tags ? [p.raw.tags] : [];
  const fm = [
    '---',
    `title: ${q(title)}`,
    `date: ${d.date ?? p.date}`,
    `realm: ${realm}`,
    `lang: ${d.lang}`,
    // 舊站 4 篇 draft 其實線上是公開的 —— 遷移時一律先收成草稿，由你決定放不放
    p.draft ? 'draft: true          # 舊站標了 draft 但線上仍公開，先收起來' : null,
    `excerpt: ${q(excerpt)}${todo ? '   # TODO 待你改寫' : ''}`,
    tags.length ? `tags: [${tags.map(q).join(', ')}]` : null,
    realm === 'still' ? 'shareable: false' : null,
    'legacy:',
    `  url: ${q(decodeURIComponent(p.oldUrl))}`,
    '---',
  ].filter((l) => l !== null).join('\n');

  if (!dry) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, `${fm}\n${body}`);
  }
  report.written.push(`${d.slug}  [${realm}${p.draft ? ' draft' : ''}${todo ? ' TODO摘要' : ''}]`);
}

console.log(`${dry ? '[dry-run] ' : ''}正規化完成`);
console.log(`  寫出 ${report.written.length} 篇 → ${DEST}/`);
for (const w of report.written) console.log(`     ${w}`);
if (report.held.length)    console.log(`\n  ⚠ HOLD ${report.held.length} 篇（不自動處理，等你指示）:\n${report.held.map((x) => '     ' + x).join('\n')}`);
if (report.retired.length) console.log(`\n  退役 ${report.retired.length} 篇（不寫檔、不產轉址）`);
if (report.skipped.length) console.log(`\n  跳過 ${report.skipped.length} 篇:\n${report.skipped.map((x) => '     ' + x).join('\n')}`);
if (report.converted.length) {
  console.log(`\n  繁簡正規化 ${report.converted.length} 篇:`);
  for (const x of report.converted) console.log(`     ${x}`);
}
if (report.warnings.length) console.log(`\n  警告:\n${report.warnings.map((x) => '     ' + x).join('\n')}`);
