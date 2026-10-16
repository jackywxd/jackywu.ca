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
| 建置或 verify-* 失敗 | 不變 | 請求標 failed，附檢查名稱 | 修稿，再按發佈 |
| smoke 失敗 | 自動 `wrangler rollback` 回上一版 | 請求標 failed | 看 run 連結；修好再發 |
| Actions 的 run 被 `cancelled`（concurrency 取消排隊中的 run） | 不變 | 不算失敗，自動重送，最多 3 次，仍取消才 failed | 通常不用做事 |
| Actions 掛住、沒有回呼 | 不變 | 超過 25 分鐘（看門狗）標 failed，換下一筆 | 看信，再按發佈 |
| 完整性護欄：fetch 到的已上線篇數異常減少 | 不變（建置中止） | 標 failed | 先查後台是否真的少了資料，不要硬發 |
| 撤回公開媒體超過 manifest 的 20% | 已上線 | 不刪、後台顯示警告 | 人工確認是不是 fetch 拿到不完整資料 |

發佈上線、發佈失敗、看門狗收掉、dispatch 送不出去，這四種會寄信（mailer Worker → Email Routing）。每週備份失敗目前只在 Actions 上紅燈，不會寄信。沒收到信不代表沒事：
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
