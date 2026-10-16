#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { scan } from './token-rules.mjs';

const root = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? 'src';
const SKIP = new Set(['payload-types.ts', 'importMap.js']);
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : ['.css', '.tsx', '.ts'].includes(extname(p)) && !SKIP.has(e) && files.push(p); } })(root);

const bad = files.flatMap((f) => scan(readFileSync(f, 'utf8'), f));
if (bad.length) {
  console.error(bad.map((b) => `✗ ${b.file}:${b.line} ${b.rule}：${b.text}`).join('\n'));
  console.error('\n顏色、字級、間距請用共用 token（packages/tokens/theme.css）；要新增就加在那一份，前台也會一起得到。');
  process.exit(1);
}
console.log(`✓ ${files.length} 個檔案沒有寫死的顏色或長度`);
