import { createEditor, type LexicalEditor } from 'lexical';
import { EDITOR_NODES } from './nodes';

export type EditorStateJSON = { root: Record<string, unknown> };

/** 編輯器載入既有內容。解析失敗（節點不認得）要丟錯，不能默默載成空白——那會讓下一次自動存檔把整篇洗掉。 */
export function loadState(editor: LexicalEditor, json: EditorStateJSON) {
  const state = editor.parseEditorState(json as never);
  editor.setEditorState(state);
}

export function exportState(editor: LexicalEditor): EditorStateJSON {
  return editor.getEditorState().toJSON() as unknown as EditorStateJSON;
}

/** 無頭（沒有 DOM）的編輯器：給測試與伺服器端驗證用 */
export async function headlessRoundTrip(json: EditorStateJSON): Promise<EditorStateJSON> {
  const { createHeadlessEditor } = await import('@lexical/headless');
  const ed = createHeadlessEditor({ namespace: 'rt', nodes: EDITOR_NODES, onError: (e) => { throw e; } });
  const state = ed.parseEditorState(json as never);
  ed.setEditorState(state);
  return ed.getEditorState().toJSON() as unknown as EditorStateJSON;
}

export const emptyState = (): EditorStateJSON => ({
  root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [
    { type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', textFormat: 0, textStyle: '', children: [] },
  ] },
});
