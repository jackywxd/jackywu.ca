# 後台一次性設定清單

**所有基礎設施（D1、R2、Access、service token、API token、GitHub environments 與 secrets、Worker secrets）
現在都由 [`infra/`](../infra/) 的 OpenTofu 程式碼管理，步驟見 [基礎設施 runbook](infra.md)。**
不要再用 `gh secret set` 或 `wrangler secret put` 手動設這些值：下一次 apply 會改回來，每週的漂移檢查也會變紅。

這份清單只剩 IaC 管不到、或刻意不管的事。

## 已經做好

- M0（2026-10-16）：D1、私有 R2、Access 都已建立，現在由 IaC 接手（`infra/live/imports.tf`）。
- Workers Paid 已確認；Email 目的地 `xudong.wu@gmail.com` 已驗證。

## 待你做

1. **照 [runbook](infra.md) 跑 M1 到 M5**：建兩個 GitHub App、bootstrap、第一次 apply、部署後台。
2. **Email Routing**：已由 IaC 開啟（`infra/live/zone.tf`）。合併後在 Infra apply 核准即生效；之後發佈結果會寄信。
3. **內容來源（repo 變數 `CONTENT_SOURCE`）**：刻意不納入 IaC（IaC 一管它，下一次 apply 就會把切換改回去）。
   切換前不設或設 `git`：`deploy.yml` 用 git 內容部署，後台的發佈一律在 `content-source` 步驟被拒絕並回報。
   要等 M4 把內容匯入後台、對照通過之後才切換：

   ```bash
   gh variable set CONTENT_SOURCE --body payload --repo jackywxd/jackywu.ca
   ```

   ```bash
   gh workflow run publish.yml --repo jackywxd/jackywu.ca -f first_payload_deploy=true
   ```

   第二步是因為線上還沒有 `content-manifest.json`。之後所有部署——後台發佈、push main、手動重建——都由 `publish.yml` 做。
   **切換之後不要再從本機 `pnpm exec wrangler deploy`**：那會用 git 內容蓋掉線上。

## staging 的限制

`publish.yml` 與 `backup.yml` 固定指向 `admin.jackywu.ca` 與正式站，沒有 staging 版的發佈流程。
staging 後台若設了 GitHub App，觸發的會是**正式站**的 `publish.yml`：它在正式後台找不到那筆請求而失敗，
不會動到正式站，但 staging 永遠發佈不成。所以 staging 現在驗證的是登入、編輯、上傳、轉碼；
完整的發佈只能在 production 驗收，除非另外做一份 staging 的 publish workflow。

## 上線前驗收（尚未做）

這些我無法在本機證明，**不要當作已通過**：

- production 上走一次完整發佈：發佈 → 建置 → 部署 → 「已上線」，記錄耗時（staging 做不到，見上一節）。
- 故意讓 `verify-og-crop` 失敗的稿子：狀態列顯示檢查名稱，線上站不變，下一篇正常上線。
- 撤下後頁面 404、圖片不在 dist、影片公開網址 404。
- 用最新的 D1 匯出建新 D1、重建網站，與 production 的 dist 比對（還原演練）。
- M4：把 git 內容匯入 Payload，以 `CONTENT_SOURCE=git` 與 `payload` 各建一次對照；
  演練切回 git 一次。通過後才刪除 git 裡的舊內容與 `pnpm new`／`gpx`／`video`／`sync`。
