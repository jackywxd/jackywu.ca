/** satori 吃的是 React-element 形狀的物件，不需要 React runtime —— 這個就夠了。 */
export type Node = string | number | null | undefined | false | { type: string; props: Record<string, unknown> };

export const h = (
  type: string,
  props: Record<string, unknown> | null,
  ...children: (Node | Node[])[]
) => {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== '');
  const style = { ...((props?.style as Record<string, unknown>) ?? {}) };

  // satori 沒有 block 排版：任何有內容的 div 都必須有 display，
  // 連「單一純字串子節點」也不例外（已用最小重現確認，錯誤訊息說的
  // 「more than one child node」與實際判斷式不符）。一律補 flex。
  // 連「零子節點」的 div 也要補：satori 的判斷式是 children && typeof !== 'string'，
  // 而空陣列在 JS 裡是 truthy，所以純裝飾用的空 div（例如分隔線）一樣會炸。
  if (type === 'div' && !style.display) style.display = 'flex';

  return { type, props: { ...(props ?? {}), style, children: kids } };
};
