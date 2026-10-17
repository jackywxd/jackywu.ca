# 基礎設施即程式碼（OpenTofu）runbook

後台（admin.jackywu.ca 一套）與 zone 設定改由 [`infra/`](../infra/) 裡的程式碼管理。這份文件是**照著敲就能跑**的命令清單：
每一步寫了在哪裡跑、跑什麼、預期看到什麼、看到別的怎麼辦。

約定：

- 所有命令都在 repo 根目錄（`~/repos/jackywu.ca.next`）的 **macOS 終端機 App** 裡跑（zsh）。
  不要在 Claude 視窗的終端機面板跑會碰到秘密的步驟，也不要把輸出貼進對話。
- token 只放在當下的 shell 變數裡（`read -rs`，不顯示、不進 history），用完 `unset`，並到 dashboard 撤銷。
- 標了 **不可逆** 的步驟，跑之前先確認上一步的檢查點是綠的。

目前進度：M0、M1 的步驟可以執行；M2 之後的步驟要等這個分支合併後才適用。**還沒寫好的步驟不要自己猜著跑**。

---

## 準備：安裝工具（一次）

```bash
brew install opentofu
```

```bash
tofu version
```

預期第一行是 `OpenTofu v1.13.x`。不是的話：`brew upgrade opentofu`。

```bash
gh auth status
```

預期 `Logged in to github.com account jackywxd`。不是的話：`gh auth login`。

---

## M0：探索既有資源（唯讀）

目的：把 dashboard 上現有的東西（Access、DNS、轉址與 cache rules、R2 lifecycle、Worker 現況、GitHub environments）
讀成一份**非機密**快照，和一份 import 區塊草稿。腳本只發 GET，不會改任何東西。

### 1. 建一把唯讀 token（dashboard）

1. 打開 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**。
2. 選範本 **Read all resources** → **Use template**。
   用 user token 而不是 account token：Workers Builds 的 API 只接受 user token。
   範本清單裡找不到這一項時，改選 **Create Custom Token**，加入以下全部是 **Read** 的權限：
   Account → Access: Apps and Policies、Access: Organizations, Identity Providers, and Groups、Access: Service Tokens、
   D1、Workers R2 Storage、Workers Scripts、Email Routing Addresses；
   Zone → Zone、DNS、Zone Settings、Config Rules、Cache Rules、Single Redirect、Email Routing Rules。
   漏掉的權限不會讓腳本失敗，只會在最後列出讀不到的項目。
3. **TTL**：結束日期設成明天。其他保持預設 → **Continue to summary** → **Create Token**。
4. 畫面上的 token 只顯示一次，先不要關，下一步貼進終端機。

### 2. 把 token 放進 shell（不顯示、不進 history）

```bash
read -rs "CLOUDFLARE_API_TOKEN?貼上唯讀 token 後按 Enter: " && export CLOUDFLARE_API_TOKEN && echo
```

檢查 token 是有效的（只印狀態，不印 token）：

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify | jq -r '.result.status'
```

預期：`active`。印出 `null` 代表 token 貼錯了，重做第 2 步。

### 3. 執行探索

```bash
node infra/scripts/discover.mjs
```

預期最後幾行：

```
✓ 快照：infra/discovery/snapshot.json（DNS N 筆歸 tofu、M 筆不歸；rulesets K；Access apps 3）
✓ import 草稿：infra/discovery/imports.draft.tf
```

- 若有「有 N 項讀不到」：每一行是一個 API 路徑加 HTTP 狀態碼。`403` 多半是範本少了某個 Read 權限，
  把那幾行原樣貼給我（裡面只有路徑與錯誤代碼，沒有秘密）。
- `Access apps` 應該是 3（admin、admin-staging、staging）。不是 3 就停下來告訴我。

### 4. 檢查快照裡沒有秘密，然後收尾

快照會進公開 repo。腳本只寫白名單欄位，但仍請過目一次：

```bash
git diff --stat
```

```bash
less infra/discovery/snapshot.json
```

應該只看到 id、名稱、主機名、DNS 記錄內容、規則運算式、secret 的**名稱**（例如 `PAYLOAD_SECRET`），不會有任何 secret 的值。

收尾：清掉 shell 裡的 token，並到 <https://dash.cloudflare.com/profile/api-tokens> 把這把 token **Delete**。

```bash
unset CLOUDFLARE_API_TOKEN
```

完成之後告訴我，我會讀快照、整理 import 區塊，接著寫 M1。

---

## M1：bootstrap（state bucket、所有 token、GitHub environments）

這一步建立之後一切的基礎。它**只在你的電腦上跑**，CI 不碰。完成後：
- R2 上有一個加密 state 用的 bucket `hongchen-tofu-state`；
- Cloudflare 上有五把由程式核發的 token（CI apply、CI plan、state、R2 私有唯讀、R2 公開讀寫）；
- GitHub 上有 `infra`（要你核准）、`infra-plan`、`staging`、`Production`（加上你為核准者）四個 environment 與它們的 secrets；
- `R2_*` 四個 repo secret 換成新 token 的值。

### 1. 建兩個 GitHub App（dashboard，一次）

**hongchen-infra**（給 CI 裡的 tofu 寫 GitHub secrets）：

1. 打開 <https://github.com/settings/apps/new>。
2. GitHub App name：`hongchen-infra`；Homepage URL：`https://jackywu.ca`；**Webhook → Active 取消勾選**。
3. Repository permissions：**Secrets: Read and write**、Metadata: Read-only（自動）。其他全部 No access。
4. Where can this GitHub App be installed：**Only on this account** → **Create GitHub App**。
5. 記下頁面上的 **App ID**。往下捲 → **Generate a private key**，瀏覽器會下載一個 `.pem`。
6. 打開 <https://github.com/settings/apps/hongchen-infra/installations> → 在 `jackywxd` 那一列按 **Install** →
   **Only select repositories** → `jackywu.ca` → Install。裝好後網址是 `https://github.com/settings/installations/<數字>`，
   那串數字是 **Installation ID**（之後要找：<https://github.com/settings/installations> → Configure → 看網址）。

**發佈用的 App**（後台觸發 publish.yml；如果之前已經建過就沿用，確認權限即可）：
同上，名稱 `hongchen-publish`，Repository permissions 只給 **Actions: Read and write**（Metadata 自動），
安裝頁是 <https://github.com/settings/apps/hongchen-publish/installations>。
一樣記下 App ID、Installation ID，下載私鑰。

兩組 App ID 與 Installation ID 不是秘密，記在 [`infra/live/terraform.tfvars`](../infra/live/terraform.tfvars)（已填：hongchen-infra 5354080／172287791，hongchen-publish 5354140／172289186）。

### 2. 把私鑰轉成 PKCS#8，放在 repo 外

GitHub 給的是 PKCS#1（`BEGIN RSA PRIVATE KEY`），程式只吃 PKCS#8。把 `~/Downloads/` 後面的檔名換成實際下載的：

```bash
mkdir -p ~/.hongchen && chmod 700 ~/.hongchen
```

```bash
openssl pkcs8 -topk8 -nocrypt -in ~/Downloads/hongchen-infra.*.private-key.pem -out ~/.hongchen/infra-app.pem && chmod 600 ~/.hongchen/infra-app.pem
```

```bash
openssl pkcs8 -topk8 -nocrypt -in ~/Downloads/hongchen-publish.*.private-key.pem -out ~/.hongchen/publish-app.pem && chmod 600 ~/.hongchen/publish-app.pem
```

檢查（只印第一行）：

```bash
head -1 ~/.hongchen/infra-app.pem ~/.hongchen/publish-app.pem
```

預期兩個都是 `-----BEGIN PRIVATE KEY-----`。之後把 `~/Downloads/` 裡的原檔存進密碼管理器再刪掉。

### 3. 建 bootstrap token（dashboard，用一天）

要在**帳號層級**建（account-owned token）。個人頁 `/profile/api-tokens` 的權限清單裡只有使用者層級的
「API Tokens」，那是核發「使用者 token」用的，沒有我們需要的「Account API Tokens」。

1. 打開 <https://dash.cloudflare.com/?to=/:account/api-tokens>（左側 **Manage account → Account API tokens**），
   有多個帳號時選 jackywu.ca 所在的那個 → **Create Token** → **Create Custom Token**。
2. Token name：`hongchen-bootstrap`。
3. Permissions：
   - **Account → Account API Tokens → Edit**（核發那五把 token；讀權限清單也靠它）
   - **Account → Workers R2 Storage → Edit**（建 state bucket）
4. Expiration（TTL）：結束日期設成明天 → Continue to summary → Create Token。

在帳號層級建 token 需要你在這個帳號是 Super Administrator（或有 API Token Provisioning 角色）。
建好之後先用下面這行確認它讀得到權限清單（只印結果，不印 token），預期 `{"success":true,"count":<大於 0>}`：

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts/e92ee6e81173e12edb023ed5ee34faee/tokens/permission_groups | jq -c '{success, count: (.result | length)}'
```

（這行要在第 4 步把 token 放進 shell 之後跑。）

### 4. 準備 shell（同一個終端機視窗做完第 4 到第 7 步）

```bash
cd ~/repos/jackywu.ca.next/infra/bootstrap
```

```bash
read -rs "CLOUDFLARE_API_TOKEN?貼上 bootstrap token 後按 Enter: " && export CLOUDFLARE_API_TOKEN && echo
```

bootstrap 的 state 密語：**先在密碼管理器產生一個 32 字元以上的密語並存好**（遺失就再也讀不回這個 state），再貼進來：

```bash
read -rs "TF_VAR_bootstrap_passphrase?貼上 bootstrap 密語後按 Enter: " && export TF_VAR_bootstrap_passphrase && echo
```

```bash
export GITHUB_TOKEN="$(gh auth token)" TF_VAR_infra_app_private_key_file="$HOME/.hongchen/infra-app.pem" TF_VAR_publish_app_private_key_file="$HOME/.hongchen/publish-app.pem"
```

### 5. 第一次 apply（本機 state，因為 state bucket 還不存在）

```bash
mv backend.tf backend.tf.off
```

```bash
tofu init -input=false
```

預期最後一行 `OpenTofu has been successfully initialized!`。

```bash
tofu plan -out=tfplan
```

預期最後是 **`Plan: 1 to import, 34 to add, 0 to change, 0 to destroy.`**（import 的是既有的 `Production`）。
- 出現 `to change` 或 `to destroy`：停下來，把 `Plan:` 那一行與它上面以 `#` 開頭的資源名稱貼給我（不要貼整段輸出）。
- 出現 `Invalid index` 而且提到 `local.pg`：某個權限名稱和 Cloudflare 的不一樣，把錯誤訊息裡的鍵名貼給我。

```bash
tofu apply tfplan
```

預期 `Apply complete! Resources: 1 imported, 34 added, 0 changed, 0 destroyed.`

### 6. 把 state 搬到 R2（**不可逆前的最後檢查點**：第 5 步必須是 Apply complete）

用剛核發的 state token 當 S3 憑證（值直接接進變數，不印出來）：

```bash
export AWS_ACCESS_KEY_ID="$(tofu output -raw state_access_key_id)" AWS_SECRET_ACCESS_KEY="$(tofu output -raw state_secret_access_key)"
```

```bash
mv backend.tf.off backend.tf && tofu init -migrate-state -input=false -force-copy
```

預期 `Successfully configured the backend "s3"!`。檢查遠端讀得到、而且和本機一樣多：

```bash
tofu state list | wc -l
```

預期 `37`（35 個資源加 2 個 data source）。是的話，刪掉本機的 state（它已經在 R2；**這一步不可逆**，數字不對就不要刪）：

```bash
rm -f terraform.tfstate terraform.tfstate.backup tfplan
```

### 7. 驗證

**加密**：R2 上的 state 只能有 `encrypted_data`，不能看得到資源。

```bash
pnpm --dir ../../admin exec wrangler r2 object get hongchen-tofu-state/bootstrap/terraform.tfstate --remote --pipe 2>/dev/null | grep -c '"encrypted_data"'
```

預期 `1`。

```bash
pnpm --dir ../../admin exec wrangler r2 object get hongchen-tofu-state/bootstrap/terraform.tfstate --remote --pipe 2>/dev/null | grep -c '"resources"'
```

預期 `0`。

**鎖**：開**第二個**終端機視窗，做第 4 步的 `cd` 與三個 `export`／`read`，再加上 `AWS_*` 那一行。然後：

- 視窗 A（會停在確認提示，期間一直持有鎖）：

  ```bash
  tofu apply -var 'rotate={"ci_plan":"locktest"}'
  ```

- 看到 `Enter a value:` 時，到視窗 B：

  ```bash
  tofu plan -lock-timeout=0
  ```

  預期 B 出現 **`Error acquiring the state lock`**。
- 回到視窗 A，輸入 `no` 按 Enter（**不要輸入 yes**，否則會真的換掉 CI plan 的 token）。預期 `Apply cancelled.`

B 沒有出現鎖錯誤的話告訴我：代表 R2 上的鎖沒有作用，CI 會改用 concurrency 群組，並且規定 CI 在跑時不在本機 apply。

**GitHub**：

```bash
gh api repos/jackywxd/jackywu.ca/environments --jq '.environments[].name'
```

預期包含 `infra`、`infra-plan`、`staging`、`Production`。

```bash
gh secret list -e infra --repo jackywxd/jackywu.ca
```

預期 6 個名稱：`CLOUDFLARE_API_TOKEN`、`INFRA_APP_PRIVATE_KEY`、`PUBLISH_APP_PRIVATE_KEY`、`TF_STATE_ACCESS_KEY_ID`、`TF_STATE_PASSPHRASE`、`TF_STATE_SECRET_ACCESS_KEY`。

### 8. 收尾

先把之後在本機重跑 bootstrap、或緊急時對 live 跑 apply 會用到的三個值存進密碼管理器。
每一行把一個值複製到剪貼簿（不顯示），貼進密碼管理器之後再跑下一行：

```bash
tofu output -raw state_access_key_id | pbcopy
```

```bash
tofu output -raw state_secret_access_key | pbcopy
```

```bash
tofu output -raw live_state_passphrase | pbcopy
```

存好之後清掉剪貼簿與 shell 裡的值：

```bash
printf '' | pbcopy
```

```bash
unset CLOUDFLARE_API_TOKEN TF_VAR_bootstrap_passphrase GITHUB_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
```

到 dashboard：
- <https://dash.cloudflare.com/profile/api-tokens> 刪掉 `hongchen-bootstrap`。
- R2 → **Manage API tokens**：刪掉你**之前手動建**給 `R2_*` 用的兩把（新的叫 `hongchen-publish-r2-*`，由程式管，不要刪）。

完成後告訴我（附上第 1 步的四個 ID），我接著寫 M2。

---

## M2–M4：第一次套用 live（D1、R2、Access、zone、秘密）

從這裡開始都在 GitHub 上進行：PR 上自動 plan，合併後在 Actions 裡核准 apply。不需要在本機放任何 token。

**前提**：M1 已完成（`infra` 與 `infra-plan` 兩個 environment 的 secrets 都在）。

### 1. 開 PR，看 plan 摘要

這個分支（`feat/infra-as-code`）開成 PR 之後，**Infra plan** 會在 PR 上留一則以「OpenTofu plan」開頭的留言。核對：

- 第一行應該是 `import 11、新增 23、修改 N、取代 0、刪除 0`。
  - **import 11**：2 個 D1、3 個 bucket、OTP 登入、owner policy、3 個 Access app、www 轉址。
  - **新增 23**：3 組 lifecycle、3 個 r2.dev 設定、3 個 zone 設定、2 組 service token、Service Auth policy、7 個秘密與 1 把指紋金鑰、3 個 GitHub secret。
  - **修改 N**：至少有 `hongchen-admin` 與 `hongchen-admin-staging` 兩個 app（加上 Service Auth）。
- **取代或刪除不是 0：不要合併**，把留言裡以 `-` 或 `-/+` 開頭的那幾行貼給我。
- 留言最後有「擋下」一段：plan 碰到了受保護的資源，同上。

PR 上另外兩個 job（fmt／測試／靜態檢查、plan）都要綠。

### 2. 合併，核准 apply

合併之後 **Infra apply** 會先跑 plan，接著停在 `apply（需要核准）`。打開：

```bash
gh run list --repo jackywxd/jackywu.ca --workflow=infra-apply.yml -L 1
```

到那一次 run 的頁面按 **Review deployments** → 勾 `infra` → **Approve and deploy**。

apply job 的 log 應該依序看到：

- `✓ apply 完成`
- 同步：22 行 `✓ <Worker> <名稱> updated` 或 `created`（後台 12、staging 後台 8、兩個排程各 1）。
  這四個 Worker 上原本手動放的值會被換成 IaC 產生的值；它們還沒部署真的程式，所以不影響任何東西。
- 最後一步：4 行 `✓ <Worker> N 個 secret 都在`。

### 3. 確認第二次 plan 是空的（證明 import 與程式碼一致）

```bash
gh workflow run infra-plan.yml --repo jackywxd/jackywu.ca --ref main
```

等它跑完（約 3 分鐘）：

```bash
gh run list --repo jackywxd/jackywu.ca --workflow=infra-plan.yml -L 1
```

打開那一次 run 的 **Summary**，plan 那一段應該是 `（沒有變更）`。有變更的話把那幾行貼給我（通常是某個屬性的預設值和線上不同，要在程式碼裡寫明）。

### 4. 確認線上沒有被改壞

lifecycle 規則仍是四條（第一次 apply 會覆蓋，所以要看一次）：

```bash
pnpm --dir admin exec wrangler r2 bucket lifecycle list hongchen-admin-private
```

預期四條：`Default Multipart Abort Rule`、`expire-backup-84d`、`expire-trash-30d`、`expire-video-src-30d`。

www 仍然轉到 apex：

```bash
curl -sI https://www.jackywu.ca/ | grep -iE '^(HTTP|location)'
```

預期 `HTTP/2 301` 與 `location: https://jackywu.ca/`。

GitHub 的 secret 名稱齊全（值看不到）：

```bash
gh secret list --repo jackywxd/jackywu.ca
```

預期 9 個：`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`PUBLISH_HMAC_SECRET`、四個 `R2_*`。

---

## M5：部署後台（第一次）

Worker 的 secret 已經由 M2 寫好，`wrangler.jsonc` 的 `secrets.required` 會在缺任何一個時讓部署失敗。先 staging：

```bash
gh workflow run admin-deploy.yml --repo jackywxd/jackywu.ca -f target=staging
```

```bash
gh run list --repo jackywxd/jackywu.ca --workflow=admin-deploy.yml -L 1
```

- 第一個檢查步驟「Worker secret 都在」應該印兩行 `✓`。
- 最後的「暖機與冒煙」應該印 `✓ admin-staging.jackywu.ca 正常`：
  它用 `hongchen-ci` 這組 service token 通過 Access、拿到 Payload 的 `/api/users/me`，
  同時證明了 `ACCESS_AUD`、`ACCESS_TEAM_DOMAIN`、`ACCESS_CI_CLIENT_ID` 三個值都對。

staging 綠了再部署正式環境（`Production` 要你核准）：

```bash
gh workflow run admin-deploy.yml --repo jackywxd/jackywu.ca -f target=production
```

到 run 頁面 **Review deployments** → `Production` → Approve。暖機步驟應該印 `✓ admin.jackywu.ca 正常`。

**轉碼 Worker 的容器映像是第一次在真環境建置**，最可能在「部署轉碼 Worker」那一步失敗；失敗時把那一步的最後 20 行貼給我。

---

## 日常：改設定

1. 改 `infra/live/*.tf`（或 `infra/worker-secrets.json`）→ 開 PR。
2. 看 PR 上的 plan 摘要；fmt／測試／靜態檢查與 plan 都要綠。
3. 合併 → 在 Infra apply 核准。

不要用 dashboard 或 `gh secret set` 改這些東西：下一次 apply 會改回來，每週一的漂移檢查也會變紅。

## 輪替

**程式產生的秘密**（`PAYLOAD_SECRET`、`VIDEO_INTERNAL_SECRET`、`SWEEP_HMAC_SECRET`、`PUBLISH_HMAC_SECRET`）：
在 [`infra/live/terraform.tfvars`](../infra/live/terraform.tfvars) 加一行，例如：

```hcl
rotate = { "prod.PUBLISH_HMAC_SECRET" = "2026-12-01" }
```

開 PR → 合併 → 核准。apply 換掉值，同步腳本因為指紋變了而寫進 Worker，GitHub secret 同時更新。
換 PUBLISH 的那一兩分鐘內，正在跑的發佈回呼會被拒絕，看門狗會重送：挑沒有發佈在進行的時候。

**Access service token**（`hongchen-ci`、`hongchen-transcoder`，期限一年，到期前 30 天每週的漂移檢查會警告）：

```hcl
rotate = { "service_token.ci" = "2|2026-12-02T00:00:00Z" }
```

`2` 是下一個版本號（之後是 3、4…），後面是舊密鑰失效的時間（RFC 3339，留一天讓進行中的 run 跑完）。

**bootstrap 的 token**（CI apply／plan、state、R2 兩把）：在本機做，見下一節，`var.rotate` 的鍵是
`ci_apply`、`ci_plan`、`state`、`r2_private_read`、`r2_public_rw`。新的先建、寫進 GitHub，舊的才撤銷。

**GitHub App 私鑰**：App 設定頁 **Generate a private key** → 照 M1 第 2 步轉成 PKCS#8 → 在本機對 bootstrap 跑 plan／apply
（它會更新 environment secret）→ 合併任何一個 infra PR 或手動執行 Infra apply 的 `sync_only` 讓後台拿到新值 →
確認正常後，在 App 設定頁刪掉舊的私鑰。

## 在本機跑 bootstrap（輪替或修改它的時候）

和 M1 第 4 步一樣準備 shell（bootstrap token、bootstrap 密語、`GITHUB_TOKEN`、兩個私鑰路徑），再加上 state 的憑證
（M1 第 8 步存進密碼管理器的兩個值）：

```bash
read -rs "AWS_ACCESS_KEY_ID?state access key id: " && export AWS_ACCESS_KEY_ID && echo
```

```bash
read -rs "AWS_SECRET_ACCESS_KEY?state secret access key: " && export AWS_SECRET_ACCESS_KEY && echo
```

```bash
cd ~/repos/jackywu.ca.next/infra/bootstrap && tofu init -input=false && tofu plan -out=tfplan
```

看完 `Plan:` 那一行再 `tofu apply tfplan`，收尾同 M1 第 8 步。

## 緊急：在本機對 live 跑 apply

只在 CI 不能用、或要刻意刪除受保護資源（CI 會擋）時才用。先在 GitHub 上確認沒有 Infra apply 正在跑。

```bash
cd ~/repos/jackywu.ca.next/infra/live
```

state 憑證同上一節；密語與 provider 用的值：

```bash
read -rs "TF_VAR_state_passphrase?live 的 state 密語（M1 第 8 步存的第三個值）: " && export TF_VAR_state_passphrase && echo
```

```bash
read -rs "CLOUDFLARE_API_TOKEN?有寫入權限的 Cloudflare token: " && export CLOUDFLARE_API_TOKEN && echo
```

```bash
export TF_VAR_infra_app_private_key="$(cat ~/.hongchen/infra-app.pem)" TF_VAR_publish_app_private_key="$(cat ~/.hongchen/publish-app.pem)"
```

```bash
tofu init -input=false && tofu plan -out=tfplan
```

刪除受保護的資源要先在程式碼裡拿掉 `prevent_destroy`，這是刻意的兩道關卡。apply 前再看一次 `Plan:` 那一行；**刪除 D1 或 bucket 不可逆**。

## 不在 IaC 裡的東西，與原因

| 東西 | 為什麼只能手動 | 在哪裡 |
|---|---|---|
| 兩個 GitHub App 的註冊、安裝與私鑰 | GitHub 沒有建立 App 的 API（manifest 流程要在瀏覽器確認） | M1 第 1 步 |
| bootstrap token | 它是核發其他 token 的那一把，不能由自己核發；只用一天 | M1 第 3 步 |
| bootstrap 的 state 密語 | 它加密的 state 裡才有其他所有東西 | 你的密碼管理器 |
| Email 目的地驗證 | 要在信箱裡點連結 | 已完成（xudong.wu@gmail.com） |
| R2 custom domain `media.jackywu.ca` | provider 不支援 import，重建會讓媒體停擺 | Cloudflare R2 → zhuiyunzhuxue-media → Settings |
| Worker 程式碼、custom domain、cron、容器 | 由 wrangler 部署（`wrangler.jsonc` 就是它們的程式碼）；provider 沒有容器資源 | `admin-deploy.yml`、`deploy.yml`、`publish.yml` |
| `CONTENT_SOURCE` repo 變數 | 刻意不管：IaC 一管它，下一次 apply 就會把 M4 的切換改回去（`verify-infra` 會擋） | [後台設定清單](admin-setup.md) |
| repo 層級的 `CLOUDFLARE_API_TOKEN` | 前台部署一直用的那把；之後可以改由 bootstrap 核發（規劃中的 M8） | GitHub repo secrets |

---

## 尚未納入（之後的里程碑）

- **M7 Email Routing**：開啟會新增 MX/SPF。探索時 zone 上沒有任何 MX 或 SPF，不會衝突。
- **media.jackywu.ca 的 Cache Rule**：[部署](deployment.md) 寫著有一條（Edge 1 年、Browser 30 天），但 M0 探索時 zone 上**沒有**任何 cache ruleset。
  要不要建、以 IaC 建，由你決定。
- **M8**：由 bootstrap 核發權限剛好的部署 token，取代手動建的 repo 層級 `CLOUDFLARE_API_TOKEN`。
