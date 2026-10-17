#!/usr/bin/env node
/** 靜態檢查 .github/workflows。規則見 packages/content-sync/workflows.ts。 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { checkContentSource, checkDeployNoCancel, checkInfra, checkInjection, checkPublish, checkSecretScope } from '../packages/content-sync/workflows.ts';
import { DISPATCH_INPUTS } from '../packages/content-sync/ci.ts';

const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? '.github/workflows';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const problems = [];
const all = {};
for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
  const wf = (all[f] = YAML.parse(readFileSync(join(dir, f), 'utf8')));
  problems.push(...checkInjection(f, wf), ...checkDeployNoCancel(f, wf), ...checkSecretScope(f, wf), ...checkInfra(f, wf));
  if (f === 'publish.yml') problems.push(...checkPublish(wf, pkg.scripts.postbuild, DISPATCH_INPUTS));
}
problems.push(...checkContentSource(all));
if (problems.length) { console.error(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }
console.log('✓ workflow 檢查通過');
