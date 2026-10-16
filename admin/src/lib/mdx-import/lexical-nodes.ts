/** Payload（Lexical）節點的建構輔助。欄位與 Payload 預設編輯器輸出的一致，編輯器才打得開。 */
type Json = Record<string, unknown>;
const base = { format: '', indent: 0, version: 1, direction: 'ltr' } as const;

export const FORMAT = { bold: 1, italic: 2, strike: 4, underline: 8, code: 16, sub: 32, sup: 64 } as const;

export const text = (t: string, format = 0): Json => ({ type: 'text', detail: 0, format, mode: 'normal', style: '', text: t, version: 1 });
export const linebreak = (): Json => ({ type: 'linebreak', version: 1 });
export const paragraph = (children: Json[]): Json => ({ ...base, type: 'paragraph', textFormat: 0, textStyle: '', children });
export const heading = (level: 2 | 3 | 4, children: Json[]): Json => ({ ...base, type: 'heading', tag: `h${level}`, children });
export const quote = (children: Json[]): Json => ({ ...base, type: 'quote', children });
export const hr = (): Json => ({ type: 'horizontalrule', version: 1 });
// Lexical 原生 LinkNode 的形狀（編輯器直接載入，不需要自訂節點）。前台兩種形狀都看得懂。
// 不開新分頁：MDX 的 [文字](網址) 本來就不開，匯入之後行為不能變（先前外站連結全被改成 target=_blank）
export const link = (url: string, children: Json[], newTab = false): Json =>
  ({ ...base, type: 'link', url, target: newTab ? '_blank' : null, rel: newTab ? 'noopener noreferrer' : null, title: null, children });
export const list = (ordered: boolean, children: Json[], start = 1): Json => ({
  ...base, type: 'list', listType: ordered ? 'number' : 'bullet', start, tag: ordered ? 'ol' : 'ul', children,
});
export const listItem = (value: number, children: Json[]): Json => ({ ...base, type: 'listitem', value, children });
export const tableCell = (header: boolean, children: Json[]): Json => ({
  ...base, type: 'tablecell', headerState: header ? 1 : 0, colSpan: 1, rowSpan: 1, children: [paragraph(children)],
});
export const tableRow = (children: Json[]): Json => ({ ...base, type: 'tablerow', children });
export const table = (children: Json[]): Json => ({ ...base, type: 'table', children });
export const root = (children: Json[]): Json => ({ root: { ...base, type: 'root', children } });

let n = 0;
/** 區塊 id：確定性（同一輸入同一輸出），測試與還原演練才比得起來 */
export const block = (fields: Json, ids = { next: () => `blk${String(++n).padStart(6, '0')}` }): Json => ({
  type: 'block', format: '', version: 2, fields: { id: ids.next(), ...fields },
});
export const resetBlockIds = () => { n = 0; };
