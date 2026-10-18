'use client';
import { createContext, useContext } from 'react';

/**
 * 編輯器裡的區塊需要知道「這篇文章」的幾件事：在路線區塊裡上傳時，用文章的日期與行當預填；
 * 建好之後可以一鍵設成文章的路線。編輯器本身不認得文章，所以由 TaleEditor 提供。
 */
export interface TaleInfo {
  date?: string;
  realm?: string;
  /** 文章目前的路線（frontmatter 的 route） */
  route?: number | string | null;
  setTaleRoute?: (id: number | string) => void;
}
export const TaleContext = createContext<TaleInfo>({});
export const useTale = () => useContext(TaleContext);
