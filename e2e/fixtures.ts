/**
 * 測試只錨定在「刻意存在」的內容上。
 *
 * writing-reference 是 docs/components.md 指定的範例文章：它存在的理由就是
 * 「改了元件之後看這一頁，壞了立刻知道——包括線上壞了」。拿一般文章當錨點，
 * 作者刪掉那篇時測試會為了不相干的理由變紅。
 *
 * 這個站是純靜態的，測試不寫入任何東西：沒有資料庫、沒有帳號、沒有要清的列。
 * 瀏覽器狀態（localStorage、剪貼簿權限）每個測試都是新的 context，不會互相殘留。
 */
export const FIXTURE = {
  path: '/tales/2026/writing-reference/',
  title: '寫作參考',
} as const;

/** 舊站網址 → 新站，取自 public/_redirects。挑一條 301、一條含 %20 的（gotcha：空格必須編碼） */
export const LEGACY_REDIRECT = {
  from: '/blog/2019/2019-05-05%20vancouver',
  to: '/tales/2019/vancouver-marathon-2019/',
  status: 301,
} as const;
