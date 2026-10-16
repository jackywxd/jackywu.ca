# ADR 0001：Payload 只當後台，前台維持靜態 Astro

狀態：採用（2026-10）

## 背景

站是純靜態的 Astro。寫文章要開本機、跑 `pnpm new`／`video`／`gpx`、push。
目標是在 `admin.jackywu.ca` 全程用瀏覽器完成編輯，按「發佈」後無人值守上線，
之後還要能擴充留言管理。內容幾乎是從零開始，沒有歷史包袱要保護。

## 比較過的三個方案

| | A. 維持 git 為正本，後台只改檔 | B. 整站搬進 Payload（SSR） | **C. Payload 後台＋靜態前台** |
|---|---|---|---|
| 讀者端可用性 | 靜態資產 | 依賴 Worker＋D1 | 靜態資產 |
| 編輯體驗 | 要自己造 | 現成 | 現成 |
| 字型子集、satori、Pagefind、時光機、postbuild 檢查 | 保留 | 全部要重做或放棄 | 保留 |
| 未發佈內容的洩漏面 | 草稿得放分支 | 與正式內容同庫，靠查詢過濾 | 草稿只在後台，發佈才進建置 |
| 後台掛掉的影響 | 無 | 全站掛 | 只影響編輯與發佈 |

## 決定

採 C。

- 內容正本是 Payload（D1）。已發佈內容每週匯出成 MDX 進 `content-backup/`，
  這是備份，不是第二個正本。
- 前台在建置時透過 `scripts/fetch-content.mjs` 拿內容。`CONTENT_SOURCE=git|payload` 兩條路徑並存，
  切換可逆。
- 發佈走佇列（`publish_requests`），一次一筆；結果由 GitHub Actions 以 HMAC 回呼。
  細節與每種失敗的處理見 [runbook-publish.md](../runbook-publish.md)。
- 圖片與影片存私有 R2，沒有公開網址。圖片在建置時抓進 dist，影片與 GPX 在部署時才
  promote 到公開 bucket。

## 後果

- 代價：每次發佈等於一次完整建置與部署，不是即時的（目標 p95 ≤ 6 分鐘，不含影片轉碼）。
- 代價：前後台共用的純邏輯放在 `packages/*`，兩邊以相對路徑 import；這些檔只能用
  Node 型別剝除支援的語法（不能用 enum、namespace、參數屬性）。
- 代價：內容搬進 D1 後，`docs/translation.md` 的「在對話裡翻 git 裡的 MDX」要改成
  翻 `content-backup/` 或經匯出再導入；英文版動工前要先決定譯文的存放處。
- 風險：Payload 3.91＋Next 16.4＋OpenNext 1.20 這組合在 Workers 上沒有前人驗證過，
  所以 admin 的 CI 對整個 worker 建置產物跑 Playwright。
- 留言將由 `jackywu.ca/api/*` 的 zone route 導到後台 Worker，前台仍是純資產 Worker；另開計劃。
