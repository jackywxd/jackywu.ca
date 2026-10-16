/**
 * promote / revoke 的執行層：對「儲存」介面操作，不知道 S3。
 * 測試用記憶體版；正式用 scripts/promote-media.mjs 接 R2 的 S3 API。
 */
import { allowedKey, planPromote, planRevoke } from './promote.ts';

export interface ReadStore { keys(prefix: string): Promise<Set<string>>; get(key: string): Promise<{ body: Uint8Array | ReadableStream; size: number; contentType?: string } | null> }
export interface WriteStore { keys(prefix: string): Promise<Set<string>>; put(key: string, body: Uint8Array | ReadableStream, meta: { size: number; contentType?: string }): Promise<void>; delete(key: string): Promise<void> }

const CACHE = 'public, max-age=31536000, immutable';
export const cacheControl = CACHE;

export async function runPromote(args: { manifest: readonly string[]; source: ReadStore; target: WriteStore; log?: (m: string) => void }) {
  const log = args.log ?? (() => {});
  const [privateKeys, publicKeys] = await Promise.all([
    args.source.keys('').then((s) => new Set([...s].filter(allowedKey))),
    args.target.keys(''),
  ]);
  const plan = planPromote({ manifest: args.manifest, privateKeys, publicKeys });
  if (plan.missing.length) {
    throw new Error(`這些檔案在私有與公開端都找不到，依賴沒有上傳完成：\n  ${plan.missing.join('\n  ')}`);
  }
  const copied: string[] = [];
  for (const key of plan.copy) {
    const obj = await args.source.get(key);
    if (!obj) throw new Error(`私有端讀不到 ${key}`);
    await args.target.put(key, obj.body, { size: obj.size, contentType: obj.contentType });
    copied.push(key);
    log(`↑ ${key}`);
  }
  // 逐一確認公開端真的有了，才讓部署繼續
  const after = await args.target.keys('');
  const absent = args.manifest.filter((k) => !after.has(k));
  if (absent.length) throw new Error(`複製後公開端仍缺：${absent.join(', ')}`);
  return { copied, alreadyPublic: plan.alreadyPublic };
}

export async function runRevoke(args: { promoted: ReadonlySet<string>; manifest: ReadonlySet<string>; target: WriteStore; log?: (m: string) => void }) {
  const publicKeys = await args.target.keys('');
  const plan = planRevoke({ promoted: args.promoted, manifest: args.manifest, publicKeys });
  if (!plan.ok) return { revoked: [] as string[], aborted: plan.reason };
  for (const key of plan.keys) {
    await args.target.delete(key); // 逐 key，精確刪除
    args.log?.(`✗ ${key}`);
  }
  return { revoked: plan.keys, aborted: undefined };
}
