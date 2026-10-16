# 後台一次性設定清單

這些步驟只能由你做：秘密只顯示一次，不經過對話。每一項都寫了「怎麼知道做對了」。
資源分 staging 與 production 兩套，互相獨立；staging 目前能驗證的範圍見「staging 的限制」。

命令都在 repo 根目錄執行。亂數直接用管線寫進去；從 dashboard 複製的值由命令提示你貼上（不會顯示），
所以值不會出現在 shell history 裡。先確認兩邊都登入了：`pnpm --dir admin exec wrangler whoami`、`gh auth status`。

## 已經做好（M0，2026-10-16）

D1 `hongchen-admin`／`-staging`、私有 R2 `hongchen-admin-private`／`-staging`
（r2.dev 關閉、無網域、`video-src/` 與 `trash/` 30 天 lifecycle、`backup/` 84 天）、
Access policy `hongchen-owner-only` 套在 admin、admin-staging、staging 三個主機名。
Workers Paid 已確認。

## 待你做

### 1. Access

- 記下 admin application 的 **AUD** 與 **team domain**（`https://<team>.cloudflareaccess.com`），
  填進 `admin/wrangler.jsonc` 的 `ACCESS_AUD`、`ACCESS_TEAM_DOMAIN`（staging 填 admin-staging 那個 application 的）。
  目前是空字串，空值會讓 strategy 直接拒絕，不會放行。
- Service credentials → Service Tokens 建**兩組**：
  - `hongchen-ci`：GitHub Actions 用。它的 **client id**（不是機密）填進 `ACCESS_CI_CLIENT_ID`，
    production 與 staging 兩處都要填（`env` 底下的 vars 不繼承頂層）。只有這一組在 Payload 裡是 reader，沒填時 CI 什麼都讀不到。
  - `hongchen-transcoder`：轉碼容器回呼後台用。它過得了 Access，但在 Payload 裡是匿名。
- 在 admin、admin-staging 兩個 application 加一條 action 是 **Service Auth** 的 policy，把這兩組都放進去。
- 驗證：部署後 `curl -I https://admin.jackywu.ca` 應該 302 到 Access 登入頁；
  手動跑一次 `backup.yml`，fetch 不被 302。

### 2. GitHub App

只安裝到這個 repo，權限 **Actions: Read and write**、**Metadata: Read**，其他都不給。
後台用 workflow_dispatch 觸發 `publish.yml`、用 Actions API 查 run 的結論，兩者都只需要 Actions 權限。
不用 repository_dispatch，因為它要求 Contents: write，等於讓這把鑰匙能推程式碼。

App ID 在 App 設定頁；Installation ID 是裝好之後網址 `github.com/settings/installations/<數字>` 的那個數字。

```bash
pnpm --dir admin exec wrangler secret put GITHUB_APP_ID
```

```bash
pnpm --dir admin exec wrangler secret put GITHUB_APP_INSTALLATION_ID
```

私鑰要轉成 PKCS#8：GitHub 給的是 `BEGIN RSA PRIVATE KEY`（PKCS#1），程式用的 `importPKCS8` 不吃。路徑換成你下載的檔案：

```bash
openssl pkcs8 -topk8 -nocrypt -in ~/Downloads/YOUR-APP.private-key.pem | pnpm --dir admin exec wrangler secret put GITHUB_APP_PRIVATE_KEY
```

`GITHUB_REPO` 預設 `jackywxd/jackywu.ca`，不同才要設。

### 3. 後台 Worker 的其他 secrets

```bash
openssl rand -base64 48 | tr -d '\n' | pnpm --dir admin exec wrangler secret put PAYLOAD_SECRET
```

`VIDEO_INTERNAL_SECRET` 簽轉碼容器用的網址，簽與驗都在後台，只有後台需要：

```bash
openssl rand -hex 32 | tr -d '\n' | pnpm --dir admin exec wrangler secret put VIDEO_INTERNAL_SECRET
```

兩把 HMAC 不要共用：排程 Worker 只該能叫看門狗，不該能偽造「已上線」的回呼。
`SWEEP_HMAC_SECRET` 放後台與 cron Worker（不放 GitHub）：

```bash
S=$(openssl rand -hex 32); printf %s "$S" | pnpm --dir admin exec wrangler secret put SWEEP_HMAC_SECRET && printf %s "$S" | pnpm --dir admin exec wrangler secret put SWEEP_HMAC_SECRET -c cron/wrangler.jsonc; unset S
```

`PUBLISH_HMAC_SECRET` 放後台與 GitHub：

```bash
S=$(openssl rand -hex 32); printf %s "$S" | pnpm --dir admin exec wrangler secret put PUBLISH_HMAC_SECRET && printf %s "$S" | gh secret set PUBLISH_HMAC_SECRET --repo jackywxd/jackywu.ca; unset S
```

`hongchen-transcoder` 的 service token（提示時貼上）：

```bash
pnpm --dir admin exec wrangler secret put TRANSCODER_ACCESS_ID
```

```bash
pnpm --dir admin exec wrangler secret put TRANSCODER_ACCESS_SECRET
```

Worker 還沒部署過也可以先設：非互動模式下 wrangler 會建一個空殼 Worker 放 secret，第一次 `admin-deploy` 再換成真的程式。
寄信與轉碼 Worker 不需要任何 secret。

### 4. R2 金鑰

R2 → Manage API Tokens 建兩組。**R2 token 最細只能限定到 bucket，不能限定前綴**（前綴只有臨時憑證做得到）。

- 私有 `hongchen-admin-private`：Object Read only → `R2_PRIVATE_KEY_ID`／`R2_PRIVATE_SECRET`。
- 公開 `zhuiyunzhuxue-media`：Object Read & Write → `R2_PUBLIC_KEY_ID`／`R2_PUBLIC_SECRET`。
  這組讀寫得到整個公開 bucket，不只 `video/`、`gpx/`；`promote-media.mjs` 自己只碰它記錄過的 key。

### 5. GitHub secrets 與 environments

`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 已經有了，但這組 token 目前只部署前台；
`admin-deploy.yml` 另外需要 Workers Scripts、Containers、D1、Workers 自訂網域的權限，不夠時第一次部署會失敗（不會造成損害）。
其餘的每個命令都會提示你貼上值：

```bash
gh secret set CF_ACCESS_CLIENT_ID --repo jackywxd/jackywu.ca
```

```bash
gh secret set CF_ACCESS_CLIENT_SECRET --repo jackywxd/jackywu.ca
```

```bash
gh secret set R2_PRIVATE_KEY_ID --repo jackywxd/jackywu.ca
```

```bash
gh secret set R2_PRIVATE_SECRET --repo jackywxd/jackywu.ca
```

```bash
gh secret set R2_PUBLIC_KEY_ID --repo jackywxd/jackywu.ca
```

```bash
gh secret set R2_PUBLIC_SECRET --repo jackywxd/jackywu.ca
```

environments：production 要你核准，因為 `admin-deploy.yml` 會對線上 D1 套 migration。

```bash
gh api -X PUT repos/jackywxd/jackywu.ca/environments/staging
```

```bash
printf '{"reviewers":[{"type":"User","id":%s}]}' "$(gh api user --jq .id)" | gh api -X PUT repos/jackywxd/jackywu.ca/environments/production --input -
```

GitHub 的 environment 名稱不分大小寫，repo 裡既有的 `Production`（Cloudflare 整合建的）就是這一個。
核准只攔宣告了 `environment: production` 的 job（目前只有 `admin-deploy.yml`），`deploy.yml` 不受影響。

### 6. staging

第 3 節的命令在 `wrangler secret put` 後面加 `--env staging`，**每一把都重新產生**，不沿用 production 的值。
staging 只設 `PAYLOAD_SECRET`、`VIDEO_INTERNAL_SECRET`、`SWEEP_HMAC_SECRET`（後台與 cron）、
`TRANSCODER_ACCESS_ID`／`TRANSCODER_ACCESS_SECRET`。GitHub App 三個值與 `PUBLISH_HMAC_SECRET` 先不要設，見下一節。

### 7. 檢查（只列名稱，不顯示值）

```bash
pnpm --dir admin exec wrangler secret list
```

```bash
pnpm --dir admin exec wrangler secret list -c cron/wrangler.jsonc
```

```bash
gh secret list --repo jackywxd/jackywu.ca
```

### 8. Email Routing

在 jackywu.ca 啟用（會新增 MX/SPF），目的地 `xudong.wu@gmail.com` 已驗證。這是 DNS 變更，所以由你執行。
驗證：production 第一次發佈時應收到「已上線」信（沒有單獨的測試信按鈕，staging 也發佈不了）。

### 9. 部署順序

`admin-deploy.yml` 依序部署 mailer → transcoder → admin → cron，先 staging。
transcoder 的容器映像還沒在真環境 build 過（本機 Docker 沒開），第一次部署以它為最大不確定項。

### 10. 內容來源（repo 變數）：M4 對照通過之後才做

切換前不設或設 `git`：`deploy.yml` 用 git 內容部署，後台的發佈一律在 `content-source` 步驟被拒絕並回報。
在內容匯入後台、對照通過之前就設成 `payload`，網站會用空的後台內容部署。切換時：

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
