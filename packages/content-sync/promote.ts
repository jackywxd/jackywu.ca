/**
 * 發佈時把「私有 bucket 裡的影片／GPX」複製到公開 bucket，以及撤下時撤回。純規劃，不做 I/O。
 *
 * 安全規則（逐條有測試）：
 *  · 只複製 manifest 要的 key，且只複製公開端還沒有的
 *  · 只允許 video/、gpx/ 兩個前綴（與 R2 金鑰的權限範圍一致，縱深防禦）
 *  · 撤回只刪「我們自己 promote 過」的 key，逐 key，絕不用前綴或樣式比對
 *  · 一次撤回超過 manifest 的 20% 就中止
 */
export const PUBLIC_PREFIXES = ['video/', 'gpx/'] as const;
export const MAX_REVOKE_RATIO = 0.2;

export const allowedKey = (k: string): boolean =>
  PUBLIC_PREFIXES.some((p) => k.startsWith(p)) && !k.includes('..') && !k.includes('//') && !/[\s*?]/.test(k) && !k.endsWith('/');

export interface PromotePlan {
  copy: string[];
  alreadyPublic: string[];
  /** 私有端也沒有：代表依賴沒有一起上傳，必須中止 */
  missing: string[];
}

export function planPromote(args: { manifest: readonly string[]; privateKeys: ReadonlySet<string>; publicKeys: ReadonlySet<string> }): PromotePlan {
  const bad = args.manifest.filter((k) => !allowedKey(k));
  if (bad.length) throw new Error(`manifest 含有不允許公開的 key：${bad.join(', ')}（只允許 ${PUBLIC_PREFIXES.join('、')}）`);
  const uniq = [...new Set(args.manifest)].sort();
  return {
    copy: uniq.filter((k) => !args.publicKeys.has(k) && args.privateKeys.has(k)),
    alreadyPublic: uniq.filter((k) => args.publicKeys.has(k)),
    missing: uniq.filter((k) => !args.publicKeys.has(k) && !args.privateKeys.has(k)),
  };
}

export type RevokePlan = { ok: true; keys: string[] } | { ok: false; keys: string[]; reason: string };

export function planRevoke(args: { promoted: ReadonlySet<string>; manifest: ReadonlySet<string>; publicKeys: ReadonlySet<string> }): RevokePlan {
  // promoted 裡有、新 manifest 已不再引用、而且公開端確實還在
  const keys = [...args.promoted].filter((k) => !args.manifest.has(k) && args.publicKeys.has(k) && allowedKey(k)).sort();
  const limit = Math.max(1, Math.floor(args.manifest.size * MAX_REVOKE_RATIO));
  if (args.manifest.size > 0 && keys.length > limit) {
    return { ok: false, keys, reason: `要撤回 ${keys.length} 個，超過上限 ${limit}（manifest ${args.manifest.size} 個的 20%）` };
  }
  return { ok: true, keys };
}
