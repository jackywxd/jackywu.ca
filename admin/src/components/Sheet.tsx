'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

/**
 * 後台所有的抽屜與對話框。原生 <dialog> 的 showModal()：背景自動 inert（點不到、讀屏讀不到）、
 * 疊在最上層（不被頁面的 z-index 蓋住），抽屜裡再開抽屜（設定裡選封面圖）也會正確堆疊。
 *
 *  · 版型：手機一律是底部抽屜；桌面依 size——form 右側面板、wide 寬面板（預覽、原始碼）、confirm 置中的小對話框。
 *    full 在手機上佔滿整個畫面（打原始碼、看預覽需要高度），桌面同 wide。
 *  · 標題列固定在上方、有關閉鍵；footer（主要動作）固定在下方：「完成」不必捲到最底才按得到。
 *  · 鍵盤：Esc 關閉；打開時焦點放在第一個出錯的欄位（因為欄位沒過而打開），沒有的話放在標題上——
 *    放在第一個欄位的話，焦點框會讓那一格看起來像是錯的。focus="field" 例外（加入連結：打開就是要打字）。
 *    關閉後焦點回到原本的位置。
 *
 * 先前九個抽屜各寫各的 .sheet：桌面上是一條橫跨整個螢幕的底部抽屜，只有一個有 Esc 與焦點處理。
 */
export function Sheet({ label, title, subtitle, onClose, footer, children, size = 'form', focus = 'title', onSubmit }: {
  /** 無障礙名稱（e2e 以它找對話框）；畫面上的標題可以不同 */
  label: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** 固定在底部的主要動作 */
  footer?: ReactNode;
  children?: ReactNode;
  size?: 'form' | 'wide' | 'full' | 'confirm';
  focus?: 'title' | 'field';
  /** 給了就整個面板是一個 <form>（footer 裡的 submit 按鈕送出它） */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  // 打開前的焦點在第一次 render 時記下：effect 裡記的話，開發模式（StrictMode 把 effect 跑兩次）第二次記到的
  // 是抽屜自己的標題，關閉後焦點就掉到 <body>
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const el = panel.current;
    const target = el?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? (focus === 'field' ? el?.querySelector<HTMLElement>('input, select, textarea') : null)
      ?? heading.current;
    // showModal 有自己的「決定焦點」步驟（WebKit 的時機不一定和這裡同步）：先把目標標成 autofocus，
    // 讓瀏覽器選的和我們選的是同一個——否則它晚一步把焦點搬到別處，剛打開就打的字會打空（e2e 在 WebKit 撞到過）
    if (target) target.autofocus = true;
    if (!d.open) d.showModal();
    target?.focus();
    // Esc：瀏覽器會自己關掉 <dialog>，但開關由 React 決定——擋下來，交給 onClose
    const cancel = (e: Event) => { e.preventDefault(); close.current(); };
    d.addEventListener('cancel', cancel);
    return () => {
      d.removeEventListener('cancel', cancel);
      if (d.open) d.close(); // 先離開 modal（背景解除 inert），焦點才還得回去
      opener?.focus?.();
    };
  }, [focus, opener]);

  const body = (
    <>
      <header className="sheet-head">
        <div className="sheet-titles">
          <h2 id={titleId} ref={heading} tabIndex={-1}>{title ?? label}</h2>
          {subtitle ? <p id={`${titleId}-sub`} className="hint">{subtitle}</p> : null}
        </div>
        <button type="button" className="sheet-close" aria-label="關閉" onClick={onClose}>×</button>
      </header>
      <div className="sheet-body">{children}</div>
      {footer ? <footer className="sheet-foot">{footer}</footer> : null}
    </>
  );

  return (
    <dialog ref={dialog} className={`sheet-host sheet-host--${size}`} aria-label={label} aria-describedby={subtitle ? `${titleId}-sub` : undefined}>
      <div className="sheet-backdrop" onClick={onClose} />
      {onSubmit ? (
        <form ref={panel as React.RefObject<HTMLFormElement>} className="sheet" onSubmit={onSubmit}>{body}</form>
      ) : (
        <div ref={panel as React.RefObject<HTMLDivElement>} className="sheet">{body}</div>
      )}
    </dialog>
  );
}
