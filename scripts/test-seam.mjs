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
  ok(has(/<h2>出發<\/h2>/), '標題');
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
