'use client';
import { useEffect, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import type { LexicalEditor } from 'lexical';
import { EDITOR_NODES } from './nodes';
import { emptyState, exportState, type EditorStateJSON } from './serialize';
import { TRANSFORMERS, MARKDOWN_HINTS } from './transformers';
import { Toolbar } from './Toolbar';
import { SlashPlugin } from './SlashPlugin';
import { BlockSheet } from './BlockSheet';
import { LinkDialog, validateLink } from './LinkDialog';

const theme = {
  paragraph: 'ed-p', quote: 'ed-quote', heading: { h2: 'ed-h2', h3: 'ed-h3', h4: 'ed-h4' },
  list: { ul: 'ed-ul', ol: 'ed-ol', listitem: 'ed-li', nested: { listitem: 'ed-li-nested' } },
  link: 'ed-link', text: { bold: 'ed-bold', italic: 'ed-italic', strikethrough: 'ed-strike', code: 'ed-code' },
  table: 'ed-table', tableCell: 'ed-td', tableCellHeader: 'ed-th', hr: 'ed-hr',
};

function EditorApi({ apiRef }: { apiRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => { apiRef.current = editor; return () => { apiRef.current = null; }; }, [editor, apiRef]);
  return null;
}

export interface EditorProps {
  initial: EditorStateJSON | null;
  onChange: (json: EditorStateJSON) => void;
  /** 上傳進行中：外層據此擋住存檔與發佈 */
  onBusy?: (busy: boolean) => void;
  /** 外層要讀取目前是否在中文輸入法組字中、或取得 editor 實例時用 */
  apiRef?: React.MutableRefObject<LexicalEditor | null>;
}

export function Editor({ initial, onChange, onBusy, apiRef }: EditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const localRef = useRef<LexicalEditor | null>(null);
  const ref = apiRef ?? localRef;
  const first = useRef(true);

  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'tale', nodes: EDITOR_NODES, theme,
        // 載入失敗（節點不認得）要大聲：寧可打不開，也不要載成空白再被自動存檔洗掉整篇
        onError: (e) => { throw e; },
        editorState: JSON.stringify(initial ?? emptyState()),
      }}
    >
      <EditorApi apiRef={ref} />
      <div className="ed">
        <Toolbar onRequestLink={() => setLinkOpen(true)} />
        <div className="ed-surface">
          <RichTextPlugin
            contentEditable={<ContentEditable className="ed-content" aria-label="文章內文" aria-multiline="true" />}
            placeholder={<div className="ed-placeholder" aria-hidden="true">從這裡開始寫。輸入 / 可以插入圖、影片、路線…</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <details className="ed-hints"><summary>Markdown 快捷鍵</summary><p>{MARKDOWN_HINTS.join('　')}</p></details>
        <HistoryPlugin /><ListPlugin /><TablePlugin /><HorizontalRulePlugin />
        <LinkPlugin validateUrl={(u) => validateLink(u) === null} />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <SlashPlugin />
        <BlockSheet onBusy={onBusy} />
        <OnChangePlugin ignoreSelectionChange onChange={(state) => {
          // 第一次是載入本身，不算變更
          if (first.current) { first.current = false; return; }
          onChange(state.toJSON() as unknown as EditorStateJSON);
        }} />
        {linkOpen ? <LinkInsert onClose={() => setLinkOpen(false)} /> : null}
      </div>
    </LexicalComposer>
  );
}

function LinkInsert({ onClose }: { onClose: () => void }) {
  const [editor] = useLexicalComposerContext();
  return <LinkDialog initial="https://" onCancel={onClose} onSubmit={(url) => { editor.dispatchCommand(TOGGLE_LINK_COMMAND, { url, target: /^https?:/i.test(url) ? '_blank' : null, rel: /^https?:/i.test(url) ? 'noopener noreferrer' : null }); onClose(); }} />;
}

export { exportState };
