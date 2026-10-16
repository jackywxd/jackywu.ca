# 後台一次性設定清單

這些步驟只能由你做：秘密只顯示一次，不經過對話。每一項都寫了「怎麼知道做對了」。
staging 與 production 各做一遍，資源互相獨立。

## 已經做好（M0，2026-10-16）

D1 `hongchen-admin`／`-staging`、私有 R2 `hongchen-admin-private`／`-staging`
（r2.dev 關閉、無網域、`video-src/` 與 `trash/` 30 天 lifecycle、`backup/` 84 天）、
Access policy `hongchen-owner-only` 套在 admin、admin-staging、staging 三個主機名。
Workers Paid 已確認。

## 待你做

1. **DNS／Access 驗證**：部署一次後，`curl -I https://admin.jackywu.ca` 應該 302 到 Access 登入頁。
   把 Access application 的 **AUD** 與 **team domain** 填進 `admin/wrangler.jsonc` 的 `ACCESS_AUD`、
   `ACCESS_TEAM_DOMAIN`（目前是空字串，空值會讓 strategy 直接拒絕，不會放行）。
2. **Access 服務憑證（Service Token）**：建一組，並在 policy 加 Service Auth 規則。
   - 放進 GitHub secrets：`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`。同一個 client id 填進
     `admin/wrangler.jsonc` 的 `ACCESS_CI_CLIENT_ID`：只有這一組在 Payload 裡是 reader，沒填時 CI 什麼都讀不到。
   - 另建一組給轉碼 Worker 用，放進 admin 的 Worker secrets：`TRANSCODER_ACCESS_ID`、`TRANSCODER_ACCESS_SECRET`。
   - 驗證：`workflow_dispatch` 跑 `backup.yml`，fetch 不被 302。
3. **GitHub App**：只安裝到這個 repo，權限 `contents: read`、`actions: write`、`metadata: read`。
   Worker secrets：`GITHUB_APP_ID`、`GITHUB_APP_INSTALLATION_ID`、`GITHUB_APP_PRIVATE_KEY`
   （PKCS#8 PEM；換行可寫成 `\n`）。`GITHUB_REPO` 預設 `jackywxd/jackywu.ca`，不同就設。
4. **HMAC（兩把，不要共用）**：
   - `PUBLISH_HMAC_SECRET`：發佈回呼用。放進 admin 的 Worker secrets 與 GitHub secret。
   - `SWEEP_HMAC_SECRET`：排程用。放進 admin 與 cron 的 Worker secrets（不放 GitHub）。
     分開的理由：排程 Worker 只該能叫看門狗，不該能偽造「已上線」的回呼。
   - 另需 `PAYLOAD_SECRET`、`VIDEO_INTERNAL_SECRET`（admin 與轉碼 Worker 共用）。
5. **R2 金鑰（scoped）**：私有 bucket 唯讀 → `R2_PRIVATE_KEY_ID`／`R2_PRIVATE_SECRET`；
   公開 bucket 只寫 `video/`、`gpx/` → `R2_PUBLIC_KEY_ID`／`R2_PUBLIC_SECRET`。
6. **GitHub 設定**：建 environments `staging`、`production`（production 加 required reviewers，
   因為 `admin-deploy.yml` 會對線上 D1 套 migration）；secrets 含上面各項加
   `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
7. **Email Routing**：在 jackywu.ca 啟用（會新增 MX/SPF），目的地 `xudong.wu@gmail.com` 已驗證。
   這是 DNS 變更，所以由你執行。驗證：在 staging 發佈一篇測試文章，應收到「已上線」信（沒有單獨的測試信按鈕）。
8. **內容來源（repo 變數）**：Settings → Variables 新增 `CONTENT_SOURCE`。切換前不設或設 `git`：
   `deploy.yml` 用 git 內容部署，後台的發佈一律在 `content-source` 步驟被拒絕並回報。
   切換時設成 `payload`，然後手動執行一次 Publish workflow 並勾選 `first_payload_deploy`
   （線上還沒有 `content-manifest.json`）。之後所有部署——後台發佈、push main、手動重建——都由 `publish.yml` 做。
   **切換之後不要再從本機 `pnpm exec wrangler deploy`**：那會用 git 內容蓋掉線上。
9. **部署順序**：`admin-deploy.yml` 依序部署 mailer → transcoder → admin → cron，先 staging。
   transcoder 的容器映像還沒在真環境 build 過（本機 Docker 沒開），第一次部署以它為最大不確定項。

## 上線前驗收（尚未做）

這些我無法在本機證明，**不要當作已通過**：

- staging 上走一次完整發佈：發佈 → 建置 → 部署 → 「已上線」，記錄耗時。
- 故意讓 `verify-og-crop` 失敗的稿子：狀態列顯示檢查名稱，線上站不變，下一篇正常上線。
- 撤下後頁面 404、圖片不在 dist、影片公開網址 404。
- 用最新的 D1 匯出建新 D1、重建網站，與 production 的 dist 比對（還原演練）。
- M4：把 git 內容匯入 Payload，以 `CONTENT_SOURCE=git` 與 `payload` 各建一次對照；
  演練切回 git 一次。通過後才刪除 git 裡的舊內容與 `pnpm new`／`gpx`／`video`／`sync`。
