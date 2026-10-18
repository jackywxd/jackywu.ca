#!/usr/bin/env node
/**
 * 可移植套件的守門：對真實的檔案跑 packages/infra/portable.ts 的規則。
 * 套件之後要原樣搬去 wildrunner；任何一個跳出套件或沒宣告的 import 都會讓它拆不開。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { portableViolations } from '../packages/infra/portable.ts';

const PORTABLE = ['packages/activity'];
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return n === 'node_modules' ? [] : statSync(p).isDirectory() ? walk(p) : [p];
});

let bad = 0;
for (const dir of PORTABLE) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = walk(dir).filter((f) => /\.[cm]?[jt]sx?$/.test(f)).map((f) => ({ path: relative(dir, f), text: readFileSync(f, 'utf8') }));
  const v = portableViolations(files, pkg);
  for (const x of v) console.error(`✗ ${dir}/${x}`);
  if (!v.length) console.log(`✓ ${dir}：${files.length} 個檔案，只用到套件內與 package.json 宣告的依賴`);
  bad += v.length;
}
process.exit(bad ? 1 : 0);
