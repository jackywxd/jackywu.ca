'use client';
import { useEffect, useRef } from 'react';

/**
 * 底部抽屜的鍵盤行為：打開時焦點移進第一個出錯的欄位，沒有就第一個可操作的控制項，Esc 關閉，關閉後焦點回到原本的位置。
 * 宣告了 aria-modal 卻不移焦點，用鍵盤或讀屏的人根本不知道抽屜開了。
 */
export function useSheet<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // 因為欄位沒過而打開：焦點放在第一個出錯的欄位（focus 會捲到它）。放在第一個欄位的話，朱砂色的焦點框會讓那一格看起來像是錯的
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? el?.querySelector<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'))?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current(); } };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); before?.focus?.(); };
  }, []);
  return ref;
}
