#!/usr/bin/env node
/** 讀 stdin 的 `wrangler deployments list --json`，印出現行版本 id。 */
import { readFileSync } from 'node:fs';
import { currentVersionId } from '../packages/content-sync/ci.ts';

console.log(currentVersionId(JSON.parse(readFileSync(0, 'utf8'))));
