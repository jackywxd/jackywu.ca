/**
 * 文章設定表單的欄位宣告。畫面由這份清單產生，
 * 靜態檢查（test/tale-form.test.ts）逐一核對 Payload 的 tales 集合：
 * 必填欄位沒有控制項、或清單裡的名字在集合裡已經不存在，測試就失敗。
 */
export type FieldKind = 'text' | 'slug' | 'date' | 'select-realm' | 'select-lang' | 'textarea-excerpt' | 'text-verse' | 'tags' | 'checkbox' | 'media' | 'text-alt' | 'select-reel' | 'select-route';

export interface FormField { name: string; label: string; kind: FieldKind; hint?: string }

export const TALE_FORM_FIELDS: FormField[] = [
  { name: 'slug', label: '網址代稱', kind: 'slug', hint: '小寫英數與連字號，例如 whistler-100k。中文標題要自己取一個。' },
  { name: 'date', label: '日期', kind: 'date', hint: '事情發生的日子（不是寫文章的日子）。決定它在哪一年。' },
  { name: 'realm', label: '行當', kind: 'select-realm' },
  { name: 'excerpt', label: '摘要', kind: 'textarea-excerpt', hint: '給搜尋與分享卡片看的，約 10–100 個中文字。' },
  { name: 'verse', label: '金句', kind: 'text-verse', hint: '海報上的一句話，約 40 個中文字以內。' },
  { name: 'tags', label: '標籤', kind: 'tags', hint: '用逗號分開。' },
  { name: 'lang', label: '語言', kind: 'select-lang' },
  { name: 'featured', label: '精選', kind: 'checkbox' },
  { name: 'shareable', label: '產生分享海報', kind: 'checkbox', hint: '「靜」類的私人文章不產生。' },
  { name: 'hero', label: '封面圖', kind: 'media' },
  { name: 'heroAlt', label: '封面圖的替代文字', kind: 'text-alt', hint: '有封面圖就必須填（無障礙要求）。' },
  { name: 'video', label: '影片', kind: 'select-reel' },
  { name: 'route', label: '路線', kind: 'select-route' },
];

/** 不在設定表單裡、但在頁面其他地方有控制項的必填欄位 */
export const CONTROLLED_ELSEWHERE: Record<string, string> = {
  title: '頁面最上方的標題輸入框',
  content: '編輯器本體',
};

/** 必填欄位裡，表單與頁面上都沒有控制項的（應該是空的：否則使用者被要求填一個畫面上找不到的東西） */
export function missingControls(required: readonly string[], form: readonly FormField[] = TALE_FORM_FIELDS, elsewhere: Record<string, string> = CONTROLLED_ELSEWHERE): string[] {
  const names = new Set(form.map((f) => f.name));
  return required.filter((n) => !names.has(n) && !(n in elsewhere));
}
