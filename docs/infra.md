# 基礎設施即程式碼（OpenTofu）runbook

後台（admin.jackywu.ca 一套）與 zone 設定改由 [`infra/`](../infra/) 裡的程式碼管理。這份文件是**照著敲就能跑**的命令清單：
每一步寫了在哪裡跑、跑什麼、預期看到什麼、看到別的怎麼辦。

約定：

- 所有命令都在 repo 根目錄（`~/repos/jackywu.ca.next`）的 **macOS 終端機 App** 裡跑（zsh）。
  不要在 Claude 視窗的終端機面板跑會碰到秘密的步驟，也不要把輸出貼進對話。
- token 只放在當下的 shell 變數裡（`read -rs`，不顯示、不進 history），用完 `unset`，並到 dashboard 撤銷。
- 標了 **不可逆** 的步驟，跑之前先確認上一步的檢查點是綠的。

目前進度：M0（探索）已可執行；M1 之後的步驟會隨程式碼一起補上，**還沒寫好的步驟不要自己猜著跑**。

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
6. 左側 **Install App** → Install → **Only select repositories** → `jackywu.ca` → Install。
   網址最後的數字是 **Installation ID**，記下來。

**發佈用的 App**（後台觸發 publish.yml；如果之前已經建過就沿用，確認權限即可）：
同上，名稱例如 `hongchen-publish`，Repository permissions 只給 **Actions: Read and write**（Metadata 自動）。
一樣記下 App ID、Installation ID，下載私鑰。

兩組 App ID 與 Installation ID 不是秘密，**直接貼給我**，我會寫進 `infra/live/terraform.tfvars`。

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

1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Create Custom Token**。
2. Token name：`hongchen-bootstrap`。
3. Permissions（Account 範圍、選 jackywu.ca 所在的帳號）：
   - **Account → Account API Tokens → Edit**（核發那五把 token）
   - **Account → Workers R2 Storage → Edit**（建 state bucket）
4. TTL：結束日期設成明天 → Continue → Create Token。

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

```bash
unset CLOUDFLARE_API_TOKEN TF_VAR_bootstrap_passphrase GITHUB_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
```

到 dashboard：
- <https://dash.cloudflare.com/profile/api-tokens> 刪掉 `hongchen-bootstrap`。
- R2 → **Manage API tokens**：刪掉你**之前手動建**給 `R2_*` 用的兩把（新的叫 `hongchen-publish-r2-*`，由程式管，不要刪）。

完成後告訴我（附上第 1 步的四個 ID），我接著寫 M2。

---

## M2 之後

尚未完成。每一步會在對應的程式碼合併時補上，格式同上：在哪裡跑、命令、預期輸出、出錯怎麼辦。
