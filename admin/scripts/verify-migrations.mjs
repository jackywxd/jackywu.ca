#!/usr/bin/env node
/**
 * 集合的欄位改了，就必須附上對應的 migration（D1 的 push 是關掉的，沒有 migration 線上就沒有那個欄位）。
 * 做法：請 Payload 產一份 migration，如果它說「沒有 schema 變更」就通過；
 * 如果它真的產出了檔案，代表有變更沒被記錄——把產出的檔案收掉（只收它剛建的那幾個）並失敗。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const DIR = 'migrations';
const before = new Set(readdirSync(DIR));
const indexBefore = readFileSync(`${DIR}/index.ts`, 'utf8');

const r = spawnSync('pnpm', ['exec', 'payload', 'migrate:create', 'ci-check'], { input: 'n\n', encoding: 'utf8', timeout: 180_000 });
const out = `${r.stdout}\n${r.stderr}`;
const created = readdirSync(DIR).filter((f) => !before.has(f));

if (created.length) {
  for (const f of created) rmSync(`${DIR}/${f}`);                 // 只刪這次剛建出來的
  writeFileSync(`${DIR}/index.ts`, indexBefore);                    // index.ts 也還原
  console.error(`✗ 集合的 schema 有變更，但沒有對應的 migration。\n  請執行：pnpm payload migrate:create <名稱>，檢查產出的 SQL，然後一起提交。`);
  process.exit(1);
}
if (r.status !== 0 || !/No schema changes detected/.test(out)) {
  console.error(`✗ 無法確認 migration 是否最新（payload 的輸出不是預期的）：\n${out.slice(-800)}`);
  process.exit(1);
}
if (!existsSync(`${DIR}/index.ts`)) process.exit(1);
console.log('✓ migrations 與集合定義一致');
