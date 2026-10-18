#!/usr/bin/env node
/**
 * 前台接縫測試：後台內容 → fetch-content → 以 CONTENT_SOURCE=payload 建置。
 *
 * 用例：
 *  1. 合成語料能建置，且每一種區塊都真的渲染出來（不是「建置綠燈但內容沒了」）
 *  2. 認不得的節點 → fetch-content 就失敗，錯誤帶 slug（不是靜默略過）
 *  3. 字型裡沒有的字 → 建置被字型檢查擋下（prebuild 的 build-fonts 或 postbuild 的 verify-fonts）
 *     （注意：不是簡體字——霞鶩文楷 TC 其實有收簡體字形，實測 390 個常見簡體字零缺；
 *      思源宋體 TC 才缺，而它只用在標題。所以「簡體字會被擋」這個說法對內文不成立）
 *  4. 引用了沒有一起發佈的媒體 → 明確報錯
 *  5. 一筆發佈請求把已上線的文章改名：舊網址 301 到新網址、指向舊網址的轉址改指新網址，五個檢查照樣過
 *  6. 一筆撤下請求撤掉被轉址指著的文章：指向它的轉址一起拿掉（否則 verify-links 永遠擋住這一筆）
 * 每次都從乾淨狀態開始：fetch-content 會重建 src/content/payload，dist 由建置重建。
 * 全程不連網（fixture 模式；字型來自本機快取）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, CONTENT_SOURCE: 'payload' };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, ...opts });
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };

const tmp = mkdtempSync(join(tmpdir(), 'seam-test-'));
try {
  // 1. 正向
  let r = run('node', ['scripts/fetch-content.mjs', '--source=fixture']);
  ok(r.status === 0, 'fixture 能整理成 src/content/payload');
  r = run('pnpm', ['build']);
  ok(r.status === 0, `payload 模式能建置，且五個 postbuild 檢查全過${r.status ? '\n' + (r.stdout + r.stderr).slice(-1500) : ''}`);
  const page = existsSync('dist/tales/2026/ridge-day/index.html') ? readFileSync('dist/tales/2026/ridge-day/index.html', 'utf8') : '';
  const has = (pat, n = 1) => (page.match(pat) ?? []).length >= n;
  ok(has(/<h2 id="出發">出發<\/h2>/), '標題（帶 id，與 git 模式同一個 slugger）');
  ok(has(/<strong>這句是粗體<\/strong>/) && has(/<em>，這句是斜體<\/em>/), '粗體與斜體');
  ok(has(/<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">/), '連結（& 已跳脫、新分頁帶 noopener）');
  ok(has(/<blockquote><p>路是走出來的。<\/p><\/blockquote>/), '引言');
  ok(has(/<ul><li>水<\/li><li>鹽<\/li><li>巢狀的一項/) || has(/<li>鹽<ol><li>巢狀的一項/), '巢狀清單');
  ok(has(/<th>公里<\/th>/) && has(/<td>6:10<\/td>/), '表格');
  ok(has(/<figure class="fig[^"]*is-wide/) , '單張圖（wide）');
  ok(has(/class="gal"/), '圖組');
  ok(has(/class="vid"/), '影片');
  ok(has(/data-original="https:\/\/example\.com\/gone\.jpg"/), '待補圖');
  ok(has(/<hr>/), '分隔線');
  ok(has(/alt="林間小徑"/), '圖片的 alt 繼承自媒體庫');
  const red = existsSync('dist/_redirects') ? readFileSync('dist/_redirects', 'utf8') : '';
  ok(/\/blog\/old-post\/\s+\/tales\/2026\/ridge-day\/\s+301/.test(red), '_redirects 來自後台的 redirects');
  ok(!existsSync('dist/tales/2026/half'), '沒有發佈的東西不會出現');
  // 路線的活動數據（FIT 帶來的）：移動時間、配速（用移動時間算：6h15m ÷ 50 km = 7:30 /km）、出發時間照當地時間
  const routePage = existsSync('dist/routes/2026/fixture-ridge/index.html') ? readFileSync('dist/routes/2026/fixture-ridge/index.html', 'utf8') : '';
  const stat = (k, v) => new RegExp(`<dt[^>]*>${k}</dt>\\s*<dd[^>]*>${v}</dd>`).test(routePage);
  ok(stat('移動時間', '6:15') && stat('配速', '7:30 /km') && stat('出發', '05:30'), '路線頁：移動時間、配速、出發時間');
  // fixture-ridge 只存在於後台（git 裡沒有同名的舊檔）：頁面、輿圖列表都要有它自己的軌跡與剖面，不是空的
  const routesIndex = existsSync('dist/routes/index.html') ? readFileSync('dist/routes/index.html', 'utf8') : '';
  ok(routePage.includes('d="M0 100L1000 125"') && routePage.includes('d="M0 160L500 30L1000 160"'), '只在後台的路線：路線頁有軌跡與海拔剖面');
  ok(/fixture-ridge[\s\S]{0,2000}d="M0 100L1000 125"/.test(routesIndex), '只在後台的路線：輿圖列表的縮圖有軌跡');
  // 路線圖當封面：頁首是那條路線的向量軌跡（不是圖片），有替代文字；分享圖照常產出（並過了 og 置中裁切的檢查）
  const coverPage = existsSync('dist/tales/2026/route-cover/index.html') ? readFileSync('dist/tales/2026/route-cover/index.html', 'utf8') : '';
  ok(/<figure class="hero hero--route"[^>]*>\s*<svg[^>]*aria-label="路線圖：稜線測試路線，50 km"[^>]*>[\s\S]*?d="M0 100L1000 125"/.test(coverPage), '路線圖當封面：頁首內嵌那條路線的軌跡');
  ok(existsSync('dist/og/tales/2026/route-cover.png') && existsSync('dist/wx/tales/2026/route-cover.jpg'), '路線圖當封面：分享圖照常產出');

  // 2. 未知節點
  const bad = (t) => { const f = join(tmp, `${t.slug}.json`); writeFileSync(f, JSON.stringify([t])); return f; };
  const mk = (slug, content, extra = {}) => ({
    id: 90, title: '壞稿', slug, date: '2026-09-01', realm: 'run', excerpt: '這是一篇用來測試失敗路徑的文章，內容必須夠長才能通過摘要檢查。', content, ...extra,
  });
  const root = (...c) => ({ root: { type: 'root', children: c } });
  r = run('node', ['scripts/fetch-content.mjs', '--source=fixture', `--fixture-extra=${bad(mk('bad-node', root({ type: 'mystery' })))}`]);
  ok(r.status !== 0 && /2026\/bad-node/.test(r.stderr) && /無法渲染/.test(r.stderr), '未知節點：fetch-content 失敗，錯誤帶 slug');
  ok(!existsSync('src/content/payload/tales/2026/bad-node'), '失敗時不留下半成品的壞稿');

  // 4. 沒有一起發佈的媒體
  r = run('node', ['scripts/fetch-content.mjs', '--source=fixture', `--fixture-extra=${bad(mk('bad-dep', root({ type: 'block', fields: { blockType: 'figure', media: 999 } })))}`]);
  ok(r.status !== 0 && /依賴沒有一起發佈/.test(r.stderr), '缺少依賴：明確報錯');

  // 5. 改名的發佈請求（快照裡的版本 slug 不同）
  const corpusMod = await import('../e2e/fixtures/payload/corpus.mjs');
  const ridge = corpusMod.corpus.tales.find((x) => x.slug === 'ridge-day');
  const reqFile = (o) => { const f = join(tmp, `req-${o.kind}.json`); writeFileSync(f, JSON.stringify({ id: 'seamrequest0000000000001', collection: 'tales', docId: '1', versionId: 'v9', attempt: 1, ...o })); return f; };
  const snapFile = join(tmp, 'snap.json');
  writeFileSync(snapFile, JSON.stringify({ doc: { collection: 'tales', id: 1, versionId: 'v9', data: { ...ridge, slug: 'ridge-day-renamed' } }, deps: [], takenAt: '2026-10-16T00:00:00.000Z' }));
  r = run('node', ['scripts/fetch-content.mjs', '--source=fixture', `--request=${reqFile({ kind: 'publish' })}`, `--fixture-snapshot=${snapFile}`]);
  ok(r.status === 0, `（準備）改名的發佈請求能整理出來${r.status ? '\n' + r.stderr.slice(-800) : ''}`);
  r = run('pnpm', ['build']);
  ok(r.status === 0, `改名：建置與五個檢查都過（轉址沒有指向不存在的頁面）${r.status ? '\n' + (r.stdout + r.stderr).slice(-1500) : ''}`);
  const red2 = existsSync('dist/_redirects') ? readFileSync('dist/_redirects', 'utf8') : '';
  ok(/\/tales\/2026\/ridge-day\/\s+\/tales\/2026\/ridge-day-renamed\/\s+301/.test(red2), '改名：舊網址 301 到新網址');
  ok(/\/blog\/old-post\/\s+\/tales\/2026\/ridge-day-renamed\/\s+301/.test(red2), '改名：原本指向舊網址的轉址改指新網址（沒有轉址鏈）');
  ok(existsSync('dist/tales/2026/ridge-day-renamed/index.html') && !existsSync('dist/tales/2026/ridge-day/index.html'), '改名：新網址有頁面，舊網址沒有');

  // 6. 撤下被轉址指著的文章
  r = run('node', ['scripts/fetch-content.mjs', '--source=fixture', `--request=${reqFile({ kind: 'unpublish', versionId: 'none' })}`]);
  const reds = existsSync('src/content/payload/redirects.json') ? JSON.parse(readFileSync('src/content/payload/redirects.json', 'utf8')) : null;
  ok(r.status === 0 && Array.isArray(reds) && !reds.some((x) => x.to === '/tales/2026/ridge-day/'), `撤下：指向它的轉址一起拿掉${r.status ? '\n' + r.stderr.slice(-800) : ''}`);

  // 3. 字型缺字（U+20000 兩套字型都沒有）
  r = run('node', ['scripts/fetch-content.mjs', '--source=fixture', `--fixture-extra=${bad(mk('missing-glyph', root({ type: 'paragraph', children: [{ type: 'text', text: '稀有字\u{20000}', format: 0 }] })))}`]);
  ok(r.status === 0, '（準備）含缺字的稿子能被整理出來');
  r = run('pnpm', ['build']);
  ok(r.status !== 0 && /海報字型缺|不在子集裡/.test(r.stdout + r.stderr), '字型缺字：建置在字型檢查（build-fonts／verify-fonts）被擋下');
} finally {
  rmSync(tmp, { recursive: true, force: true });
  // 還原成乾淨的合成語料，不把反例留在工作目錄
  run('node', ['scripts/fetch-content.mjs', '--source=fixture']);
}
console.log(failed ? `\n${failed} 項失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
