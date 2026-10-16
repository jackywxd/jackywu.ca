#!/usr/bin/env node
/**
 * publish.yml 拉內容之前的兩道把關（純邏輯在 packages/content-sync/ci.ts）：
 *   node scripts/ci-gate.mjs source              repo 變數 CONTENT_SOURCE 必須是 payload
 *   node scripts/ci-gate.mjs prev-manifest <url> 取上次部署的 manifest；拿不到基準就拒絕，除非明確宣告第一次切換
 */
import { writeFileSync, rmSync } from 'node:fs';
import { prevManifestDecision, sourceGate } from '../packages/content-sync/ci.ts';

const [, , what, url] = process.argv;
if (what === 'source') {
  sourceGate(process.env.SITE_SOURCE);
  console.log('✓ 內容來源：payload');
} else if (what === 'prev-manifest') {
  const r = await fetch(url, { redirect: 'manual' });
  const d = prevManifestDecision(r.status, process.env.FIRST_PAYLOAD_DEPLOY === 'true');
  if (d === 'use') { writeFileSync('prev-manifest.json', await r.text()); console.log('✓ 取得上次部署的 manifest'); }
  else { rmSync('prev-manifest.json', { force: true }); console.log('第一次用 payload 內容部署：沒有上次的 manifest'); }
} else {
  throw new Error(`用法：ci-gate.mjs source | prev-manifest <url>，收到 ${what}`);
}
