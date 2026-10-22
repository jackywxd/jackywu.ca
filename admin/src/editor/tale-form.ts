/**
 * 文章設定表單的欄位宣告。畫面由這份清單產生，
 * 靜態檢查（test/tale-form.test.ts）逐一核對 Payload 的 tales 集合：
 * 必填欄位沒有控制項、或清單裡的名字在集合裡已經不存在，測試就失敗。
 */
export type FieldKind = 'text' | 'slug' | 'date' | 'select-realm' | 'select-lang' | 'textarea-excerpt' | 'text-verse' | 'tags' | 'checkbox' | 'media' | 'text-alt' | 'select-reel' | 'select-route';

/** 設定抽屜裡的分組（畫面依這個順序排）。basic 是發佈必填的那幾項 */
export type FieldGroup = 'basic' | 'cover' | 'links' | 'share' | 'more';
export const FIELD_GROUPS: { id: FieldGroup; label: string; hint?: string }[] = [
  { id: 'basic', label: '基本', hint: '發佈必填' },
  { id: 'cover', label: '封面' },
  { id: 'links', label: '路線與影片' },
  { id: 'share', label: '分享' },
  { id: 'more', label: '其他' },
];

export interface FormField { name: string; label: string; kind: FieldKind; group: FieldGroup; hint?: string }

export const TALE_FORM_FIELDS: FormField[] = [
  { name: 'slug', label: '網址代稱', kind: 'slug', group: 'basic', hint: '小寫英數與連字號，例如 whistler-100k。中文標題要自己取一個。' },
  { name: 'date', label: '日期', kind: 'date', group: 'basic', hint: '事情發生的日子（不是寫文章的日子）。決定它在哪一年。' },
  { name: 'realm', label: '行當', kind: 'select-realm', group: 'basic' },
  { name: 'excerpt', label: '摘要', kind: 'textarea-excerpt', group: 'basic', hint: '給搜尋與分享卡片看的，約 10–100 個中文字。' },
  { name: 'tags', label: '標籤', kind: 'tags', group: 'basic', hint: '用逗號分開。' },
  { name: 'hero', label: '封面圖', kind: 'media', group: 'cover' },
  { name: 'heroAlt', label: '封面圖的替代文字', kind: 'text-alt', group: 'cover', hint: '有封面圖就必須填（無障礙要求）。' },
  { name: 'route', label: '路線', kind: 'select-route', group: 'links' },
  { name: 'video', label: '影片', kind: 'select-reel', group: 'links' },
  { name: 'verse', label: '金句', kind: 'text-verse', group: 'share', hint: '海報上的一句話，約 40 個中文字以內。' },
  { name: 'shareable', label: '產生分享海報', kind: 'checkbox', group: 'share', hint: '「靜」類的私人文章不產生。' },
  { name: 'lang', label: '語言', kind: 'select-lang', group: 'more' },
  { name: 'featured', label: '精選', kind: 'checkbox', group: 'more' },
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
