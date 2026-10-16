import { blockProblem } from './BlockPreview';
import type { BlockFields } from './nodes/BlockNode';
import type { EditorStateJSON } from './serialize';

/** 發佈前能在瀏覽器就看出來的內容問題：每個區塊缺什麼。純函式。 */
export function blockProblems(state: EditorStateJSON | null): { index: number; blockType: string; message: string }[] {
  const out: { index: number; blockType: string; message: string }[] = [];
  const kids = (state?.root?.children ?? []) as { type: string; fields?: BlockFields }[];
  let n = 0;
  for (const k of kids) {
    if (k.type !== 'block' || !k.fields) continue;
    n++;
    const m = blockProblem(k.fields);
    if (m) out.push({ index: n, blockType: k.fields.blockType, message: m });
  }
  return out;
}

/** 標題與內文是不是空的（空白稿不能發佈） */
export function isBlank(title: string, state: EditorStateJSON | null): boolean {
  const text = JSON.stringify(state?.root?.children ?? []);
  return !title.trim() && !/"text":"[^"]+"/.test(text) && !/"type":"block"/.test(text);
}
