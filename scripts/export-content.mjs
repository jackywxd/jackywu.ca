#!/usr/bin/env node
/**
 * 把已發佈的內容匯出成可放進 git 的備份（MDX + 媒體檔）。
 *   node scripts/export-content.mjs --source=live [--out=content-backup]
 *   node scripts/export-content.mjs --source=fixture --out=/tmp/x     # 本機試跑
 * 只動它自己產生的目錄（有標記檔才清）；草稿永遠不匯出（repo 是公開的）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { exportCorpus } from '../packages/content-sync/export.ts';
import { loadLive } from './lib/live-source.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const source = arg('source', 'live'), OUT = arg('out', 'content-backup'), MARKER = '.generated-by-export-content';

let corpus, media;
if (source === 'fixture') {
  const m = await import('../e2e/fixtures/payload/corpus.mjs');
  corpus = structuredClone(m.corpus);
  media = async (id, dest) => { const s = m.mediaSpecs[id]; await sharp({ create: { width: s.width, height: s.height, channels: 3, background: s.color } }).jpeg({ quality: 70 }).toFile(dest); };
} else if (source === 'live') {
  ({ corpus, media } = await loadLive());
} else throw new Error(`--source 必須是 live 或 fixture，收到 ${source}`);

const { files, counts } = exportCorpus(corpus);

if (existsSync(OUT)) {
  if (!existsSync(join(OUT, MARKER))) throw new Error(`${OUT} 已存在但不是 export-content 產生的（沒有 ${MARKER}），拒絕覆蓋`);
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, MARKER), 'generated\n');
for (const [path, f] of files) {
  const dest = join(OUT, path);
  mkdirSync(dirname(dest), { recursive: true });
  if ('text' in f) writeFileSync(dest, f.text); else await media(f.media, dest);
}
console.log(`✓ 備份：${counts.tales} 篇文章、${counts.routes} 條路線、${counts.reels} 支影片 → ${OUT}`);
