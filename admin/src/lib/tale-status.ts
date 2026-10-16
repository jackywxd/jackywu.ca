/** 文章在列表與編輯頁顯示的狀態。純函式。 */
export type StatusKey = 'draft' | 'queued' | 'building' | 'failed' | 'live' | 'live-edited';
export interface Status { key: StatusKey; label: string; /** 畫面上用文字加符號表達，不另外發明顏色 */ mark: string }

export interface ReqLite { status: 'queued' | 'dispatched' | 'deployed' | 'failed'; kind: 'publish' | 'unpublish' | 'delete'; createdAt: number }

const S: Record<StatusKey, Status> = {
  draft: { key: 'draft', label: '草稿', mark: '✎' },
  queued: { key: 'queued', label: '排隊中', mark: '…' },
  building: { key: 'building', label: '部署中', mark: '↻' },
  failed: { key: 'failed', label: '發佈失敗', mark: '⚠' },
  live: { key: 'live', label: '已上線', mark: '印' },
  'live-edited': { key: 'live-edited', label: '已上線．有未發佈的變更', mark: '印' },
};

export function deriveStatus(args: { live: boolean; latest: 'draft' | 'published'; request?: ReqLite | null }): Status {
  const r = args.request;
  if (r?.status === 'queued') return S.queued;
  if (r?.status === 'dispatched') return S.building;
  if (r?.status === 'failed') return S.failed;
  if (args.live) return args.latest === 'published' ? S.live : S['live-edited'];
  return S.draft;
}

/** 每篇文章最新的一筆請求。已成功（deployed）的不用顯示，狀態由文章本身決定。 */
export function latestRequestByDoc<T extends ReqLite & { docId: string }>(reqs: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of [...reqs].sort((a, b) => a.createdAt - b.createdAt)) m.set(r.docId, r);
  return m;
}

export function groupByYear<T extends { date?: string | null }>(docs: readonly T[]): { year: string; items: T[] }[] {
  const by = new Map<string, T[]>();
  for (const d of docs) {
    // 沒有日期的新稿放在最前面（「未定」），避免被吞掉
    const y = d.date && /^\d{4}/.test(d.date) ? d.date.slice(0, 4) : '未定';
    (by.get(y) ?? by.set(y, []).get(y)!).push(d);
  }
  const rank = (y: string) => (y === '未定' ? Infinity : Number(y));
  return [...by]
    .sort((a, b) => rank(b[0]) - rank(a[0]))
    .map(([year, items]) => ({ year, items: items.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))) }));
}
