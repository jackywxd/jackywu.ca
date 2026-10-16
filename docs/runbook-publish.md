# 發佈管線 runbook

發佈＝在後台按鈕 → `publish_requests` 佇列 → GitHub Actions `publish.yml` →
建置、五項檢查、部署、smoke → HMAC 回呼。一次只處理一筆。
狀態機的實作與測試在 `admin/src/lib/publish-queue.ts`、`admin/test/`。

## 狀態

| 狀態 | 意思 | 系統自動做什麼 |
|---|---|---|
| `queued` | 排隊中 | 前面沒有 `dispatched` 的請求時，送出下一筆 |
| `dispatched` | 已 dispatch，Actions 在跑 | 等回呼；看門狗監看 |
| `deployed` | 已上線 | 把該版本標成 published，撤回不再被引用、且由 pipeline 自己 promote 的公開媒體 |
| `failed` | 失敗，附上檢查名稱與摘要 | 線上站維持上一版；佇列繼續處理下一筆 |

## 失敗時發生什麼

| 情況 | 線上站 | Payload 狀態 | 你要做什麼 |
|---|---|---|---|
| 前置檢查不過（slug、字數、缺 heroAlt、簡體字、媒體沒傳完） | 不變 | 不排隊，欄位上顯示原因 | 照訊息改，再按發佈 |
| 網站還沒切換到後台內容（repo 變數 `CONTENT_SOURCE` 不是 `payload`） | 不變 | 請求標 failed，檢查名稱 `content-source` | 先完成切換（[admin-setup.md](admin-setup.md)） |
| 建置或 verify-* 失敗 | 不變 | 請求標 failed，附檢查名稱 | 修稿，再按發佈 |
| smoke 失敗（或部署後被取消） | 自動 `wrangler rollback` 回上一版；這次搬到公開端的影片／GPX 一併撤回 | 請求標 failed | 看 run 連結；修好再發 |
| smoke 失敗**而且回滾也失敗** | **可能停在壞掉的版本** | 請求標 failed，檢查名稱 `rollback`，信件主旨「線上可能是壞掉的版本」 | 需要人處理：到 Cloudflare 手動回滾 |
| Actions 的 run 被 `cancelled`（concurrency 取消排隊中的 run） | 不變 | 不算失敗，自動重送，最多 3 次 | 通常不用做事 |
| 送出之後 15 分鐘還找不到這一次的 run | 不變 | 當作沒送到，重送（算一次嘗試） | 通常不用做事 |
| run 還在跑或在排隊 | — | 一直是進行中，不會被判失敗；超過 6 小時才收掉 | 通常不用做事 |
| run 結束但回呼沒送到 | 看情況 | 看門狗讀線上的 `content-manifest.json`：記的就是這一筆 → 判已上線並發佈；不是 → failed | 收到「沒有上線」才需要重發 |
| 先被判失敗、之後才收到成功回呼 | 已上線 | 改判已上線（標記 late）並發佈 | 不用做事 |
| 完整性護欄：拉到的文章／路線／影片比上次少得不合理，或轉址整批不見 | 不變（建置中止） | 標 failed | 先查後台是否真的少了資料，不要硬發 |
| 撤回公開媒體超過「已 promote 總數」的 20%（至少容許 4 個） | 已上線 | 不刪，**寄信通知**「公開媒體的撤回被擋下」 | 確認內容正常；下一次發佈會再試 |

佇列的不變量由資料庫保證：同一時間最多一筆 `dispatched`、同一文件同一版本同一動作最多一筆進行中
（部分唯一索引）。所有狀態轉移都是 compare-and-set，回呼、排程同時到也只會有一個寫入成功。
看門狗只由排程（每 5 分鐘）執行；狀態頁的輪詢只讀。

發佈上線、發佈失敗、看門狗收掉、dispatch 送不出去（同一筆只寄第一次）、撤回被擋下，這五種會寄信（mailer Worker → Email Routing）。每週備份失敗目前只在 Actions 上紅燈，不會寄信。沒收到信不代表沒事：
後台的「系統」頁顯示佇列與最近 20 次部署。

## 一鍵還原

- **撤下**：後台按「撤下」＝建一筆 `unpublish` 請求，用「已上線減掉這篇」重建，成功後才 unpublish。
- **內容回退到 git**：把建置的 `CONTENT_SOURCE` 改回 `git` 重新部署（git 裡的舊內容在 M4
  線上驗收通過前不刪）。
- **還原後台資料**：D1 Time Travel 30 天；每週 D1 匯出在私有 R2 的 `backup/`（保留 12 週）；
  已發佈內容每週匯出到 `content-backup/`。**還原演練尚未在線上跑過**——見 [admin-setup.md](admin-setup.md)。

## 不要做的事

- 不要手動刪公開 bucket 的 `video/`、`gpx/` 物件：promoted 表會跟實際不一致。要撤下就用後台。
- 不要對 production D1 跑 `payload migrate:status`：D1 adapter 在 `NODE_ENV=production`
  連線時會自動套用 migration。production 的 migration 只經由 `admin-deploy.yml`。
