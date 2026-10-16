#!/usr/bin/env node
/**
 * 部署前把被引用的影片／GPX 從私有 bucket 複製到公開 bucket；部署後撤回不再被引用的。
 *
 *   node scripts/promote-media.mjs promote --manifest=dist/content-manifest.json
 *   node scripts/promote-media.mjs revoke  --manifest=dist/content-manifest.json --promoted=<json 檔，後台 /api/promoted 的輸出>
 *
 * 憑證（各自最小權限）：
 *   R2_PRIVATE_KEY_ID / R2_PRIVATE_SECRET   私有 bucket，只讀
 *   R2_PUBLIC_KEY_ID  / R2_PUBLIC_SECRET    公開 bucket，只寫 video/、gpx/
 * bucket 名稱：PRIVATE_BUCKET（預設 hongchen-admin-private）、PUBLIC_BUCKET（預設 zhuiyunzhuxue-media）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { AwsClient } from 'aws4fetch';
import { cacheControl, runPromote, runRevoke } from '../packages/content-sync/promote-run.ts';

const [cmd] = process.argv.slice(2);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const need = (k) => process.env[k] || (() => { throw new Error(`缺少環境變數 ${k}`); })();
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? 'e92ee6e81173e12edb023ed5ee34faee';

function s3(bucket, idVar, secretVar) {
  const aws = new AwsClient({ accessKeyId: need(idVar), secretAccessKey: need(secretVar), service: 's3', region: 'auto' });
  const url = (key = '') => `https://${ACCOUNT}.r2.cloudflarestorage.com/${bucket}${key ? '/' + key.split('/').map(encodeURIComponent).join('/') : ''}`;
  return {
    async keys(prefix) {
      const out = new Set();
      let token;
      do {
        const u = new URL(url());
        u.searchParams.set('list-type', '2');
        if (prefix) u.searchParams.set('prefix', prefix);
        if (token) u.searchParams.set('continuation-token', token);
        const r = await aws.fetch(u);
        if (!r.ok) throw new Error(`列出 ${bucket} 失敗 ${r.status}`);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) out.add(m[1]);
        token = xml.match(/<NextContinuationToken>([^<]+)</)?.[1];
      } while (token);
      return out;
    },
    async get(key) {
      const r = await aws.fetch(url(key));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`讀 ${bucket}/${key} 失敗 ${r.status}`);
      return { body: r.body, size: Number(r.headers.get('content-length')), contentType: r.headers.get('content-type') ?? undefined };
    },
    async put(key, body, meta) {
      const r = await aws.fetch(url(key), {
        method: 'PUT', body, duplex: 'half',
        headers: {
          'content-length': String(meta.size), 'content-type': meta.contentType ?? 'application/octet-stream',
          'cache-control': cacheControl, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        },
      });
      if (!r.ok) throw new Error(`寫 ${bucket}/${key} 失敗 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },
    async delete(key) {
      const r = await aws.fetch(url(key), { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`刪 ${bucket}/${key} 失敗 ${r.status}`);
    },
  };
}

const manifestFile = arg('manifest');
if (!manifestFile) throw new Error('--manifest 必填');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')).promoteKeys;
if (!Array.isArray(manifest)) throw new Error('manifest 沒有 promoteKeys');
const target = s3(process.env.PUBLIC_BUCKET ?? 'zhuiyunzhuxue-media', 'R2_PUBLIC_KEY_ID', 'R2_PUBLIC_SECRET');

if (cmd === 'promote') {
  const source = s3(process.env.PRIVATE_BUCKET ?? 'hongchen-admin-private', 'R2_PRIVATE_KEY_ID', 'R2_PRIVATE_SECRET');
  const r = await runPromote({ manifest, source, target, log: console.log });
  console.log(`✓ promote：新增 ${r.copied.length}、已存在 ${r.alreadyPublic.length}`);
} else if (cmd === 'revoke') {
  const promoted = new Set(JSON.parse(readFileSync(arg('promoted') ?? (() => { throw new Error('--promoted 必填'); })(), 'utf8')));
  const r = await runRevoke({ promoted, manifest: new Set(manifest), target, log: console.log });
  if (r.aborted) { console.error(`⚠ 撤回中止：${r.aborted}`); writeFileSync('revoke-aborted.txt', r.aborted); process.exit(0); }
  console.log(`✓ revoke：撤回 ${r.revoked.length} 個`);
  writeFileSync('revoked.json', JSON.stringify(r.revoked));
} else {
  throw new Error('用法：promote-media.mjs promote|revoke --manifest=…');
}
