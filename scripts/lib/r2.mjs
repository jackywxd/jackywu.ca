/**
 * R2 的 S3 相容介面。
 *
 * 為什麼需要它：Cloudflare 的 REST API 沒有「列出物件」的端點，
 * wrangler r2 object 也只能按 key 存取。要做雙向同步就必須能列舉，
 * 而列舉只能走 S3 相容 API —— 那需要一組 R2 存取金鑰。
 *
 * 沒設金鑰時回 null，呼叫端降級成單向（推送）。
 */
import { AwsClient } from 'aws4fetch';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? 'e92ee6e81173e12edb023ed5ee34faee';
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;

export const canList = () => Boolean(KEY && SECRET);

export const HOWTO = `
要開啟雙向同步（從 R2 拉回內容），需要一組 R2 存取金鑰：

  Cloudflare Dashboard → R2 → API → Manage API Tokens
  → Create API Token，權限選 "Object Read & Write"，範圍限這個 bucket

拿到之後放進 shell（或 .env，記得別進 git）：

  export R2_ACCESS_KEY_ID=…
  export R2_SECRET_ACCESS_KEY=…

沒有金鑰也能用，只是只能單向推送（內容 → R2）。`;

const endpoint = (bucket) => `https://${ACCOUNT}.r2.cloudflarestorage.com/${bucket}`;

export function client() {
  if (!canList()) return null;
  return new AwsClient({ accessKeyId: KEY, secretAccessKey: SECRET, service: 's3', region: 'auto' });
}

/** 列出某前綴下的所有物件（自動翻頁） */
export async function list(bucket, prefix = '') {
  const aws = client();
  if (!aws) return null;
  const out = [];
  let token;
  do {
    const u = new URL(endpoint(bucket));
    u.searchParams.set('list-type', '2');
    if (prefix) u.searchParams.set('prefix', prefix);
    if (token) u.searchParams.set('continuation-token', token);
    const r = await aws.fetch(u.toString());
    if (!r.ok) throw new Error(`R2 list 失敗 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const get = (t) => m[1].match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
      out.push({ key: get('Key'), size: Number(get('Size') ?? 0), etag: get('ETag'), modified: get('LastModified') });
    }
    token = xml.match(/<NextContinuationToken>([^<]+)</)?.[1];
  } while (token);
  return out;
}

/** 取一個物件的內容（Buffer） */
export async function get(bucket, key) {
  const aws = client();
  if (!aws) return null;
  const r = await aws.fetch(`${endpoint(bucket)}/${key}`);
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}
