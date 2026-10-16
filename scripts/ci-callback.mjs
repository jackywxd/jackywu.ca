#!/usr/bin/env node
/**
 * publish.yml 最後一步（always）：把結果回報給後台。
 * 成功的判定要有「deploy 與 smoke 都成功」的正面證據，缺任何一個都回報失敗。
 * 回報送不出去會重試；仍失敗就讓這一步失敗——後台的看門狗之後會把這筆判成失敗，
 * 而不是讓它永遠卡在進行中。
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { buildCallback } from '../packages/content-sync/ci.ts';

const need = (k) => process.env[k] || (() => { throw new Error(`缺少環境變數 ${k}`); })();
const readLog = (id) => (existsSync(`ci-logs/${id}.log`) ? readFileSync(`ci-logs/${id}.log`, 'utf8') : '');
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);

const req = readJson('request.json', null);
if (!req) { console.log('手動部署，沒有請求可回報'); process.exit(0); }

const manifest = readJson('src/content/payload/manifest.json', { promoteKeys: [] });
const body = JSON.stringify(buildCallback({
  requestId: req.id, steps: JSON.parse(process.env.STEPS_JSON ?? '{}'), readLog,
  runUrl: `https://github.com/${need('GITHUB_REPOSITORY')}/actions/runs/${need('GITHUB_RUN_ID')}`,
  promoteKeys: manifest.promoteKeys, revoked: readJson('revoked.json', []),
}));

const t = Math.floor(Date.now() / 1000);
const sig = `t=${t},v1=${createHmac('sha256', need('PUBLISH_HMAC_SECRET')).update(`${t}.${body}`).digest('hex')}`;
const url = new URL('/api/publish/callback', need('ADMIN_URL'));

let lastErr;
for (let i = 0; i < 4; i++) {
  try {
    const r = await fetch(url, {
      method: 'POST', redirect: 'manual', body,
      headers: { 'content-type': 'application/json', 'x-signature': sig, 'CF-Access-Client-Id': need('CF_ACCESS_CLIENT_ID'), 'CF-Access-Client-Secret': need('CF_ACCESS_CLIENT_SECRET') },
    });
    if (r.status >= 300 && r.status < 400) throw new Error(`被導向 ${r.headers.get('location')}：Access 服務憑證沒有被接受`);
    if (r.ok) { console.log(`✓ 已回報：${JSON.parse(body).ok ? '成功' : '失敗'}`); process.exit(0); }
    // 4xx 是我們送錯了，重試沒有意義
    if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(`後台拒絕回呼 ${r.status}：${(await r.text()).slice(0, 200)}`), { fatal: true });
    lastErr = new Error(`後台回 ${r.status}`);
  } catch (e) {
    if (e.fatal) { console.error(e.message); process.exit(1); }
    lastErr = e;
  }
  await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
}
console.error(`回報失敗：${lastErr?.message}`);
process.exit(1);
