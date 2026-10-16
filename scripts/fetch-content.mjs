#!/usr/bin/env node
/**
 * 把後台（Payload）已發佈的內容整理成前台建置吃的 src/content/payload/。
 *
 *   node scripts/fetch-content.mjs --source=fixture            # CI／本機：合成語料，完全不連網
 *   node scripts/fetch-content.mjs --source=live [--request=<檔>] [--prev-manifest=<檔>]
 *
 * live 需要環境變數 ADMIN_URL、CF_ACCESS_CLIENT_ID、CF_ACCESS_CLIENT_SECRET。
 * --request 是一筆發佈請求（JSON 檔）：部署只用「目前已上線的版本」加上這一筆。
 * 完整性護欄：拉到的文章數比上次部署少過頭，就拒絕建置。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { buildFiles } from '../packages/content-sync/files.ts';
import { applyRequest, integrityAll, missingDeps } from '../packages/content-sync/request.ts';

const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? dflt;
const source = arg('source', 'fixture');
const OUT = arg('out', 'src/content/payload');
const MARKER = '.generated-by-fetch-content';

/* ───────── 取得語料 ───────── */
async function loadFixture() {
  const { corpus, mediaSpecs } = await import('../e2e/fixtures/payload/corpus.mjs');
  const media = async (id, dest) => {
    const m = mediaSpecs[id];
    if (!m) throw new Error(`fixture 沒有媒體 ${id}`);
    await sharp({ create: { width: m.width, height: m.height, channels: 3, background: m.color } })
      .jpeg({ quality: 70 }).toFile(dest);
  };
  return { corpus: structuredClone(corpus), media };
}

import { loadLive } from './lib/live-source.mjs';

/* ───────── 主流程 ───────── */
const src = source === 'fixture' ? await loadFixture() : source === 'live' ? await loadLive() : null;
if (!src) throw new Error(`--source 必須是 fixture 或 live，收到 ${source}`);
let { corpus } = src;
// 測試用：在合成語料上多加幾篇（例如含未知節點、簡體字的反例）。只在 fixture 模式有效。
const extra = arg('fixture-extra');
if (extra) {
  if (source !== 'fixture') throw new Error('--fixture-extra 只能搭配 --source=fixture');
  corpus.tales.push(...JSON.parse(readFileSync(extra, 'utf8')));
}
const lastCounts = (() => {
  const f = arg('prev-manifest');
  return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).counts ?? {} : undefined;
})();

const expectedRemovals = {};
const reqFile = arg('request');
let req = null;
if (reqFile) {
  req = JSON.parse(readFileSync(reqFile, 'utf8'));
  if (!/^[a-z0-9]{20,32}$/.test(req.id ?? '')) throw new Error('請求 id 格式不對');
  if (!['tales', 'pages', 'routes', 'reels'].includes(req.collection)) throw new Error(`集合不對：${req.collection}`);
  if (source !== 'live') throw new Error('--request 只能搭配 --source=live');
  if (req.kind === 'publish') {
    corpus = applyRequest(corpus, req, await src.version(req.collection, req.versionId, req.docId));
    // 依賴閉包：這筆請求引用、但還沒上線的路線／影片，連同這一筆一起建置
    for (let i = 0; i < 4; i++) {
      const miss = missingDeps(corpus);
      if (!miss.routes.length && !miss.reels.length) break;
      for (const rid of miss.routes) corpus.routes.push(await src.draftDoc('routes', rid));
      for (const rid of miss.reels) corpus.reels.push(await src.draftDoc('reels', rid));
    }
  } else {
    corpus = applyRequest(corpus, req);
    expectedRemovals[req.collection] = 1;
  }
}

if (lastCounts !== undefined) {
  const check = integrityAll({
    last: lastCounts, expectedRemovals,
    fetched: { tales: corpus.tales.length, routes: corpus.routes.length, reels: corpus.reels.length, redirects: corpus.redirects.length },
  });
  if (!check.ok) throw new Error(`完整性護欄：${check.reason}`);
}

const built = buildFiles(corpus);

// 輸出目錄是產物：只在它確實是我們自己產生的（有標記檔）時才清掉重來
if (existsSync(OUT)) {
  if (!existsSync(join(OUT, MARKER))) throw new Error(`${OUT} 已存在但不是 fetch-content 產生的（沒有 ${MARKER}），拒絕覆蓋`);
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, MARKER), 'generated\n');

for (const [path, f] of built.files) {
  const dest = join(OUT, path);
  mkdirSync(dirname(dest), { recursive: true });
  if ('text' in f) writeFileSync(dest, f.text);
  else await src.media(f.media, dest);
}
// requestId：線上的 manifest 記著「哪一筆請求建出來的」，回呼沒送到時後台用它確認是否已上線
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  source, requestId: req?.id ?? null, counts: built.counts, promoteKeys: built.promoteKeys,
  tales: corpus.tales.map((t) => `${t.date.slice(0, 4)}/${t.slug}`).sort(),
}, null, 2) + '\n');

console.log(`✓ ${source}：${built.counts.tales} 篇文章、${built.counts.routes} 條路線、${built.counts.reels} 支影片、${built.counts.redirects} 條轉址 → ${OUT}`);
