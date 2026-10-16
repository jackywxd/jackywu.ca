#!/usr/bin/env node
/** 靜態檢查 .github/workflows。規則見 packages/content-sync/workflows.ts。 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { checkDeployNoCancel, checkInjection, checkPublish } from '../packages/content-sync/workflows.ts';

const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? '.github/workflows';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const problems = [];
for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
  const wf = YAML.parse(readFileSync(join(dir, f), 'utf8'));
  problems.push(...checkInjection(f, wf), ...checkDeployNoCancel(f, wf));
  if (f === 'publish.yml') problems.push(...checkPublish(wf, pkg.scripts.postbuild, 'content-publish'));
}
if (problems.length) { console.error(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }
console.log('✓ workflow 檢查通過');
