/** 本機草稿備份：網路不通或分頁當掉時的最後防線。只存在這台裝置的瀏覽器。 */
export interface LocalDraft { meta: Record<string, unknown>; content: unknown; at: number; baseUpdatedAt?: string | null }

const key = (id: string | null) => `tale-draft:${id ?? 'new'}`;

export function readLocal(id: string | null, store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): LocalDraft | null {
  try {
    const raw = store?.getItem(key(id));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch { return null; }
}
export function writeLocal(id: string | null, d: LocalDraft, store: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try { store?.setItem(key(id), JSON.stringify(d)); } catch { /* 容量滿或無痕模式：沒有備份也不能擋住存檔 */ }
}
export function clearLocal(id: string | null, store: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try { store?.removeItem(key(id)); } catch { /* 同上 */ }
}

/**
 * 載入時比對本機備份與伺服器版本。
 *  · 沒有備份 → 用伺服器
 *  · 備份是在「伺服器目前這一版」之後寫的 → 本機較新，問使用者
 *  · 伺服器在備份之後又被改過（另一台裝置）→ 衝突，兩邊都給使用者看，不自動覆蓋任何一邊
 */
export function compareLocal(local: LocalDraft | null, serverUpdatedAt: string | null): 'use-server' | 'local-newer' | 'conflict' {
  if (!local) return 'use-server';
  if (!serverUpdatedAt) return 'local-newer';
  const server = Date.parse(serverUpdatedAt);
  if (local.baseUpdatedAt && Date.parse(local.baseUpdatedAt) < server) return 'conflict';
  return local.at > server ? 'local-newer' : 'use-server';
}
