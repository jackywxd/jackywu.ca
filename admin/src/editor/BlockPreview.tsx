'use client';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { BlockFields } from './nodes/BlockNode';
import { EDIT_BLOCK_COMMAND } from './commands';

/** 編輯器裡區塊的示意（不是前台的真實渲染；真實渲染以發佈的建置結果為準） */
export const BLOCK_LABELS: Record<string, string> = {
  figure: '圖', gallery: '圖組', video: '影片', route: '路線', missingImage: '待補圖', inkRule: '墨線', code: '程式碼', rawMdx: '無法轉換的內容',
};

export function blockDetail(f: BlockFields): string {
  switch (f.blockType) {
    case 'figure': return f.media ? `${f.caption ? String(f.caption) : '已選圖'}` : '尚未選圖';
    case 'gallery': return `${Array.isArray(f.items) ? f.items.length : 0} 張`;
    case 'video': return f.reel ? '已選影片' : '尚未選影片';
    case 'route': return f.route ? `${String(f.show ?? 'profile')}` : '尚未選路線';
    case 'missingImage': return String(f.original ?? '');
    case 'code': return `${String(f.language ?? '') || 'text'}・${String(f.code ?? '').split('\n').length} 行`;
    case 'rawMdx': return '必須改寫或移除才能發佈';
    default: return '';
  }
}

/** 還缺什麼才能發佈：畫面上直接提示，不等發佈時才被擋 */
export function blockProblem(f: BlockFields): string | null {
  if (f.blockType === 'figure' && !f.media) return '還沒選圖';
  if (f.blockType === 'gallery' && (!Array.isArray(f.items) || !f.items.length)) return '圖組是空的';
  if (f.blockType === 'video' && !f.reel) return '還沒選影片';
  if (f.blockType === 'route' && !f.route) return '還沒選路線';
  if (f.blockType === 'rawMdx') return '這段內容無法在網站上顯示';
  return null;
}

export function BlockPreview({ nodeKey, fields }: { nodeKey: string; fields: BlockFields }) {
  const [editor] = useLexicalComposerContext();
  const label = BLOCK_LABELS[fields.blockType] ?? fields.blockType;
  const problem = blockProblem(fields);
  const detail = blockDetail(fields);
  return (
    <button
      type="button"
      className={`ed-block-card ed-block-card--${fields.blockType}`}
      data-node-key={nodeKey}
      data-problem={problem ? 'true' : undefined}
      aria-label={`${label}：${problem ?? detail}。點一下編輯`}
      onClick={() => editor.dispatchCommand(EDIT_BLOCK_COMMAND, nodeKey)}
    >
      <strong>{label}</strong>
      <span className="muted">{detail}</span>
      {problem ? <span className="field-error">{problem}</span> : null}
    </button>
  );
}
