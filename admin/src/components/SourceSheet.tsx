'use client';
import { useRef } from 'react';
import type { Problem } from '../lib/mdx-import';
import { Sheet } from './Sheet';

/** 「行 320」→ 320；沒有行號（例如 frontmatter）回 null */
export const lineOf = (where: string): number | null => {
  const n = Number(where.match(/行\s*(\d+)/)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** 第 n 行在整段文字裡的起訖（給 setSelectionRange）。超出範圍就停在最後一行 */
export function lineRange(text: string, n: number): [number, number] {
  const lines = text.split('\n');
  const i = Math.min(n, lines.length) - 1;
  const start = lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
  return [start, start + lines[i]!.length];
}

/**
 * 第 pos 個字在 textarea 裡的垂直位置（考慮自動換行）。用一個樣式相同、看不見的鏡像元素量：
 * 只靠瀏覽器在 focus 時「把選取捲進可見範圍」不可靠（實測 Chrome 停在文末）。
 */
function caretTop(el: HTMLTextAreaElement, pos: number): number {
  const cs = getComputedStyle(el);
  const div = document.createElement('div');
  for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak'] as const) div.style[k] = cs[k];
  Object.assign(div.style, { position: 'fixed', insetBlockStart: '0', insetInlineStart: '0', visibility: 'hidden', boxSizing: 'border-box', inlineSize: `${el.clientWidth}px`, border: '0' });
  div.textContent = el.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  div.appendChild(mark);
  document.body.appendChild(div);
  const top = mark.offsetTop;
  div.remove();
  return top;
}

/**
 * 原始碼模式：整篇的 MDX。編輯框撐滿抽屜（手機上佔滿畫面）；套用沒過時列出每個問題，
 * 點一下就跳到那一行並選起來——錯誤訊息寫「行 320」，編輯框卻沒有行號，先前只能自己數。
 */
export function SourceSheet({ text, problems, onChange, onApply, onClose }: {
  text: string; problems: Problem[]; onChange: (text: string) => void; onApply: () => void; onClose: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const jump = (n: number) => {
    const el = ta.current;
    if (!el) return;
    const [a, b] = lineRange(text, n);
    el.focus();
    el.setSelectionRange(a, b);
    el.scrollTop = Math.max(0, caretTop(el, a) - el.clientHeight / 3);
  };
  return (
    <Sheet label="原始碼" title="原始碼（MDX）" size="full" onClose={onClose}
      subtitle="圖、影片、路線用 media:12、reel:3、route:9 這種參照，不要改成別的格式。改完按「套用」。"
      footer={<>
        {problems.length ? <span className="hint spacer">有 {problems.length} 個問題，還沒套用</span> : <span className="spacer" />}
        <button type="button" className="btn btn--ghost" onClick={onClose}>取消</button>
        <button type="button" className="btn" onClick={onApply}>套用</button>
      </>}>
      <div className="source-body">
        {problems.length ? (
          <div className="alert" role="alert"><strong>沒有套用：</strong>
            <ul className="problems">{problems.map((p, i) => {
              const n = lineOf(p.where);
              return <li key={i}>{n ? <button type="button" onClick={() => jump(n)}>{p.where}：{p.message}</button> : `${p.where}：${p.message}`}</li>;
            })}</ul></div>
        ) : null}
        <textarea ref={ta} className="textarea mono source-text" spellCheck={false} autoCapitalize="none" autoCorrect="off" aria-label="MDX 原始碼"
          value={text} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Sheet>
  );
}
