/**
 * 測試只錨定在「刻意存在」的內容上。
 *
 * FIXTURE 要的是一篇**文章**：分享面板、h1、搜尋結果都只有文章版型才有。
 * 挑 2019 溫哥華馬拉松，因為它已經是 LEGACY_REDIRECT 的目標 —— 舊站有外部連結
 * 指著它，轉址表裡有它，它不會被刪。再多錨一個測試不增加新的假設。
 *
 * （原本錨在 writing-reference，那篇後來擴寫成 /manual/ 凡例並搬進 pages
 * collection。凡例是單頁版型，沒有分享面板，頂不了 FIXTURE 的位；
 * 它自己的覆蓋在 MANUAL 那一組。）
 *
 * 這個站是純靜態的，測試不寫入任何東西：沒有資料庫、沒有帳號、沒有要清的列。
 * 瀏覽器狀態（localStorage、剪貼簿權限）每個測試都是新的 context，不會互相殘留。
 */
export const FIXTURE = {
  path: '/tales/2019/vancouver-marathon-2019/',
  title: '溫哥華馬拉松 2019',
} as const;

/**
 * 凡例：站上唯一一頁「每個 MDX 元件都實際跑一次」的地方。
 * 它存在的理由就是元件壞了要看得見，所以值得一支便宜的測試盯著它。
 */
export const MANUAL = {
  path: '/manual/',
  title: '凡例',
  /** 這一頁實際放了幾個 <Route>。改凡例的內容時一起改 */
  routes: 4,
} as const;

/** 舊站網址 → 新站，取自 public/_redirects。挑一條 301、一條含 %20 的（gotcha：空格必須編碼） */
export const LEGACY_REDIRECT = {
  from: '/blog/2019/2019-05-05%20vancouver',
  to: '/tales/2019/vancouver-marathon-2019/',
  status: 301,
} as const;
