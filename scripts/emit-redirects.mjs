#!/usr/bin/env node
/**
 * payload 模式：dist/_redirects 由後台的 redirects 集合產生，取代 git 裡的 public/_redirects。
 * _redirects 以空白分欄，來源或目標含空白會讓整行失效；fetch-content 已擋過，這裡再驗一次。
 * git 模式不做任何事。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (process.env.CONTENT_SOURCE !== 'payload') process.exit(0);
const src = 'src/content/payload/redirects.json';
if (!existsSync(src)) throw new Error(`${src} 不存在：CONTENT_SOURCE=payload 時必須先跑 fetch-content`);
const rows = JSON.parse(readFileSync(src, 'utf8'));
const w = Math.max(0, ...rows.map((r) => r.from.length)) + 2;
for (const r of rows) {
  if (/\s/.test(r.from) || /\s/.test(r.to)) throw new Error(`轉址含空白：${r.from} → ${r.to}`);
  if (!r.from.startsWith('/') || !r.to.startsWith('/')) throw new Error(`轉址必須以 / 開頭：${r.from} → ${r.to}`);
  if (r.from === r.to) throw new Error(`轉址自己轉自己：${r.from}`);
  if (!['301', '302'].includes(String(r.status ?? '301'))) throw new Error(`轉址的狀態碼只能是 301 或 302：${r.from}`);
}
// 302 給暫時的轉址（文章還沒寫）：301 會被瀏覽器與搜尋引擎永久快取
const body = rows.map((r) => `${r.from.padEnd(w)}${r.to}  ${r.status ?? '301'}`).join('\n');
writeFileSync('dist/_redirects', `# 由 scripts/emit-redirects.mjs 從後台的 redirects 集合產生，不要手改。\n\n${body}\n`);
console.log(`✓ _redirects：${rows.length} 條（來自後台）`);
