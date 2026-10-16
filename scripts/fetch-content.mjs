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
import { applyRequest, integrity, missingDeps } from '../packages/content-sync/request.ts';

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

async function loadLive() {
  const base = process.env.ADMIN_URL;
  const id = process.env.CF_ACCESS_CLIENT_ID, secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!base || !id || !secret) throw new Error('live 模式需要 ADMIN_URL、CF_ACCESS_CLIENT_ID、CF_ACCESS_CLIENT_SECRET');
  const headers = { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret, accept: 'application/json' };
  const get = async (path) => {
    const r = await fetch(new URL(path, base), { headers, redirect: 'manual' });
    // Access 沒放行時會 302 去登入頁；這不是「內容是空的」，是設定壞了，要大聲說
    if (r.status >= 300 && r.status < 400) throw new Error(`${path} 被導向 ${r.headers.get('location')}：Access 服務憑證沒有被接受`);
    if (!r.ok) throw new Error(`${path} 回 ${r.status}`);
    return r;
  };
  const all = async (col, extra = '') =>
    (await (await get(`/api/${col}?limit=0&pagination=false&depth=0${extra}`)).json()).docs;
  const published = '&where[_status][equals]=published';
  const corpus = {
    tales: await all('tales', published), pages: await all('pages', published), routes: await all('routes', published),
    reels: await all('reels', published), media: await all('media'), redirects: await all('redirects'),
  };
  const media = async (mid, dest) => {
    const doc = corpus.media.find((m) => String(m.id) === String(mid));
    const r = await get(`/api/media/file/${encodeURIComponent(doc.filename)}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  };
  const version = async (col, versionId, docId) => {
    const v = (await (await get(`/api/${col}/versions/${versionId}?depth=0`)).json());
    return { ...v.version, id: v.parent ?? docId };
  };
  const draftDoc = async (col, docId) => (await (await get(`/api/${col}/${docId}?draft=true&depth=0`)).json());
  return { corpus, media, version, draftDoc };
}

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
const lastCount = (() => {
  const f = arg('prev-manifest');
  return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).counts?.tales : undefined;
})();

let expectedRemovals = 0;
const reqFile = arg('request');
if (reqFile) {
  const req = JSON.parse(readFileSync(reqFile, 'utf8'));
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
    if (req.collection === 'tales') expectedRemovals = 1;
  }
}

const check = integrity({ lastCount: lastCount ?? 0, fetchedCount: corpus.tales.length, expectedRemovals });
if (lastCount !== undefined && !check.ok) throw new Error(`完整性護欄：${check.reason}`);

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
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  source, counts: built.counts, promoteKeys: built.promoteKeys,
  tales: corpus.tales.map((t) => `${t.date.slice(0, 4)}/${t.slug}`).sort(),
}, null, 2) + '\n');

console.log(`✓ ${source}：${built.counts.tales} 篇文章、${built.counts.routes} 條路線、${built.counts.reels} 支影片、${built.counts.redirects} 條轉址 → ${OUT}`);
