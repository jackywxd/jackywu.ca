/** 斜線選單：項目與過濾。純邏輯。 */
export type SlashId =
  | 'p' | 'h2' | 'h3' | 'h4' | 'quote' | 'ul' | 'ol' | 'hr' | 'table'
  | 'figure' | 'gallery' | 'video' | 'route' | 'missingImage' | 'inkRule' | 'code';

export interface SlashItem { id: SlashId; label: string; hint: string; keywords: string[] }

export const SLASH_ITEMS: readonly SlashItem[] = [
  { id: 'p', label: '內文', hint: '一般段落', keywords: ['p', 'text', 'paragraph', '內文', '段落', '文字'] },
  { id: 'h2', label: '標題 2', hint: '大標', keywords: ['h2', 'heading', '標題', '大標'] },
  { id: 'h3', label: '標題 3', hint: '中標', keywords: ['h3', 'heading', '標題', '中標'] },
  { id: 'h4', label: '標題 4', hint: '小標', keywords: ['h4', 'heading', '標題', '小標'] },
  { id: 'quote', label: '引言', hint: '縮排的引文', keywords: ['quote', 'blockquote', '引言', '引用'] },
  { id: 'ul', label: '項目清單', hint: '圓點', keywords: ['ul', 'list', 'bullet', '清單', '項目'] },
  { id: 'ol', label: '編號清單', hint: '1. 2. 3.', keywords: ['ol', 'list', 'number', '編號', '清單'] },
  { id: 'figure', label: '圖', hint: '單張圖與圖說', keywords: ['image', 'figure', 'photo', 'pic', '圖', '圖片', '照片'] },
  { id: 'gallery', label: '圖組', hint: '並排幾張圖', keywords: ['gallery', 'images', '圖組', '相簿', '多張'] },
  { id: 'video', label: '影片', hint: '站上的影片', keywords: ['video', 'movie', '影片', '視頻'] },
  { id: 'route', label: '路線', hint: '爬升剖面與軌跡', keywords: ['route', 'gpx', 'map', 'profile', '路線', '軌跡', '剖面'] },
  { id: 'missingImage', label: '待補圖', hint: '舊圖留白', keywords: ['missing', 'placeholder', '待補', '留白'] },
  { id: 'inkRule', label: '墨線', hint: '水墨分隔', keywords: ['ink', 'rule', 'divider', '墨線', '分隔'] },
  { id: 'hr', label: '分隔線', hint: '細橫線', keywords: ['hr', 'divider', 'line', '分隔線', '橫線'] },
  { id: 'table', label: '表格', hint: '3×3', keywords: ['table', 'grid', '表格'] },
  { id: 'code', label: '程式碼', hint: '等寬字與語法上色', keywords: ['code', 'pre', 'snippet', '程式', '程式碼', '代碼'] },
];

/** 輸入 `/` 之後的字：開頭符合者優先，其次包含者；順序穩定；不分大小寫 */
export function filterSlash(query: string, items: readonly SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const score = (it: SlashItem) => {
    const hay = [it.label, ...it.keywords].map((s) => s.toLowerCase());
    if (hay.some((h) => h.startsWith(q))) return 0;
    if (hay.some((h) => h.includes(q))) return 1;
    return 2;
  };
  return items
    .map((it, i) => ({ it, s: score(it), i }))
    .filter((x) => x.s < 2)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.it);
}
